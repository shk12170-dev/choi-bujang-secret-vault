// 4단계: 메모 경로의 소유자 검사. login.userId는 서버가 검증한 토큰에서 온 값이고,
// DB의 owner_id와 비교해 본인 메모만 읽고·추가하고·고치고·지웁니다.
// URL·본문의 owner_id(ownerId·userId 포함)는 믿지 않습니다.
// 남의 메모와 없는 메모는 같은 404로 답해서 메모 번호가 존재하는지 알려 주지 않습니다.
import { databaseFailure, isUuid, memoView, readJsonBody, validateMemo } from './memo-api.mjs';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const notFound = response => response.status(404).json({ error: 'NOT_FOUND' });

// 목록(GET)과 추가(POST). 목록은 본인 메모만, 추가는 항상 확인된 사용자 ID로 저장합니다.
export async function collectionRoute(request, response, { login, db }) {
  if (request.method === 'GET') {
    const { data, error } = await db.from('user_notes').select('id, title, body')
      .eq('owner_id', login.userId).order('created_at', { ascending: true });
    if (error) return databaseFailure(response, error);
    return response.status(200).json(data.map(memoView));
  }

  const input = readJsonBody(request);
  if (!input) return response.status(400).json({ error: 'INVALID_JSON' });
  const checked = validateMemo(input, { requireTitle: true });
  if (checked.error) return response.status(400).json({ error: checked.error });
  if (input.id !== undefined && !isUuid(input.id)) return response.status(400).json({ error: 'INVALID_ID' });

  // 본문에 owner_id가 있어도 읽지 않고, 서버가 확인한 ID만 저장합니다.
  const row = { owner_id: login.userId, title: checked.value.title, body: checked.value.body ?? '' };
  if (input.id !== undefined) row.id = input.id.toLowerCase();
  const { data, error } = await db.from('user_notes').insert(row).select('id').single();
  if (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'ID_ALREADY_EXISTS' });
    return databaseFailure(response, error);
  }
  return response.status(201).json({ id: data.id });
}

// 한 건(GET·PUT·DELETE). 먼저 행을 읽어 owner_id가 본인인지 비교하고,
// 쓰기 쿼리에도 owner_id 조건을 한 번 더 걸어 확인과 변경 사이에 소유자가 달라지는 경우도 막습니다.
export async function memoRoute(request, response, { login, db }) {
  const id = String(request.query?.id ?? '').toLowerCase();
  if (!isUuid(id)) return notFound(response);

  let input = null;
  let checked = null;
  if (request.method === 'PUT') {
    input = readJsonBody(request);
    if (!input) return response.status(400).json({ error: 'INVALID_JSON' });
    // 소유자를 바꾸려는 값은 본인 ID와 같지 않으면 거부합니다. 수정 본문은 {title,body}만 씁니다.
    for (const key of ['owner_id', 'ownerId', 'userId']) {
      if (input[key] !== undefined && !same(input[key], login.userId)) {
        return response.status(403).json({ error: 'OWNER_CHANGE_NOT_ALLOWED' });
      }
    }
    checked = validateMemo(input, { requireTitle: false });
    if (checked.error) return response.status(400).json({ error: checked.error });
    if (!Object.keys(checked.value).length) return response.status(400).json({ error: 'NOTHING_TO_UPDATE' });
  }

  const found = await db.from('user_notes').select('id, owner_id, title, body').eq('id', id).maybeSingle();
  if (found.error) return databaseFailure(response, found.error);
  if (!found.data || !same(found.data.owner_id, login.userId)) return notFound(response);

  if (request.method === 'GET') return response.status(200).json(memoView(found.data));

  if (request.method === 'PUT') {
    const { data, error } = await db.from('user_notes')
      .update({ ...checked.value, updated_at: new Date().toISOString() })
      .eq('id', id).eq('owner_id', login.userId).select('id, owner_id, title, body').maybeSingle();
    if (error) return databaseFailure(response, error);
    // 기존 행과 새 행의 소유자가 모두 본인일 때만 성공으로 답합니다.
    if (!data || !same(data.owner_id, login.userId)) return notFound(response);
    return response.status(200).json(memoView(data));
  }

  const { data, error } = await db.from('user_notes').delete()
    .eq('id', id).eq('owner_id', login.userId).select('id').maybeSingle();
  if (error) return databaseFailure(response, error);
  if (!data) return notFound(response);
  return response.status(200).json({ id: data.id });
}
