// 사본에서 메모 한 건 복원(POST). 로그인 검사 뒤 소유자·내용 해시 대조는 src/note-restore.mjs에 있습니다(10단계).
// 정적 경로라서 api/notes/[id].js보다 먼저 맞습니다.
import { requireLogin } from '../../src/memo-api.mjs';
import { restoreRoute } from '../../src/note-restore.mjs';

export default async function handler(request, response) {
  const context = await requireLogin(request, response, ['POST']);
  if (!context) return undefined;
  return restoreRoute(request, response, context);
}
