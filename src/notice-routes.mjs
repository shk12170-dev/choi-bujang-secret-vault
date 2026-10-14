// 8단계: 반 공지 경로와 강사의 관리 경로. 판정기와 별개로 API가 검증된 사용자와 서버가 관리하는 강사 권한을 다시 대조합니다.
//   학생용 공지 경로(/api/notices, /api/notices/:id): 로그인한 사용자 누구나 읽기만. 쓰기는 누구에게나 거부합니다.
//   강사 관리 경로(/api/admin/notices, /api/admin/notices/:id): 서버의 강사 허용 목록(INSTRUCTOR_USER_IDS)에 있는
//     검증된 로그인 사용자만 추가·수정합니다. 허용 목록이 비어 있으면 모두 거부합니다.
// 요청 본문·머리글·쿼리의 role, userId, instructor 같은 값과 화면 메뉴는 권한 근거로 읽지 않습니다.
// 거부 사유는 서버 로그에 짧게(자원·동작·사유 코드만) 남기며 사용자 ID·토큰·본문은 기록하지 않습니다.
import { databaseFailure, isUuid, readJsonBody, validateMemo } from './memo-api.mjs';

const noticeView = row => ({ id: row.id, title: row.title, body: row.body });

// 서버 환경변수의 강사 허용 목록(쉼표로 구분한 사용자 UUID). 값이 없거나 형식이 틀린 항목은 무시합니다.
export function instructorIds(source = process.env.INSTRUCTOR_USER_IDS) {
  const ids = new Set();
  if (typeof source !== 'string') return ids;
  for (const part of source.split(',')) {
    const id = part.trim().toLowerCase();
    if (isUuid(id)) ids.add(id);
  }
  return ids;
}

// 강사 여부: 서버가 검증한 학생 로그인(kind 'student')의 사용자 ID가 허용 목록에 있을 때만 참입니다.
// 심판용 신원(kind 'judge')이나 요청이 주장하는 역할은 강사로 보지 않습니다.
export function isInstructor(login, ids = instructorIds()) {
  return login?.kind === 'student' && typeof login.userId === 'string' && ids.has(login.userId.toLowerCase());
}

function deny(response, resource, action, reason, status = 403, error = 'FORBIDDEN') {
  console.warn(`notices: deny resource=${resource} action=${action} reason=${reason}`);
  return response.status(status).json({ error, reason });
}

// 학생용 공지 경로: 읽기만 있습니다.
export async function noticeRoute(request, response, { db }) {
  const method = request.method;
  const id = request.query?.id;
  const shape = id === undefined ? 'list' : 'item';
  const resource = `instructor.notice.${shape}`;
  if (method !== 'GET') {
    return deny(response, resource, method, 'notice_write_not_allowed_here');
  }
  if (shape === 'list') {
    const { data, error } = await db.from('class_notices').select('id, title, body').order('updated_at', { ascending: false });
    if (error) return databaseFailure(response, error);
    return response.status(200).json(data.map(noticeView));
  }
  const noticeId = String(id).toLowerCase();
  if (!isUuid(noticeId)) return response.status(404).json({ error: 'NOT_FOUND' });
  const { data, error } = await db.from('class_notices').select('id, title, body').eq('id', noticeId).maybeSingle();
  if (error) return databaseFailure(response, error);
  if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
  return response.status(200).json(noticeView(data));
}

// 강사 관리 경로: 서버의 강사 허용 목록에 있는 검증된 로그인 사용자만 통과합니다.
export async function adminNoticeRoute(request, response, { login, db }) {
  const method = request.method;
  const id = request.query?.id;
  const shape = id === undefined ? 'list' : 'item';
  const resource = `instructor.notice.admin.${shape}`;
  const action = method === 'POST' ? 'create' : 'update';

  const ids = instructorIds();
  if (!isInstructor(login, ids)) {
    // 목록이 비어 있어도 같은 응답입니다. 서버 로그에는 사유를 나눠 남깁니다.
    return deny(response, resource, action, ids.size === 0 ? 'instructor_list_not_configured' : 'instructor_required');
  }

  const input = readJsonBody(request);
  if (!input) return response.status(400).json({ error: 'INVALID_JSON' });
  const checked = validateMemo(input, { requireTitle: method === 'POST' });
  if (checked.error) return response.status(400).json({ error: checked.error });

  if (method === 'POST') {
    const row = { title: checked.value.title, body: checked.value.body ?? '', updated_by: login.userId };
    const { data, error } = await db.from('class_notices').insert(row).select('id').single();
    if (error) return databaseFailure(response, error);
    return response.status(201).json({ id: data.id });
  }

  const noticeId = String(id).toLowerCase();
  if (!isUuid(noticeId)) return response.status(404).json({ error: 'NOT_FOUND' });
  if (!Object.keys(checked.value).length) return response.status(400).json({ error: 'NOTHING_TO_UPDATE' });
  const { data, error } = await db.from('class_notices')
    .update({ ...checked.value, updated_by: login.userId, updated_at: new Date().toISOString() })
    .eq('id', noticeId).select('id, title, body').maybeSingle();
  if (error) return databaseFailure(response, error);
  if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
  return response.status(200).json(noticeView(data));
}
