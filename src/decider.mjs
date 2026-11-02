// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다. (6단계: 기기 등록 규칙)
// 요청에서는 docs/DECIDER_REQUEST.md에 있는 이름(requestId, deviceRegistered)만 읽습니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
//
// device_registered: 엔진이 등록된 기기로 확인했을 때(deviceRegistered === true)만 허용합니다.
// 미등록이거나 값이 없거나 true가 아닌 모든 경우는 거부합니다(기본 거부).
export const RULE_IDS = Object.freeze(['device_registered']);

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
