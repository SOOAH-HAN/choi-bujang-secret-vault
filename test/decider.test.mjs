import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, readConnectionInfo, readRecentEvents, readStepUp, RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

// 가상 요청 연습입니다. 실제 반 엔진이나 심판의 판정이 아닙니다.
const { normal, suspicious } = fixtureRequests();

test('only engine-verified connection info is trusted, and nothing is filled with normal values', () => {
  assert.deepEqual(readConnectionInfo(normal), { trusted: true, region: 'local', network: 'usual', hour: 14 });
  const base = normal.signals;
  const cases = [
    [undefined, 'missing'], [null, 'missing'], ['x', 'missing'], [[], 'missing'],
    [{ ...base, source: 'none', region: 'unknown', network: 'unknown' }, 'no_signal'],
    [{ ...base, source: 'client' }, 'untrusted_source'],
    [{ ...base, source: 'x-forwarded' }, 'untrusted_source'],
    [{ ...base, source: undefined }, 'untrusted_source'],
    [{ ...base, region: undefined }, 'invalid'],
    [{ ...base, network: 7 }, 'invalid'],
    [{ ...base, hour: 24 }, 'invalid'],
    [{ ...base, hour: '3' }, 'invalid'],
    [{ ...base, hour: 3.5 }, 'invalid'],
    [{ ...base, region: 'FOREIGN!' }, 'invalid'],
  ];
  for (const [signals, reason] of cases) {
    assert.deepEqual(readConnectionInfo({ ...normal, signals }), { trusted: false, reason }, JSON.stringify(signals));
  }
  assert.deepEqual(readConnectionInfo(undefined), { trusted: false, reason: 'missing' });
});

test('forged client values are never promoted to trusted connection info', () => {
  const forged = { ...normal, signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 14 },
    headers: { 'x-forwarded-for': '203.0.113.9', 'x-region': 'local' },
    region: 'local', network: 'usual', geo: { region: 'local' }, device: { id: 'x' }, role: 'admin' };
  assert.equal(readConnectionInfo(forged).trusted, false);
  const claimed = { ...forged, signals: { ...forged.signals, source: 'browser' } };
  assert.equal(readConnectionInfo(claimed).trusted, false);
});

test('recent events keep only well-formed entries, at most twelve', () => {
  const good = { kind: 'risk_signal', ageSeconds: 60, count: 20 };
  const events = readRecentEvents({ recentEvents: [good, null, 'x', { ...good, kind: 'BAD KIND' },
    { ...good, ageSeconds: -1 }, { ...good, count: 1.5 }, { kind: 'a' }, { ...good, extra: 'ignored' }] });
  assert.deepEqual(events, [good, good]);
  assert.equal(readRecentEvents({ recentEvents: Array.from({ length: 40 }, () => good) }).length, 12);
  assert.deepEqual(readRecentEvents({ recentEvents: 'x' }), []);
  assert.deepEqual(readRecentEvents({}), []);
});

test('re-verification counts only when verified is true and the age is 0 to 900 seconds', () => {
  assert.equal(readStepUp({ stepUp: { verified: true, authAgeSeconds: 0 } }), true);
  assert.equal(readStepUp({ stepUp: { verified: true, authAgeSeconds: 900 } }), true);
  for (const stepUp of [{ verified: true, authAgeSeconds: 901 }, { verified: true, authAgeSeconds: -1 },
    { verified: true, authAgeSeconds: null }, { verified: 'true', authAgeSeconds: 5 },
    { verified: false, authAgeSeconds: null }, undefined, 'x']) {
    assert.equal(readStepUp({ stepUp }), false, JSON.stringify(stepUp));
  }
});

test('the device rule still decides as before', async () => {
  assert.deepEqual(RULE_IDS, ['device_registered']);
  assert.equal((await decide(normal)).decision, 'allow');
  const denied = await decide({ ...normal, deviceRegistered: false });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.reasonCode, 'device_not_registered');
});
