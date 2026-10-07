// 3단계: 로그인한 사용자의 메모 목록(GET)과 추가(POST).
// 로그인은 신원 확인일 뿐이며, /api/notes/:id의 소유자 검사는 4단계에서 붙입니다.
import { databaseFailure, isUuid, memoView, readJsonBody, requireLogin, validateMemo } from '../src/memo-api.mjs';

export default async function handler(request, response) {
  const context = await requireLogin(request, response, ['GET', 'POST']);
  if (!context) return undefined;
  const { login, db } = context;

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

  const row = { owner_id: login.userId, title: checked.value.title, body: checked.value.body ?? '' };
  if (input.id !== undefined) row.id = input.id.toLowerCase();
  const { data, error } = await db.from('user_notes').insert(row).select('id').single();
  if (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'ID_ALREADY_EXISTS' });
    return databaseFailure(response, error);
  }
  return response.status(201).json({ id: data.id });
}
