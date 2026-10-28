import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import handler from '../api/notes.js';

// 가상 요청 연습입니다. 실제 Supabase나 배포, 심판 판정이 아닙니다.
const FAKE_KEY = 'test-only-fake-key';
const BASE = 'https://example-project.supabase.co';
const savedEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
const originalFetch = globalThis.fetch;

function fakeResponse() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

beforeEach(() => {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_SECRET_KEY = FAKE_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of [['SUPABASE_URL', savedEnv.url], ['SUPABASE_SECRET_KEY', savedEnv.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test('returns only title and content, never the key', async () => {
  let called;
  globalThis.fetch = async (url, init) => {
    called = { url: String(url), headers: init.headers };
    return new Response(JSON.stringify([
      { title: '가상1', content: '가상 본문', owner_id: 'x', id: 'y' },
      { title: 7, content: '형식 오류' },
    ]), { status: 200 });
  };
  const res = fakeResponse();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { notes: [{ title: '가상1', content: '가상 본문' }] });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(called.url.startsWith(`${BASE}/rest/v1/notes?`));
  assert.equal(called.headers.apikey, FAKE_KEY);
  assert.equal(called.headers.Authorization, undefined);
  assert.ok(!JSON.stringify(res.body).includes(FAKE_KEY));
});

test('sends Bearer only for legacy JWT-style keys', async () => {
  process.env.SUPABASE_SECRET_KEY = 'eyJfake-test-only';
  let headers;
  globalThis.fetch = async (_url, init) => { headers = init.headers; return new Response('[]', { status: 200 }); };
  await handler({ method: 'GET' }, fakeResponse());
  assert.equal(headers.Authorization, 'Bearer eyJfake-test-only');
});

test('refuses to run without safe configuration', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return new Response('[]'); };
  for (const url of [undefined, 'http://example-project.supabase.co', 'https://evil.example']) {
    if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
    const res = fakeResponse();
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'NOTES_NOT_CONFIGURED' });
  }
  process.env.SUPABASE_URL = BASE;
  delete process.env.SUPABASE_SECRET_KEY;
  const res = fakeResponse();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(fetched, false);
});

test('hides upstream errors and rejects other methods', async () => {
  globalThis.fetch = async () => new Response(`bad key ${FAKE_KEY}`, { status: 401 });
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = fakeResponse();
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { error: 'NOTES_UPSTREAM_ERROR' });
    assert.ok(!JSON.stringify(res.body).includes(FAKE_KEY));
  } finally {
    console.error = originalError;
  }
  const post = fakeResponse();
  await handler({ method: 'POST' }, post);
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.allow, 'GET');
});
