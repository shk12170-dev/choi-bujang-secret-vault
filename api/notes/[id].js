// 3단계: 메모 한 건 조회(GET)·수정(PUT)·삭제(DELETE).
// 아직 소유자 검사를 하지 않아서, 로그인만 하면 다른 사람의 메모 ID로도 읽고 고칠 수 있습니다(4단계에서 막습니다).
import { databaseFailure, isUuid, memoView, readJsonBody, requireLogin, validateMemo } from '../../src/memo-api.mjs';

export default async function handler(request, response) {
  const context = await requireLogin(request, response, ['GET', 'PUT', 'DELETE']);
  if (!context) return undefined;
  const { db } = context;

  const id = String(request.query?.id ?? '').toLowerCase();
  if (!isUuid(id)) return response.status(404).json({ error: 'NOT_FOUND' });

  if (request.method === 'GET') {
    const { data, error } = await db.from('user_notes').select('id, title, body').eq('id', id).maybeSingle();
    if (error) return databaseFailure(response, error);
    if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
    return response.status(200).json(memoView(data));
  }

  if (request.method === 'PUT') {
    const input = readJsonBody(request);
    if (!input) return response.status(400).json({ error: 'INVALID_JSON' });
    const checked = validateMemo(input, { requireTitle: false });
    if (checked.error) return response.status(400).json({ error: checked.error });
    if (!Object.keys(checked.value).length) return response.status(400).json({ error: 'NOTHING_TO_UPDATE' });
    const { data, error } = await db.from('user_notes')
      .update({ ...checked.value, updated_at: new Date().toISOString() })
      .eq('id', id).select('id, title, body').maybeSingle();
    if (error) return databaseFailure(response, error);
    if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
    return response.status(200).json(memoView(data));
  }

  const { data, error } = await db.from('user_notes').delete().eq('id', id).select('id').maybeSingle();
  if (error) return databaseFailure(response, error);
  if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
  return response.status(200).json({ id: data.id });
}
