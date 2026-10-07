// 메모 한 건 조회(GET)·수정(PUT)·삭제(DELETE). 로그인 검사 뒤 본인 메모만 허용합니다(4단계).
// 소유자 비교는 src/memo-routes.mjs에 있습니다.
import { requireLogin } from '../../src/memo-api.mjs';
import { memoRoute } from '../../src/memo-routes.mjs';

export default async function handler(request, response) {
  const context = await requireLogin(request, response, ['GET', 'PUT', 'DELETE']);
  if (!context) return undefined;
  return memoRoute(request, response, context);
}
