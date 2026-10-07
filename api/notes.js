// 목록(GET)과 추가(POST). 로그인 검사 뒤 소유자 규칙은 src/memo-routes.mjs에 있습니다(4단계).
import { requireLogin } from '../src/memo-api.mjs';
import { collectionRoute } from '../src/memo-routes.mjs';

export default async function handler(request, response) {
  const context = await requireLogin(request, response, ['GET', 'POST']);
  if (!context) return undefined;
  return collectionRoute(request, response, context);
}
