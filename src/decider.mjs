// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다. (6단계: 기기 등록 규칙, 7단계: 입력 출처 검사)
// 요청에서는 docs/DECIDER_REQUEST.md에 있는 이름만 읽습니다. 헤더·쿠키·본문 같은 브라우저 값은 읽지 않습니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
//
// device_registered: 엔진이 등록된 기기로 확인했을 때(deviceRegistered === true)만 허용합니다.
// 미등록이거나 값이 없거나 true가 아닌 모든 경우는 거부합니다(기본 거부).
export const RULE_IDS = Object.freeze(['device_registered']);

// ---- 7단계 제작 1: 접속 정보의 출처와 모양을 검사합니다 ----
// 신뢰하는 출처는 엔진이 검증해 넘긴 가상 접속 정보(judge_fixture)뿐입니다.
// 'none'(현재 실제 경로)이거나 모르는 출처이거나 값이 없거나 모양이 틀리면 '근거 없음'입니다.
// 근거가 없을 때 임의의 정상값으로 채우지 않고, 위험하다고 단정하지도 않습니다.
const TRUSTED_SOURCES = Object.freeze(['judge_fixture']);
const WORD = /^[a-z][a-z0-9_-]{0,31}$/u;
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function readConnectionInfo(request) {
  const signals = request?.signals;
  if (!isPlainObject(signals)) return { trusted: false, reason: 'missing' };
  if (typeof signals.source !== 'string' || !TRUSTED_SOURCES.includes(signals.source)) {
    return { trusted: false, reason: signals.source === 'none' ? 'no_signal' : 'untrusted_source' };
  }
  const { region, network, hour } = signals;
  if (typeof region !== 'string' || !WORD.test(region)
      || typeof network !== 'string' || !WORD.test(network)
      || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { trusted: false, reason: 'invalid' };
  }
  return { trusted: true, region, network, hour };
}

// 엔진이 준 최근 사건. 모양이 틀린 항목은 버리고 최대 12건만 봅니다. 없으면 빈 배열입니다.
export function readRecentEvents(request) {
  const events = request?.recentEvents;
  if (!Array.isArray(events)) return [];
  return events.slice(0, 12).filter((event) => isPlainObject(event)
    && typeof event.kind === 'string' && WORD.test(event.kind)
    && Number.isFinite(event.ageSeconds) && event.ageSeconds >= 0 && event.ageSeconds <= 86400
    && Number.isInteger(event.count) && event.count >= 0 && event.count <= 100000)
    .map(({ kind, ageSeconds, count }) => ({ kind, ageSeconds, count }));
}

// 다시 확인했다는 표시: verified가 true이고 나이가 0~900초일 때만 인정합니다.
export function readStepUp(request) {
  const stepUp = request?.stepUp;
  return isPlainObject(stepUp) && stepUp.verified === true
    && Number.isInteger(stepUp.authAgeSeconds) && stepUp.authAgeSeconds >= 0 && stepUp.authAgeSeconds <= 900;
}

export async function decide(request) {
  const registered = request?.deviceRegistered === true;
  return {
    schema: 'aleph.decision.v1',
    requestId: request?.requestId,
    decision: registered ? 'allow' : 'deny',
    reasonCode: registered ? 'approved' : 'device_not_registered',
    ruleIds: [RULE_IDS[0]],
  };
}
