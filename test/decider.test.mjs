import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, readConnectionInfo, readRecentEvents, readStepUp, riskReasons, RULE_IDS } from '../src/decider.mjs';
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
  assert.deepEqual(RULE_IDS, ['device_registered', 'step_up_required']);
  assert.equal((await decide(normal)).decision, 'allow');
  const denied = await decide({ ...normal, deviceRegistered: false });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.reasonCode, 'device_not_registered');
});

const withSignals = (signals, recentEvents = [], extra = {}) => ({
  ...normal, requestId: crypto.randomUUID(), signals: { ...normal.signals, ...signals }, recentEvents, ...extra });
const heavy = [{ kind: 'read', ageSeconds: 30, count: 25 }];

test('a combined unusual event asks for extra verification and records the reasons', async () => {
  assert.deepEqual(riskReasons(suspicious), ['odd_hour', 'new_network', 'foreign_region', 'heavy_activity']);
  const out = await decide(suspicious);
  assert.deepEqual(out, { schema: 'aleph.decision.v1', requestId: suspicious.requestId,
    decision: 'step_up', reasonCode: 'step_up_required', ruleIds: ['step_up_required'] });
  const night = withSignals({ hour: 3, network: 'unusual' }, heavy);
  assert.deepEqual(riskReasons(night), ['odd_hour', 'new_network', 'heavy_activity']);
  assert.equal((await decide(night)).decision, 'step_up');
});

test('a normal event is allowed and no single signal blocks or challenges anyone', async () => {
  assert.deepEqual(riskReasons(normal), []);
  assert.equal((await decide(normal)).decision, 'allow');
  for (const request of [withSignals({ region: 'foreign' }), withSignals({ hour: 3 }),
    withSignals({ network: 'unusual' }), withSignals({}, heavy)]) {
    assert.equal(riskReasons(request).length, 1);
    const out = await decide(request);
    assert.equal(out.decision, 'allow', JSON.stringify(riskReasons(request)));
    assert.deepEqual(out.ruleIds, ['device_registered']);
  }
  // 오래된 사건은 세지 않고, 두 가지가 겹치면 추가 확인입니다.
  assert.deepEqual(riskReasons(withSignals({}, [{ kind: 'read', ageSeconds: 3600, count: 99 }])), []);
  assert.equal((await decide(withSignals({ region: 'foreign', hour: 2 }))).decision, 'step_up');
});

test('re-verified requests are allowed, and the device rule still comes first', async () => {
  const again = { ...suspicious, requestId: crypto.randomUUID(), stepUp: { verified: true, authAgeSeconds: 60 } };
  const out = await decide(again);
  assert.equal(out.decision, 'allow');
  assert.deepEqual(out.ruleIds, ['step_up_required']);
  const stale = { ...again, stepUp: { verified: true, authAgeSeconds: 901 } };
  assert.equal((await decide(stale)).decision, 'step_up');
  const unregistered = await decide({ ...suspicious, deviceRegistered: false });
  assert.equal(unregistered.decision, 'deny');
  assert.equal(unregistered.reasonCode, 'device_not_registered');
});

test('unverified or forged connection info never creates or hides a risk', async () => {
  const forgedHeaders = { ...normal, headers: { 'x-region': 'foreign', 'x-network': 'unusual' }, geo: { region: 'foreign' } };
  assert.equal((await decide(forgedHeaders)).decision, 'allow');
  for (const source of ['none', 'client', 'browser', undefined]) {
    const claimed = { ...suspicious, signals: { ...suspicious.signals, source } };
    assert.deepEqual(riskReasons(claimed), []);
    assert.equal((await decide(claimed)).decision, 'allow');
  }
  assert.equal((await decide({ ...suspicious, signals: undefined })).decision, 'allow');
});

test('every odd request still gets a well-formed answer from the listed rules', async () => {
  const keys = 'decision,reasonCode,requestId,ruleIds,schema';
  for (const request of [undefined, null, {}, 'x', 7, { requestId: 'r', deviceRegistered: 'true' },
    { ...suspicious, recentEvents: 'x' }, { ...suspicious, stepUp: 'x' }, { ...suspicious, signals: [] }]) {
    const out = await decide(request);
    assert.equal(Object.keys(out).sort().join(','), keys);
    assert.ok(['allow', 'deny', 'step_up'].includes(out.decision));
    assert.ok(out.ruleIds.length > 0 && out.ruleIds.every((id) => RULE_IDS.includes(id)));
  }
});
