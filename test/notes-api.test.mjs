import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import handler, { createHandler } from '../api/notes.js';

// 가상 요청 연습입니다. 실제 Supabase나 배포, 심판 판정이 아닙니다.
const FAKE_KEY = 'test-only-fake-key';
const BASE = 'https://example-project.supabase.co';
const USER = '11111111-1111-4111-8111-111111111111';
const savedEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
const originalFetch = globalThis.fetch;
const asStudent = async () => ({ kind: 'student', userId: USER });

function fakeResponse() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function forgedToken(payload) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(payload)}.${Buffer.from('not-a-signature').toString('base64url')}`;
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

test('logged-in user gets only title and content, never the key', async () => {
  let called;
  globalThis.fetch = async (url, init) => {
    called = { url: String(url), headers: init.headers };
    return new Response(JSON.stringify([
      { title: '가상1', content: '가상 본문', owner_id: 'x', id: 'y' },
      { title: 7, content: '형식 오류' },
    ]), { status: 200 });
  };
  let seenAuthorization;
  const run = createHandler({ verifyLogin: async (value) => { seenAuthorization = value; return asStudent(); } });
  const res = fakeResponse();
  await run({ method: 'GET', headers: { authorization: 'Bearer abc.def.ghi' } }, res);
  assert.equal(seenAuthorization, 'Bearer abc.def.ghi');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { notes: [{ title: '가상1', content: '가상 본문' }] });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(called.url.startsWith(`${BASE}/rest/v1/notes?`));
  assert.equal(called.headers.apikey, FAKE_KEY);
  assert.equal(called.headers.Authorization, undefined);
  assert.ok(!JSON.stringify(res.body).includes(FAKE_KEY));
});

test('no login, failed check, or a crashing check all deny without touching the data', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return new Response('[]'); };
  const cases = [
    createHandler({ verifyLogin: async () => null }),
    createHandler({ verifyLogin: async () => { throw new Error('boom'); } }),
  ];
  for (const run of cases) {
    const res = fakeResponse();
    await run({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' });
    assert.equal(res.headers['www-authenticate'], 'Bearer');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(fetched, false);
});

test('identity claims sent by the browser are ignored', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return new Response('[]'); };
  const run = createHandler({ verifyLogin: async () => null });
  const res = fakeResponse();
  await run({
    method: 'GET',
    query: { userId: USER, role: 'admin' },
    body: { userId: USER, role: 'admin' },
    headers: { 'x-user-id': USER, 'x-role': 'admin' },
  }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(fetched, false);
});

const hasDependencies = await import('@supabase/supabase-js').then(() => import('jose')).then(() => true, () => false);

test('starter login helper rejects missing, malformed, and foreign-issuer tokens', {
  skip: hasDependencies ? false : '의존 패키지(@supabase/supabase-js, jose)가 설치되지 않아 건너뜀',
}, async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return new Response('[]'); };
  const now = Math.floor(Date.now() / 1000);
  const foreign = forgedToken({ iss: 'https://evil.example/auth/v1', aud: 'authenticated',
    role: 'authenticated', sub: USER, exp: now + 600 });
  for (const authorization of [undefined, '', 'Bearer', 'Bearer not-a-jwt', `Basic ${foreign}`, `Bearer ${foreign}`]) {
    const res = fakeResponse();
    await handler({ method: 'GET', headers: authorization === undefined ? {} : { authorization } }, res);
    assert.equal(res.statusCode, 401, String(authorization).slice(0, 12));
    assert.equal(res.body.error, 'LOGIN_REQUIRED');
  }
  assert.equal(fetched, false);
});

test('refuses to run without safe configuration', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return new Response('[]'); };
  const run = createHandler({ verifyLogin: asStudent });
  for (const url of [undefined, 'http://example-project.supabase.co', 'https://evil.example']) {
    if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
    const res = fakeResponse();
    await run({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'NOTES_NOT_CONFIGURED' });
  }
  process.env.SUPABASE_URL = BASE;
  delete process.env.SUPABASE_SECRET_KEY;
  const res = fakeResponse();
  await run({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(fetched, false);
});

test('hides upstream errors and rejects other methods', async () => {
  globalThis.fetch = async () => new Response(`bad key ${FAKE_KEY}`, { status: 401 });
  const run = createHandler({ verifyLogin: asStudent });
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = fakeResponse();
    await run({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { error: 'NOTES_UPSTREAM_ERROR' });
    assert.ok(!JSON.stringify(res.body).includes(FAKE_KEY));
  } finally {
    console.error = originalError;
  }
  const post = fakeResponse();
  await run({ method: 'POST', headers: {} }, post);
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.allow, 'GET');
});
