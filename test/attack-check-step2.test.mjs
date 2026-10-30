import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { runAttackChecks } from '../src/attack-check.mjs';

// 가상 요청 연습입니다. 실제 배포나 심판 판정이 아닙니다.
const config = {
  step: 2,
  publicAppUrl: 'https://student-defense.vercel.app',
  sampleMarker: 'SAMPLE_NOTE_1',
};
const SENTENCE = ['실습용', '가상', '과제', '기록'].join(' ');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function route(table) {
  globalThis.fetch = async (url, init) => {
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers, undefined);
    const hit = table[new URL(String(url)).pathname];
    return new Response(hit.body, { status: hit.status });
  };
}

test('step 2 attempts record only what was actually seen', async () => {
  route({
    '/data.json': { status: 404, body: 'NOT_FOUND' },
    '/': { status: 200, body: '<html>화면</html>' },
    '/aleph.json': { status: 200, body: '{"step":2}' },
    '/api/notes': { status: 200, body: JSON.stringify({ notes: [{ title: '가상', content: SENTENCE }] }) },
  });
  const attempts = await runAttackChecks(config);
  assert.deepEqual(attempts.map((item) => item.attackId),
    ['static_data_json_removed', 'static_pages_note_text', 'anonymous_api_notes_read']);
  assert.match(attempts[0].observed, /404/u);
  assert.match(attempts[1].observed, /보이지 않음/u);
  assert.match(attempts[2].observed, /메모 1건/u);
  assert.ok(!JSON.stringify(attempts).includes(SENTENCE), '메모 본문을 결과에 싣지 않습니다');
  for (const item of attempts) {
    assert.deepEqual(Object.keys(item).sort(), ['attackId', 'expected', 'observed']);
  }
});

test('step 2 reports exposed notes and unsent requests honestly', async () => {
  route({
    '/data.json': { status: 200, body: JSON.stringify({ notes: [{ title: 'a' }, { title: 'b' }] }) },
    '/': { status: 200, body: `<li>${SENTENCE}</li>` },
    '/aleph.json': { status: 200, body: '{}' },
    '/api/notes': { status: 401, body: '{}' },
  });
  const exposed = await runAttackChecks(config);
  assert.match(exposed[0].observed, /메모 2건이 보임/u);
  assert.match(exposed[1].observed, /문장이 보임/u);
  assert.match(exposed[2].observed, /HTTP 401/u);

  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const unsent = await runAttackChecks(config);
  assert.equal(unsent.length, 3);
  for (const item of unsent) assert.match(item.observed, /^미실행/u);
});

test('rejects placeholder addresses and unsupported steps', async () => {
  await assert.rejects(runAttackChecks({ ...config, publicAppUrl: 'https://replace-me.example' }));
  await assert.rejects(runAttackChecks({ ...config, step: 4 }));
});

// ---- 3단계 ----
const config3 = {
  ...config,
  step: 3,
  identityProvider: { issuer: 'https://example-project.supabase.co/auth/v1', audience: 'authenticated' },
};

function fakeServer(handle) {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.redirect, 'error');
    const path = new URL(String(url)).pathname;
    const call = { path, method: init.method ?? 'GET', auth: init.headers?.Authorization ?? null };
    seen.push(call);
    const hit = handle(call) ?? { status: 404, body: 'NOT_FOUND' };
    return new Response(hit.body, { status: hit.status,
      headers: hit.json ? { 'content-type': 'application/json' } : {} });
  };
  return seen;
}

const refuse = { status: 401, json: true, body: '{"error":"LOGIN_REQUIRED"}' };
const closedServer = (call) => {
  if (call.path === '/api/notes') return refuse;
  if (call.path === '/') return { status: 200, body: '<html>화면</html>' };
  if (call.path === '/aleph.json') return { status: 200, body: '{"step":3}' };
  return undefined;
};

test('step 3 records refusals of anonymous and fake-token requests', async () => {
  const seen = fakeServer(closedServer);
  const attempts = await runAttackChecks(config3);
  assert.deepEqual(attempts.map((item) => item.attackId), [
    'static_data_json_removed', 'static_pages_note_text', 'anonymous_note_add', 'anonymous_notes_list',
    'forged_signature_token', 'expired_token', 'wrong_audience_token']);
  for (const item of attempts.slice(2)) assert.match(item.observed, /^거부됨: HTTP 401, JSON/u);
  assert.ok(seen.some((call) => call.method === 'POST' && call.auth === null));
  assert.equal(seen.filter((call) => call.auth?.startsWith('Bearer ')).length, 3);
  const text = JSON.stringify(attempts);
  assert.ok(!text.includes('Bearer') && !text.includes('eyJ'), '토큰을 결과에 싣지 않습니다');
  for (const item of attempts) assert.deepEqual(Object.keys(item).sort(), ['attackId', 'expected', 'observed']);
});

test('step 3 reports a request that was not refused and unsent requests honestly', async () => {
  fakeServer((call) => (call.path === '/api/notes' && call.method === 'GET' && call.auth
    ? { status: 200, json: true, body: '[]' } : closedServer(call)));
  const open = await runAttackChecks(config3);
  assert.match(open.find((item) => item.attackId === 'forged_signature_token').observed, /^거부되지 않음: HTTP 200/u);
  assert.match(open.find((item) => item.attackId === 'anonymous_notes_list').observed, /^거부됨/u);

  fakeServer((call) => (call.path === '/api/notes' ? { status: 403, body: 'denied' } : closedServer(call)));
  const plain = await runAttackChecks(config3);
  assert.match(plain.at(-1).observed, /JSON이 아님/u);

  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const unsent = await runAttackChecks(config3);
  assert.equal(unsent.length, 7);
  for (const item of unsent) assert.match(item.observed, /^미실행/u);
});

test('step 3 needs identity provider info', async () => {
  await assert.rejects(runAttackChecks({ ...config3, identityProvider: undefined }));
});
