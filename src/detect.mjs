// 9단계에서 학생이 채우는 탐지 함수입니다. 이 기본값은 어떤 접속도 회수하지 않습니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
//
// 이번 단계의 입력 처리(readDetectionEvents): 제공된 가상 사건에서 아래 네 가지만 읽습니다.
//   가명 사용자  identity.sub(탐지 연습 계약) 또는 subjectId(판정기 요청 계약의 가명 주체 ID)
//   기기         deviceId(16자리 소문자 16진수) — 없으면 null
//   요청 종류    method(GET·POST·PUT·PATCH·DELETE)
//   판정         decision(allow·deny·step_up) — 없으면 null
//   네트워크     network(엔진이 붙인 'usual'·'unusual' 같은 한 단어) 또는 signals.network — 없거나 'unknown'이면 null
// 지역(region)은 읽지 않습니다. 지역 하나만으로는 어떤 판단도 하지 않기 때문입니다.
// 시각(at)은 사건을 구간으로 묶기 위해 함께 읽습니다. 그 밖의 필드(메모 제목·본문, 토큰·머리글·쿠키, 이름·이메일,
// 경로·쿼리 원문 등)는 이름이 무엇이든 읽지 않고 복사하지 않으며 결과에도, 오류 메시지에도 나타나지 않습니다.
// 값이 없거나 형식이 맞지 않는 사건은 임의의 값으로 채우지 않고 버리며, 버린 사건의 수와 사유 코드만 남깁니다.

const METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const DECISIONS = Object.freeze(['allow', 'deny', 'step_up']);
const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
// 가명 ID는 영문·숫자·밑줄·콜론·점·하이픈만 허용합니다. 공백·한글(실명)·@(이메일)이 섞인 값은 사용자 식별자로 읽지 않습니다.
const PSEUDONYM = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u;
const DEVICE_ID = /^[0-9a-f]{16}$/u;
const NETWORK_WORD = /^[a-z][a-z0-9_-]{0,31}$/u;
const MAX_EVENTS = 20000;

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// 반환: { events: [{ at, atMs, subject, deviceId, method, decision, network }], dropped, droppedBy: { 사유 코드: 건수 }, truncated }
//   events는 입력 순서를 유지하며 위 일곱 이름만 가집니다.
export function readDetectionEvents(input) {
  if (!Array.isArray(input)) throw new TypeError('invalid_detection_events');
  const events = [];
  const droppedBy = {};
  const drop = reason => { droppedBy[reason] = (droppedBy[reason] ?? 0) + 1; };

  const limit = Math.min(input.length, MAX_EVENTS);
  for (let index = 0; index < limit; index += 1) {
    const raw = input[index];
    if (!isPlainObject(raw)) { drop('event_not_object'); continue; }

    const at = raw.at;
    if (typeof at !== 'string' || at.length > 40 || !ISO_AT.test(at)) { drop('at_invalid'); continue; }
    const atMs = Date.parse(at);
    if (!Number.isFinite(atMs)) { drop('at_invalid'); continue; }

    const method = raw.method;
    if (typeof method !== 'string' || !METHODS.includes(method)) { drop('method_invalid'); continue; }

    // 가명 사용자: identity.sub를 먼저, 없으면 subjectId. 둘 다 없거나 형식이 맞지 않으면 사용자 없는 사건은 버립니다.
    const candidate = isPlainObject(raw.identity) && raw.identity.sub !== undefined ? raw.identity.sub : raw.subjectId;
    if (typeof candidate !== 'string' || !PSEUDONYM.test(candidate)) { drop('subject_invalid'); continue; }

    const deviceId = typeof raw.deviceId === 'string' && DEVICE_ID.test(raw.deviceId) ? raw.deviceId : null;
    const decision = typeof raw.decision === 'string' && DECISIONS.includes(raw.decision) ? raw.decision : null;
    const networkRaw = raw.network !== undefined ? raw.network : (isPlainObject(raw.signals) ? raw.signals.network : undefined);
    const network = typeof networkRaw === 'string' && NETWORK_WORD.test(networkRaw) && networkRaw !== 'unknown' ? networkRaw : null;

    events.push({ at: new Date(atMs).toISOString(), atMs, subject: candidate, deviceId, method, decision, network });
  }
  const truncated = input.length > MAX_EVENTS;
  if (truncated) droppedBy.too_many_events = input.length - MAX_EVENTS;
  const dropped = Object.values(droppedBy).reduce((sum, count) => sum + count, 0);
  return { events, dropped, droppedBy, truncated };
}

// 탐지 규칙 burst_read(학습용 기준값, 보편 기준이 아님)
//   다량 조회: 같은 가명 사용자의 GET 사건이 어느 10분 구간(양 끝 포함)에서든 120건을 넘는 경우. 정확히 120건은 해당하지 않습니다.
//   복합 조건: 사건에 네트워크 값이 있으면 그 10분 구간에 처음 보는 네트워크('unusual')가 함께 있어야 합니다.
//     평소 네트워크('usual')만 있는 다량 조회는 정상 사건으로 두고 회수를 제안하지 않습니다.
//   네트워크 값이 전혀 없는 사건(탐지 연습 계약 모양)은 계약대로 다량 조회만 봅니다.
//   지역은 읽지 않으므로 지역만 다른 사건은 판단에 영향이 없습니다. 다른 사용자의 사건을 합산하지 않습니다.
const WINDOW_MS = 10 * 60 * 1000;
const BURST_OVER = 120;
const UNUSUAL_NETWORK = 'unusual';

function suspiciousSubjects(events) {
  const bySubject = new Map();
  for (const event of events) {
    if (event.method !== 'GET') continue;
    if (!bySubject.has(event.subject)) bySubject.set(event.subject, []);
    bySubject.get(event.subject).push(event);
  }
  const found = [];
  for (const [subject, list] of bySubject) {
    if (list.length <= BURST_OVER) continue;
    list.sort((a, b) => a.atMs - b.atMs);
    // 양 끝 시각이 10분 이내인 연속 구간을 두 포인터로 훑습니다.
    let left = 0;
    for (let right = 0; right < list.length; right += 1) {
      while (list[right].atMs - list[left].atMs > WINDOW_MS) left += 1;
      if (right - left + 1 <= BURST_OVER) continue;
      // 기기 판별에는 이 구간의 시작점에서 10분 안에 든 사건 전체를 씁니다(처음 120건을 넘긴 시점까지만 보면 한쪽으로 치우칠 수 있음).
      let end = right;
      while (end + 1 < list.length && list[end + 1].atMs - list[left].atMs <= WINDOW_MS) end += 1;
      const window = list.slice(left, end + 1);
      const networkKnown = window.some(event => event.network !== null);
      const unusual = window.some(event => event.network === UNUSUAL_NETWORK);
      if (!networkKnown || unusual) {
        found.push({ subject, startMs: list[left].atMs, window });
        break;
      }
    }
  }
  return found.sort((a, b) => a.startMs - b.startMs || a.subject.localeCompare(b.subject));
}

// 회수를 제안할 "확인된 가상 기기 한 개"를 정합니다. 확인되지 않으면 범위를 넓혀 제안하지 않습니다.
//   후보: 의심 구간 안에서 처음 보는 네트워크의 사건이 있으면 그 사건들의 기기, 없으면 구간 안 사건들의 기기
//   - 후보 사건이 모두 같은 기기를 달고 오면 그 기기
//   - 기기가 여러 개면 조회가 가장 많은 기기(동률이면 정할 수 없음)
//   - 일부 사건에만 기기 값이 있으면 어느 기기의 사건인지 알 수 없으므로 정할 수 없음
//   - 기기 값이 아예 없으면(탐지 연습 계약 모양) 기기 한정은 없음
function targetDevice(window) {
  const unusual = window.filter(event => event.network === UNUSUAL_NETWORK);
  const pool = unusual.length > 0 ? unusual : window;
  const withDevice = pool.filter(event => event.deviceId !== null);
  if (withDevice.length === 0) return { kind: 'none' };
  if (withDevice.length !== pool.length) return { kind: 'ambiguous' };
  const counts = new Map();
  for (const event of pool) counts.set(event.deviceId, (counts.get(event.deviceId) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return { kind: 'ambiguous' };
  return { kind: 'device', deviceId: ranked[0][0] };
}

// 탐지 결과(접속 허용·거부 응답과는 별개의 결과)입니다.
//   { action: 'observe' }
//   { action: 'propose_revocation', reasonCode: 'burst_read', subject }                 기기 값이 없는 사건(연습 계약)
//   { action: 'propose_revocation', reasonCode: 'burst_read', subject, deviceId }       확인된 가상 기기 한 개로 한정
// 이 함수는 회수를 제안만 합니다. 회수 API를 부르거나 기기 권한을 바꾸지 않으며, 실제 회수와 경과 시간은 심판이 확인합니다.
export function detect(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  const { events: read } = readDetectionEvents(events);
  for (const suspect of suspiciousSubjects(read)) {
    const target = targetDevice(suspect.window);
    if (target.kind === 'ambiguous') continue; // 기기를 하나로 정할 수 없으면 사용자 전체로 넓혀 제안하지 않습니다.
    // 결과에는 사용자·기기 식별자와 이유 코드만 담습니다. 사건 내용·네트워크·시각·토큰은 넣지 않습니다.
    if (target.kind === 'device') {
      return { action: 'propose_revocation', reasonCode: 'burst_read', subject: suspect.subject, deviceId: target.deviceId };
    }
    return { action: 'propose_revocation', reasonCode: 'burst_read', subject: suspect.subject };
  }
  return { action: 'observe' };
}
