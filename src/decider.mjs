// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 이 기본 응답은 모든 요청을 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
//
// 이 판정기는 docs/DECIDER_REQUEST.md 계약에 있는 이름만 읽습니다.
// 지금까지 읽는 값: requestId(응답에 그대로 돌려줌), deviceRegistered, method,
// 그리고 7단계의 접속 정보 signals, recentEvents, stepUp(출처 확인은 readAccessSignals가 맡음).
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered', 'step_up_required']);

const RULE_STARTER_DENY = RULE_IDS[0];
const RULE_DEVICE_REGISTERED = RULE_IDS[1];
const RULE_STEP_UP_REQUIRED = RULE_IDS[2];

// 7단계 규칙 step_up_required의 학습용 기준값입니다(보편 기준이 아님).
// 세 가지가 모두 겹칠 때만 추가 확인을 보냅니다. 하나만으로는 보내지 않고, 이 규칙은 거부(deny)를 만들지 않습니다.
const USUAL_HOURS = Object.freeze({ from: 7, to: 21 }); // 이 범위 밖의 시각이 평소와 다른 시각
const UNUSUAL_NETWORK = 'unusual'; // 엔진이 처음 보는 네트워크라고 표시한 값
const BURST_KINDS = Object.freeze(['risk_signal']); // 갑작스러운 읽기 급증으로 엔진이 보고한 사건 종류
const BURST_WINDOW_SECONDS = 600;
const BURST_MIN_COUNT = 10;

const answer = (requestId, decision, reasonCode, ruleId) => ({
  schema: 'aleph.decision.v1',
  requestId,
  decision,
  reasonCode,
  ruleIds: [ruleId],
});

// ---------------------------------------------------------------------------------------------
// 7단계 입력 검사: 접속 정보(지역·시각·네트워크·행동)의 출처를 구분합니다. 규칙은 아직 쓰지 않습니다.
// 접속 정보는 엔진이 만들어 넘긴 signals, recentEvents, stepUp 세 이름에서만 읽습니다.
// 요청에 계약 밖의 이름(클라이언트 헤더, 위치 값 등)이 붙어 있어도 읽지 않고 출처 불명으로 기록만 합니다.
// 값이 없거나 형태가 맞지 않거나 출처가 불명확하면 null/빈 목록으로 두며, 임의의 정상값으로 채우지 않습니다.
// ---------------------------------------------------------------------------------------------
const CONTRACT_NAMES = Object.freeze([
  'schema', 'requestId', 'classId', 'projectId', 'subjectId', 'deviceId', 'service', 'method', 'path',
  'route', 'queryLength', 'querySha256', 'at', 'policyRevision', 'deviceRegistered', 'stepUp',
  'recentEvents', 'signals',
]);
const MAX_RECENT_EVENTS = 12;
const MAX_AUTH_AGE_SECONDS = 900;
const WORD = /^[a-z][a-z0-9_-]{0,31}$/u;

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;

// 반환: { trust, usable, source, region, network, hour, recentEvents, stepUp, problems }
//   trust  'fixture'   엔진이 넘긴 심판의 가상 사건(규칙 시험에는 쓰지만 실제 위치 증거가 아님)
//          'none'      실제 경로. 위치·네트워크 근거가 없다는 뜻이며 정상으로 간주하지 않음
//          'untrusted' 출처가 없거나 알 수 없는 값. 어떤 값도 판단에 쓰지 않음
//   usable 규칙이 지역·시각·네트워크 값을 근거로 쓸 수 있는지(trust가 'fixture'이고 값이 형식에 맞을 때)
export function readAccessSignals(request) {
  const problems = [];
  const empty = {
    trust: 'untrusted', usable: false, source: null, region: null, network: null, hour: null,
    recentEvents: [], stepUp: { verified: false, authAgeSeconds: null }, problems,
  };
  if (!isPlainObject(request)) {
    problems.push('request_not_object');
    return empty;
  }
  // 계약에 없는 이름은 읽지 않습니다. 값은 기록하지 않고 이름 개수만 남깁니다.
  const extra = Object.keys(request).filter(name => !CONTRACT_NAMES.includes(name));
  if (extra.length) problems.push(`undeclared_names:${extra.length}`);

  // stepUp: 검증됨(true)일 때만 나이(0~900초)가 있어야 합니다. 형태가 맞지 않으면 검증되지 않은 것으로 봅니다.
  const stepUp = request?.stepUp;
  if (isPlainObject(stepUp) && stepUp.verified === true && Number.isSafeInteger(stepUp.authAgeSeconds)
      && stepUp.authAgeSeconds >= 0 && stepUp.authAgeSeconds <= MAX_AUTH_AGE_SECONDS) {
    empty.stepUp = { verified: true, authAgeSeconds: stepUp.authAgeSeconds };
  } else if (!(isPlainObject(stepUp) && stepUp.verified === false && stepUp.authAgeSeconds === null)) {
    problems.push('step_up_invalid');
  }

  // recentEvents: 최대 12건, 각 항목은 {kind, ageSeconds, count}. 목록 형태가 틀리면 비워 둡니다.
  const events = request?.recentEvents;
  if (Array.isArray(events) && events.length <= MAX_RECENT_EVENTS) {
    const valid = events.filter(item => isPlainObject(item) && WORD.test(item.kind ?? '')
      && isCount(item.ageSeconds) && isCount(item.count));
    if (valid.length !== events.length) problems.push('recent_events_invalid_items');
    empty.recentEvents = valid.map(({ kind, ageSeconds, count }) => ({ kind, ageSeconds, count }));
  } else {
    problems.push('recent_events_invalid');
  }

  // signals: source가 출처입니다. 지역·네트워크·시각은 출처가 확인된 경우에만 값으로 받습니다.
  const signals = request?.signals;
  if (!isPlainObject(signals) || typeof signals.source !== 'string') {
    problems.push('signals_missing_or_invalid');
    return empty;
  }
  empty.source = WORD.test(signals.source) ? signals.source : null;
  if (signals.source === 'none') {
    // 실제 경로: 근거 없음. 같이 온 값이 있어도 위치 증거로 쓰지 않습니다.
    empty.trust = 'none';
    return empty;
  }
  if (signals.source !== 'judge_fixture') {
    problems.push('signals_source_unknown');
    return empty;
  }
  empty.trust = 'fixture';
  const word = value => (typeof value === 'string' && WORD.test(value) && value !== 'unknown' ? value : null);
  empty.region = word(signals.region);
  empty.network = word(signals.network);
  empty.hour = Number.isSafeInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23 ? signals.hour : null;
  if (empty.region === null) problems.push('region_unknown');
  if (empty.network === null) problems.push('network_unknown');
  if (empty.hour === null) problems.push('hour_unknown');
  empty.usable = empty.region !== null && empty.network !== null && empty.hour !== null;
  return empty;
}

// 추가 확인 사유를 요소별로 돌려줍니다. 판정과 시험·문서가 같은 근거를 보게 하려는 것이며 값(주소 등)은 담지 않습니다.
// 반환: { evaluated, factors: { unusual_hour, unusual_network, read_burst }, region_foreign, matched }
//   evaluated  출처가 확인된 가상 사건이라 세 요소를 평가할 수 있는지(readAccessSignals의 usable)
//   region_foreign  지역이 평소와 다르다는 참고 표시. 이 값만으로는 어떤 결정도 바뀌지 않음
export function describeStepUp(request) {
  const access = readAccessSignals(request);
  const factors = { unusual_hour: false, unusual_network: false, read_burst: false };
  if (access.usable) {
    factors.unusual_hour = access.hour < USUAL_HOURS.from || access.hour > USUAL_HOURS.to;
    factors.unusual_network = access.network === UNUSUAL_NETWORK;
    const burst = access.recentEvents
      .filter(item => BURST_KINDS.includes(item.kind) && item.ageSeconds <= BURST_WINDOW_SECONDS)
      .reduce((sum, item) => sum + item.count, 0);
    factors.read_burst = burst >= BURST_MIN_COUNT;
  }
  return {
    evaluated: access.usable,
    factors,
    region_foreign: access.usable && access.region === 'foreign',
    matched: access.usable && factors.unusual_hour && factors.unusual_network && factors.read_burst,
    stepUp: access.stepUp,
  };
}

export async function decide(request) {
  const requestId = request?.requestId;

  // 6단계 규칙 device_registered: 엔진이 확인한 기기가 등록 상태(true)일 때만 다음 조건을 봅니다.
  // 값이 false이거나 없거나 true가 아닌 다른 형태(문자열 "true", 숫자 1 등)이면 거부합니다.
  if (request?.deviceRegistered !== true) {
    return answer(requestId, 'deny', 'device_not_registered', RULE_DEVICE_REGISTERED);
  }

  // 등록 기기의 자료 읽기(GET)만 다음으로 넘어갑니다. 엔진이 이미 서비스와 경로를 확인한 요청입니다.
  if (request?.method === 'GET') {
    // 7단계 규칙 step_up_required: 평소와 다른 시각 + 처음 보는 네트워크 + 갑작스러운 읽기 급증이 모두 겹치면
    // 다시 확인(step_up)을 요청합니다. 지역만 다르거나 요소가 하나·둘뿐이면 이 규칙은 걸리지 않습니다.
    // 엔진이 새 로그인 시각을 검증해 stepUp.verified를 true(0~900초)로 넘긴 요청은 허용합니다.
    const access = describeStepUp(request);
    if (access.matched) {
      if (access.stepUp.verified) return answer(requestId, 'allow', 'approved', RULE_STEP_UP_REQUIRED);
      return answer(requestId, 'step_up', 'step_up_required', RULE_STEP_UP_REQUIRED);
    }
    return answer(requestId, 'allow', 'approved', RULE_DEVICE_REGISTERED);
  }

  // 그 밖의 요청은 아직 허용하는 규칙이 없으므로 기본 거부를 유지합니다.
  return answer(requestId, 'deny', 'starter_not_ready', RULE_STARTER_DENY);
}
