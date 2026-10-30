import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import collection, { createHandler as createCollection } from '../api/notes.js';
import item, { createHandler as createItem } from '../api/notes/[id].js';

// 가상 요청 연습입니다. 실제 Supabase나 배포, 심판 판정이 아닙니다.
const FAKE_KEY = 'test-only-fake-key';
const BASE = 'https://example-project.supabase.co';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const NOTE_ID = '33333333-3333-4333-8333-333333333333';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const savedEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
const originalFetch = globalThis.fetch;
const as = (userId) => async () => ({ kind: 'student', userId });
const asA = as(USER_A);
const noLogin = async () => null;

function fakeResponse() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

// 가짜 Supabase REST: 메모리 안의 표를 id·owner_id 조건으로 읽고 쓴다.
function fakeSupabase(initial = []) {
  const rows = initial.map((row) => ({ ...row }));
  const calls = [];
  const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url));
    const method = init.method ?? 'GET';
    calls.push({ method, url: target, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const eq = (name) => {
      const value = target.searchParams.get(name);
      return value?.startsWith('eq.') ? value.slice(3) : undefined;
    };
    const [id, owner] = [eq('id'), eq('owner_id')];
    const hit = rows.filter((row) => (id === undefined || row.id === id)
      && (owner === undefined || row.owner_id === owner));
    const pick = (row) => ({ id: row.id, title: row.title, content: row.content });
    if (method === 'GET') return reply(hit.map(pick));
    if (method === 'POST') {
      const row = JSON.parse(init.body);
      if (rows.some((existing) => existing.id === row.id)) return reply({ code: '23505' }, 409);
      rows.push(row);
      return new Response(null, { status: 201 });
    }
    if (method === 'PATCH') {
      for (const row of hit) Object.assign(row, JSON.parse(init.body));
      return reply(hit.map(pick));
    }
    if (method === 'DELETE') {
      for (const row of hit) rows.splice(rows.indexOf(row), 1);
      return reply(hit.map(pick));
    }
    return reply({}, 500);
  };
  return { rows, calls };
}

async function call(handler, request) {
  const res = fakeResponse();
  await handler({ headers: {}, query: {}, ...request }, res);
  return res;
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

test('create stores the server-verified user as owner and ignores identity claims from the browser', async () => {
  const db = fakeSupabase();
  const post = createCollection({ verifyLogin: asA });
  const res = await call(post, {
    method: 'POST', headers: { authorization: 'Bearer abc.def.ghi' },
    body: { title: ' 첫 메모 ', body: '본문', userId: USER_B, owner_id: USER_B, role: 'admin' },
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(res.body), ['id']);
  assert.match(res.body.id, UUID);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(db.rows, [{ id: res.body.id, owner_id: USER_A, title: '첫 메모', content: '본문' }]);
  assert.equal(db.calls[0].headers.apikey, FAKE_KEY);
  assert.ok(!JSON.stringify(res.body).includes(FAKE_KEY));
});

test('create accepts a client UUID but never overwrites an existing note', async () => {
  const db = fakeSupabase([{ id: NOTE_ID, owner_id: USER_B, title: '남의 메모', content: '그대로' }]);
  const post = createCollection({ verifyLogin: asA });
  const fresh = await call(post, { method: 'POST', body: { id: '44444444-4444-4444-8444-444444444444', title: 't', body: '' } });
  assert.equal(fresh.statusCode, 201);
  assert.equal(fresh.body.id, '44444444-4444-4444-8444-444444444444');
  const clash = await call(post, { method: 'POST', body: { id: NOTE_ID, title: '덮어쓰기', body: 'x' } });
  assert.equal(clash.statusCode, 409);
  assert.equal(db.rows.find((row) => row.id === NOTE_ID).title, '남의 메모');
});

test('full cycle: create, read, update, delete, then 404', async () => {
  fakeSupabase();
  const post = createCollection({ verifyLogin: asA });
  const one = createItem({ verifyLogin: asA });
  const { body: { id } } = await call(post, { method: 'POST', body: { title: '제목', body: '본문' } });

  const read = await call(one, { method: 'GET', query: { id } });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.body, { id, title: '제목', body: '본문' });

  const put = await call(one, { method: 'PUT', query: { id }, body: { title: '새 제목', body: '새 본문' } });
  assert.equal(put.statusCode, 200);
  assert.deepEqual(put.body, { id, title: '새 제목', body: '새 본문' });
  const partial = await call(one, { method: 'PUT', query: { id }, body: { body: '본문만' } });
  assert.deepEqual(partial.body, { id, title: '새 제목', body: '본문만' });

  const del = await call(one, { method: 'DELETE', query: { id } });
  assert.equal(del.statusCode, 200);
  assert.deepEqual(del.body, { id });
  for (const method of ['GET', 'DELETE']) {
    assert.equal((await call(one, { method, query: { id } })).statusCode, 404);
  }
  assert.equal((await call(one, { method: 'PUT', query: { id }, body: { title: 'x' } })).statusCode, 404);
});

test('list returns an array with only the logged-in user\'s notes', async () => {
  fakeSupabase([
    { id: NOTE_ID, owner_id: USER_A, title: 'A 메모', content: 'a' },
    { id: '55555555-5555-4555-8555-555555555555', owner_id: USER_B, title: 'B 메모', content: 'b' },
    { id: '66666666-6666-4666-8666-666666666666', owner_id: null, title: '주인 없음', content: 'c' },
  ]);
  const res = await call(createCollection({ verifyLogin: asA }), { method: 'GET' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [{ id: NOTE_ID, title: 'A 메모', body: 'a' }]);
});

test('every route denies a missing or failed login without touching the data', async () => {
  const db = fakeSupabase([{ id: NOTE_ID, owner_id: USER_A, title: 't', content: 'c' }]);
  const crashing = async () => { throw new Error('boom'); };
  const originalError = console.error;
  console.error = () => {};
  try {
  for (const verifyLogin of [noLogin, crashing, async () => ({ kind: 'student', userId: 'not-a-uuid' })]) {
    const list = createCollection({ verifyLogin });
    const single = createItem({ verifyLogin });
    const attempts = [
      [list, { method: 'GET' }],
      [list, { method: 'POST', body: { title: 't', body: 'b' } }],
      [single, { method: 'GET', query: { id: NOTE_ID } }],
      [single, { method: 'PUT', query: { id: NOTE_ID }, body: { title: 'x' } }],
      [single, { method: 'DELETE', query: { id: NOTE_ID } }],
    ];
    for (const [handler, request] of attempts) {
      const res = await call(handler, request);
      assert.equal(res.statusCode, 401, `${request.method}`);
      assert.deepEqual(res.body, { error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' });
      assert.equal(res.headers['www-authenticate'], 'Bearer');
    }
  }
  } finally {
    console.error = originalError;
  }
  assert.equal(db.calls.length, 0);
  assert.equal(db.rows[0].title, 't');
});

test('rejects invalid input before touching the data', async () => {
  const db = fakeSupabase();
  const post = createCollection({ verifyLogin: asA });
  const one = createItem({ verifyLogin: asA });
  const bad = [
    { title: '', body: 'b' }, { title: '   ', body: 'b' }, { body: 'b' }, { title: 't' },
    { title: 't', body: 5 }, { title: 'x'.repeat(201), body: 'b' }, { title: 't', body: 'x'.repeat(5001) },
    { title: 't', body: 'b', id: 'not-a-uuid' }, { title: 't', body: 'b', id: 7 }, ['t'], 'not json', null,
  ];
  for (const body of bad) {
    const res = await call(post, { method: 'POST', body });
    assert.equal(res.statusCode, 400, JSON.stringify(body)?.slice(0, 30));
  }
  for (const body of [{}, { title: '' }, { body: 5 }, 'not json', null]) {
    assert.equal((await call(one, { method: 'PUT', query: { id: NOTE_ID }, body })).statusCode, 400);
  }
  for (const id of ['abc', "1' or '1'='1", undefined, ['x']]) {
    assert.equal((await call(one, { method: 'GET', query: { id } })).statusCode, 404);
  }
  assert.equal(db.calls.length, 0);
});

test('methods outside the contract get 405', async () => {
  fakeSupabase();
  const list = await call(createCollection({ verifyLogin: asA }), { method: 'DELETE' });
  assert.equal(list.statusCode, 405);
  assert.equal(list.headers.allow, 'GET, POST');
  const single = await call(createItem({ verifyLogin: asA }), { method: 'POST', query: { id: NOTE_ID } });
  assert.equal(single.statusCode, 405);
  assert.equal(single.headers.allow, 'GET, PUT, DELETE');
});

test('refuses to run without safe configuration', async () => {
  const db = fakeSupabase();
  const post = createCollection({ verifyLogin: asA });
  for (const url of [undefined, 'http://example-project.supabase.co', 'https://evil.example']) {
    if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
    const res = await call(post, { method: 'GET' });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'NOTES_NOT_CONFIGURED' });
  }
  process.env.SUPABASE_URL = BASE;
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal((await call(post, { method: 'GET' })).statusCode, 500);
  assert.equal(db.calls.length, 0);
});

test('hides upstream errors', async () => {
  globalThis.fetch = async () => new Response(`bad key ${FAKE_KEY}`, { status: 401 });
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [handler, request] of [
      [createCollection({ verifyLogin: asA }), { method: 'GET' }],
      [createCollection({ verifyLogin: asA }), { method: 'POST', body: { title: 't', body: 'b' } }],
      [createItem({ verifyLogin: asA }), { method: 'GET', query: { id: NOTE_ID } }],
      [createItem({ verifyLogin: asA }), { method: 'DELETE', query: { id: NOTE_ID } }],
    ]) {
      const res = await call(handler, request);
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, { error: 'NOTES_UPSTREAM_ERROR' });
    }
  } finally {
    console.error = originalError;
  }
});

const hasDependencies = await import('@supabase/supabase-js').then(() => import('jose')).then(() => true, () => false);

test('starter login helper rejects missing, malformed, and foreign-issuer tokens on every route', {
  skip: hasDependencies ? false : '의존 패키지(@supabase/supabase-js, jose)가 설치되지 않아 건너뜀',
}, async () => {
  const db = fakeSupabase();
  const now = Math.floor(Date.now() / 1000);
  const foreign = forgedToken({ iss: 'https://evil.example/auth/v1', aud: 'authenticated',
    role: 'authenticated', sub: USER_A, exp: now + 600 });
  for (const authorization of [undefined, '', 'Bearer', 'Bearer not-a-jwt', `Basic ${foreign}`, `Bearer ${foreign}`]) {
    const headers = authorization === undefined ? {} : { authorization };
    for (const [handler, request] of [
      [collection, { method: 'GET', headers }],
      [collection, { method: 'POST', headers, body: { title: 't', body: 'b' } }],
      [item, { method: 'GET', headers, query: { id: NOTE_ID } }],
      [item, { method: 'PUT', headers, query: { id: NOTE_ID }, body: { title: 'x' } }],
      [item, { method: 'DELETE', headers, query: { id: NOTE_ID } }],
    ]) {
      const res = await call(handler, request);
      assert.equal(res.statusCode, 401, `${request.method} ${String(authorization).slice(0, 12)}`);
      assert.equal(res.body.error, 'LOGIN_REQUIRED');
    }
  }
  assert.equal(db.calls.length, 0);
});
