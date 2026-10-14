// 8단계: 자료실의 자원을 구역(zone)으로 나누고, 요청마다 서버가 구별할 수 있는 자원 ID를 붙이는 구분표입니다.
// 메모와 강사 공지는 서로 다른 자원 ID를 가지며, 미등록 경로·모호한 경로·기능 문자열이 섞인 경로는 null(거부 대상)입니다.
// API(src/memo-api.mjs)와 판정기(src/decider.mjs의 경로 허용표)가 같은 구분을 쓰도록 이 표를 기준으로 시험합니다.
// 사용자·기기·권한 값은 여기서 만들지 않습니다. 이 파일은 "무슨 자원인가"만 구별합니다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// 자원 종류: 구역과 소유 방식. owner는 자료가 누구의 것인지 서버가 확인해야 하는 방식입니다.
//   self        요청한 로그인 사용자 본인의 자료만(저장된 owner_id와 서버가 검증한 사용자 대조)
//   instructor  서버가 관리하는 강사 권한으로만 수정(읽기는 로그인한 학생 모두)
export const RESOURCE_KINDS = Object.freeze({
  'student.memo': Object.freeze({ zone: 'student', owner: 'self', base: ['api', 'notes'] }),
  'instructor.notice': Object.freeze({ zone: 'instructor', owner: 'instructor', base: ['api', 'notices'] }),
  // 강사의 공지 수정은 판정기가 아니라 서버의 관리 경로가 처리합니다. 학생용 공지 경로(/api/notices)와 다른 갈래이며,
  // 수정(PUT)·추가(POST)만 있고 읽기는 없습니다. 서버가 관리하는 강사 허용 목록으로만 통과합니다.
  'instructor.notice.admin': Object.freeze({
    zone: 'instructor', owner: 'instructor', base: ['api', 'admin', 'notices'],
    actions: Object.freeze({ list: Object.freeze({ POST: 'create' }), item: Object.freeze({ PUT: 'update' }) }),
  }),
});

// 메서드 → 동작. 목록(list)에는 읽기·추가만, 한 건(item)에는 읽기·수정·삭제만 둡니다.
const ACTIONS = Object.freeze({
  list: Object.freeze({ GET: 'read', POST: 'create' }),
  item: Object.freeze({ GET: 'read', PUT: 'update', DELETE: 'delete' }),
});

// 경로 문자열을 정확히 조각으로 나눕니다. 모호하면 null:
//   쿼리·해시, 연속 슬래시, 끝 슬래시, 점 조각(.·..), 인코딩된 구분자, 제어·비ASCII 문자가 있는 경로
function segmentsOf(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200 || path[0] !== '/') return null;
  if (/[?#\\%\u0000-\u001f\u007f-￿]/u.test(path)) return null;
  if (path.includes('//') || path.length > 1 && path.endsWith('/')) return null;
  const parts = path.slice(1).split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) return null;
  return parts;
}

// 반환: { resourceId, kind, zone, owner, shape: 'list'|'item', itemId, action } 또는 null
//   null은 "허용표에 없는 자원"이며 호출한 쪽은 거부해야 합니다.
export function resolveResource(method, path) {
  const parts = segmentsOf(path);
  if (!parts || typeof method !== 'string') return null;
  for (const [kind, info] of Object.entries(RESOURCE_KINDS)) {
    const depth = info.base.length;
    if (!info.base.every((segment, index) => parts[index] === segment)) continue;
    let shape = null;
    let itemId = null;
    if (parts.length === depth) shape = 'list';
    else if (parts.length === depth + 1 && UUID.test(parts[depth])) { shape = 'item'; itemId = parts[depth].toLowerCase(); }
    if (!shape) return null; // export·admin·all 같은 기능 문자열이나 UUID가 아닌 값이 :id 자리에 온 경우
    const action = (info.actions ?? ACTIONS)[shape][method] ?? null;
    if (!action) return null;
    return { resourceId: `${kind}.${shape}`, kind, zone: info.zone, owner: info.owner, shape, itemId, action };
  }
  return null;
}

// 요청 객체(Vercel 함수의 request.url에 경로와 쿼리가 함께 있음)에서 자원을 구별합니다.
// 쿼리가 붙어 있어도 자원 ID는 경로로만 정해지며, 쿼리가 있었다는 사실만 표시합니다.
export function resourceOfRequest(request) {
  const url = typeof request?.url === 'string' ? request.url : '';
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const found = resolveResource(request?.method, path);
  return found ? { ...found, hasQuery: queryAt !== -1 } : null;
}

export const RESOURCE_IDS = Object.freeze(
  Object.keys(RESOURCE_KINDS).flatMap(kind => [`${kind}.list`, `${kind}.item`]),
);
