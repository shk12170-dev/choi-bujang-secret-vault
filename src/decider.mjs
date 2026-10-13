// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 이 기본 응답은 모든 요청을 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
//
// 이 판정기는 docs/DECIDER_REQUEST.md 계약에 있는 이름만 읽습니다.
// 지금까지 읽는 값: requestId(응답에 그대로 돌려줌), deviceRegistered, method.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered']);

const RULE_STARTER_DENY = RULE_IDS[0];
const RULE_DEVICE_REGISTERED = RULE_IDS[1];

const answer = (requestId, decision, reasonCode, ruleId) => ({
  schema: 'aleph.decision.v1',
  requestId,
  decision,
  reasonCode,
  ruleIds: [ruleId],
});

export async function decide(request) {
  const requestId = request?.requestId;

  // 6단계 규칙 device_registered: 엔진이 확인한 기기가 등록 상태(true)일 때만 다음 조건을 봅니다.
  // 값이 false이거나 없거나 true가 아닌 다른 형태(문자열 "true", 숫자 1 등)이면 거부합니다.
  if (request?.deviceRegistered !== true) {
    return answer(requestId, 'deny', 'device_not_registered', RULE_DEVICE_REGISTERED);
  }

  // 등록 기기의 자료 읽기(GET)만 허용합니다. 엔진이 이미 서비스와 경로를 확인한 요청입니다.
  if (request?.method === 'GET') {
    return answer(requestId, 'allow', 'approved', RULE_DEVICE_REGISTERED);
  }

  // 그 밖의 요청은 아직 허용하는 규칙이 없으므로 기본 거부를 유지합니다.
  return answer(requestId, 'deny', 'starter_not_ready', RULE_STARTER_DENY);
}
