// 10단계 제작 3: 비공개 가상 메모 사본(note_backups)에서 지정한 한 건만 복원하는 POST 경로의 규칙입니다.
// 서비스: notes · 경로: POST /api/notes/restore · 본문: { "id": "<복원할 메모 UUID>" } 하나뿐
//
// 대조 순서(하나라도 어긋나면 아무것도 쓰지 않습니다)
//   1. 로그인(서버가 검증한 토큰)에서 사용자 ID를 얻습니다. 본문의 owner_id·userId는 읽지 않고 본문에 다른 이름이 있으면 거부합니다.
//   2. 사본 한 건을 ID로 읽고, 사본의 소유자가 로그인한 사용자와 같은지 대조합니다. 아니면 없는 사본과 똑같이 404로 답합니다.
//   3. 사본의 내용 해시(content_sha256)가 사본의 제목·본문으로 다시 계산한 값과 같은지 대조합니다(사본 손상 확인).
//   4. 현재 메모가 있으면 소유자가 사본의 소유자와 같을 때만 그 한 건의 제목·본문을 사본 값으로 되돌립니다.
//      현재 메모가 없으면 사본의 ID·소유자·내용으로 다시 만듭니다.
//   5. 쓴 뒤 다시 읽어 ID·소유자·내용 해시가 사본과 같은지 확인하고, 같을 때만 성공으로 답합니다.
// 다른 메모는 읽지도 쓰지도 않습니다. 감사 기록(note_restore_audit)은 한 줄 덧붙이기만 합니다. 응답에는 메모 본문을 싣지 않습니다.
import { createHash } from 'node:crypto';
import { isUuid, readJsonBody } from './memo-api.mjs';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const HEX64 = /^[0-9a-f]{64}$/u;

// 서버 로그에만 남기는 거부 사유(자원·동작·사유 코드). 사용자 ID·메모 내용은 기록하지 않습니다.
const logDeny = reason => console.warn(`memo: deny resource=student.memo.restore action=restore reason=${reason}`);
const notFound = response => response.status(404).json({ error: 'NOT_FOUND' });

// 내용 해시: 제목의 UTF-8 바이트 수, ':', 제목, 줄바꿈, 본문을 이어 SHA-256.
// 제목과 본문의 경계가 흔들려 서로 다른 내용이 같은 해시가 되는 일을 막습니다. SQL(supabase/note_backups.sql)의 계산과 같습니다.
export function contentHash({ title, body }) {
  const t = String(title ?? '');
  const b = String(body ?? '');
  return createHash('sha256').update(`${Buffer.byteLength(t, 'utf8')}:${t}\n${b}`, 'utf8').digest('hex');
}

export async function restoreRoute(request, response, { login, db }) {
  const input = readJsonBody(request);
  if (!input) return response.status(400).json({ error: 'INVALID_JSON' });
  // 복원 대상은 ID 하나뿐입니다. 소유자·내용을 바꾸려는 값이 섞여 있으면 거부합니다.
  if (Object.keys(input).some(key => key !== 'id')) {
    logDeny('unexpected_field');
    return response.status(400).json({ error: 'ONLY_ID_ALLOWED' });
  }
  if (!isUuid(input.id)) return response.status(400).json({ error: 'INVALID_ID' });
  const id = input.id.toLowerCase();

  const backup = await db.from('note_backups').select('id, owner_id, title, body, content_sha256').eq('id', id).maybeSingle();
  if (backup.error) return databaseFailure(response, 'backup_read');
  if (!backup.data || !same(backup.data.owner_id, login.userId) || !same(backup.data.id, id)) {
    logDeny(backup.data ? 'not_owner' : 'backup_not_found');
    return notFound(response);
  }
  const copy = backup.data;
  const expected = contentHash(copy);
  if (typeof copy.content_sha256 !== 'string' || !HEX64.test(copy.content_sha256) || copy.content_sha256 !== expected) {
    logDeny('backup_hash_mismatch');
    return response.status(409).json({ error: 'BACKUP_VERIFICATION_FAILED' });
  }

  const current = await db.from('user_notes').select('id, owner_id, title, body').eq('id', id).maybeSingle();
  if (current.error) return databaseFailure(response, 'current_read');

  let action;
  let written;
  if (current.data) {
    // 현재 메모가 다른 사람 것이면 덮어쓰지 않습니다.
    if (!same(current.data.owner_id, copy.owner_id)) {
      logDeny('current_owner_mismatch');
      return response.status(409).json({ error: 'OWNER_MISMATCH' });
    }
    action = 'updated';
    const result = await db.from('user_notes')
      .update({ title: copy.title, body: copy.body, updated_at: new Date().toISOString() })
      .eq('id', id).eq('owner_id', copy.owner_id).select('id, owner_id, title, body').maybeSingle();
    if (result.error) return databaseFailure(response, 'update');
    written = result.data;
  } else {
    action = 'recreated';
    const result = await db.from('user_notes')
      .insert({ id, owner_id: copy.owner_id, title: copy.title, body: copy.body })
      .select('id, owner_id, title, body').single();
    if (result.error) {
      if (result.error.code === '23505') return response.status(409).json({ error: 'ID_ALREADY_EXISTS' });
      return databaseFailure(response, 'insert');
    }
    written = result.data;
  }

  // 쓴 결과를 사본과 대조합니다: ID·소유자·내용 해시.
  if (!written || !same(written.id, copy.id) || !same(written.owner_id, copy.owner_id) || contentHash(written) !== copy.content_sha256) {
    console.error('notes: restore verification failed');
    return response.status(500).json({ error: 'RESTORE_VERIFICATION_FAILED' });
  }

  // 감사 기록은 덧붙이기만 합니다(지우거나 고치는 코드가 없습니다). 본문은 기록하지 않고 해시만 남깁니다.
  const audit = await db.from('note_restore_audit').insert({
    note_id: id, owner_id: copy.owner_id, content_sha256: copy.content_sha256, action, outcome: 'restored',
  });
  const auditRecorded = !audit?.error;
  if (!auditRecorded) console.error('notes: restore audit write failed', audit.error?.code || 'unknown');

  return response.status(200).json({ id, restored: true, action, contentSha256: copy.content_sha256, auditRecorded });
}

function databaseFailure(response, step) {
  console.error('notes: restore query failed', step);
  return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
}
