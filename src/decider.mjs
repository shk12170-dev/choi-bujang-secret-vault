// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 이 기본 응답은 모든 요청을 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
//
// 이 판정기는 docs/DECIDER_REQUEST.md 계약에 있는 이름만 읽습니다.
// 지금까지 읽는 값: requestId(응답에 그대로 돌려줌), deviceRegistered, method,
// 그리고 7단계의 접속 정보 signals, recentEvents, stepUp(출처 확인은 readAccessSignals가 맡음).
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered', 'step_up_required', 'zone_access']);

const RULE_STARTER_DENY = RULE_IDS[0];
const RULE_DEVICE_REGISTERED = RULE_IDS[1];
const RULE_STEP_UP_REQUIRED = RULE_IDS[2];
const RULE_ZONE_ACCESS = RULE_IDS[3];

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

// ---------------------------------------------------------------------------------------------
// 8단계 구역 규칙 zone_access: 자원을 서비스와 "정확한 경로 모양"으로 구역(메모·반 공지·강사 자료)으로 나눕니다.
//   메모       service `notes`    자료 ID 하나를 고르는 경로(/notes/:id 또는 /api/notes/:id)의 읽기(GET)만 허용.
//                                  ID 없는 전체 목록 경로와 모든 쓰기는 거부(주인 비교는 판정기가 아니라 API가 합니다).
//   반 공지    service `notices`  읽기(GET)만 허용. 쓰기(POST·PUT·PATCH·DELETE)는 누구에게나 거부합니다.
//                                  판정기 요청에는 역할이 없으므로 강사의 공지 수정은 서버의 관리 경로가 처리합니다.
//   강사 자료  service `instructor` 판정기에서 모두 거부합니다.
// 알 수 없는 서비스·경로, service와 경로가 다른 요청, route와 path가 다른 요청, 쿼리가 있는 요청은 거부합니다.
// 메모 ID의 형식(UUID 여부)은 좁히지 않습니다. 대신 한 깊이 아래의 경로 한 조각이 ID 자리에 오며,
// export·all 같은 기능 이름은 ID가 될 수 없습니다.
// ---------------------------------------------------------------------------------------------
const ZONE_BY_NAME = Object.freeze({ notes: 'memo', notices: 'notice', instructor: 'instructor' });
const FUNCTION_WORDS = Object.freeze(new Set([
  'export', 'import', 'all', 'admin', 'list', 'search', 'bulk', 'batch', 'backup', 'dump', 'download', 'upload',
  'new', 'mine', 'my', 'me', 'self', 'public', 'private', 'stats', 'count', 'sync', 'manage', 'instructor', 'notices', 'notes',
]));
const MAX_PATH_LENGTH = 200;

// 반환: { zone, shape, action, allowed, why }
//   zone   'memo' | 'notice' | 'instructor' | null(알 수 없는 자원)
//   shape  'list'(ID 없음) | 'item'(ID 하나) | null
//   allowed  구역 규칙이 이 요청을 통과시키는지. 통과해도 기기·추가 확인 규칙은 그대로 적용됩니다.
export function classifyZone(request) {
  const deny = (why, zone = null, shape = null) => ({ zone, shape, action: null, allowed: false, why });
  const path = request?.path;
  const method = request?.method;
  if (typeof path !== 'string' || typeof method !== 'string') return deny('path_or_method_missing');
  // 경로가 모호하면(쿼리·해시·인코딩·역슬래시·점 조각·중복·끝 슬래시·비ASCII·너무 긴 경로) 자원을 정하지 않습니다.
  if (path.length === 0 || path.length > MAX_PATH_LENGTH || path[0] !== '/' || /[?#\\%\u0000-\u001f\u007f-￿]/u.test(path)
      || path.includes('//') || (path.length > 1 && path.endsWith('/'))) return deny('path_ambiguous');
  const parts = path.slice(1).split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) return deny('path_ambiguous');
  const prefix = parts[0] === 'api' ? '/api' : '';
  const rest = prefix ? parts.slice(1) : parts;
  const zone = Object.hasOwn(ZONE_BY_NAME, rest[0] ?? '') ? ZONE_BY_NAME[rest[0]] : null;
  if (!zone) return deny('unknown_resource');
  if (request?.service !== rest[0]) return deny('service_path_mismatch', zone);
  let shape = null;
  if (rest.length === 1) shape = 'list';
  else if (rest.length === 2 && !FUNCTION_WORDS.has(rest[1].toLowerCase())) shape = 'item';
  if (!shape) return deny('path_shape_unknown', zone);
  // route는 "메서드 + 경로 모양"이며 path와 같은 모양이어야 합니다(:id 자리는 한 조각).
  const expectedRoute = `${method} ${prefix}/${rest[0]}${shape === 'item' ? '/:id' : ''}`;
  if (request?.route !== expectedRoute) return deny('route_path_mismatch', zone, shape);
  // 쿼리로 기능을 고르지 않습니다. 엔진은 쿼리 원문 대신 길이만 넘기므로 길이가 0이 아니면 거부합니다.
  if (request?.queryLength !== 0) return deny('query_not_allowed', zone, shape);

  const action = { GET: 'read', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[method] ?? null;
  if (!action) return deny('method_unknown', zone, shape);
  if (zone === 'instructor') return { zone, shape, action, allowed: false, why: 'instructor_denied' };
  if (zone === 'notice') {
    return { zone, shape, action, allowed: action === 'read', why: action === 'read' ? 'notice_read' : 'notice_write_denied' };
  }
  // 메모: ID 하나를 고르는 읽기만. 전체 목록과 쓰기는 거부합니다.
  if (shape === 'list') return { zone, shape, action, allowed: false, why: 'memo_list_denied' };
  return { zone, shape, action, allowed: action === 'read', why: action === 'read' ? 'memo_item_read' : 'memo_write_denied' };
}

export async function decide(request) {
  const requestId = request?.requestId;

  // 6단계 규칙 device_registered: 엔진이 확인한 기기가 등록 상태(true)일 때만 다음 조건을 봅니다.
  // 값이 false이거나 없거나 true가 아닌 다른 형태(문자열 "true", 숫자 1 등)이면 거부합니다.
  if (request?.deviceRegistered !== true) {
    return answer(requestId, 'deny', 'device_not_registered', RULE_DEVICE_REGISTERED);
  }

  // 8단계 규칙 zone_access: 등록 기기라도 구역·경로·동작이 허용표에 맞아야 합니다. 맞지 않으면 기본 거부입니다.
  // (이유 코드는 이미 쓰던 starter_not_ready를 유지하고, 어느 규칙이 거부했는지는 ruleIds로 구별합니다.)
  if (!classifyZone(request).allowed) {
    return answer(requestId, 'deny', 'starter_not_ready', RULE_ZONE_ACCESS);
  }

  // 구역 규칙을 통과한 읽기(GET)만 여기까지 옵니다.
  // 7단계 규칙 step_up_required: 평소와 다른 시각 + 처음 보는 네트워크 + 갑작스러운 읽기 급증이 모두 겹치면
  // 다시 확인(step_up)을 요청합니다. 지역만 다르거나 요소가 하나·둘뿐이면 이 규칙은 걸리지 않습니다.
  // 엔진이 새 로그인 시각을 검증해 stepUp.verified를 true(0~900초)로 넘긴 요청은 허용합니다.
  const access = describeStepUp(request);
  if (access.matched) {
    if (access.stepUp.verified) return answer(requestId, 'allow', 'approved', RULE_STEP_UP_REQUIRED);
    return answer(requestId, 'step_up', 'step_up_required', RULE_STEP_UP_REQUIRED);
  }
  return answer(requestId, 'allow', 'approved', RULE_ZONE_ACCESS);
}
