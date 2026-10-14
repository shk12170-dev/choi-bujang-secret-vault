// 반 공지 한 건(GET). 읽기만 가능하며 쓰기는 누구에게나 거부합니다(8단계).
import { requireLogin } from '../../src/memo-api.mjs';
import { noticeRoute } from '../../src/notice-routes.mjs';

export default async function handler(request, response) {
  const context = await requireLogin(request, response, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  if (!context) return undefined;
  return noticeRoute(request, response, context);
}
