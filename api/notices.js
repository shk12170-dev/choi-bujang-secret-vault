// 반 공지 목록(GET). 로그인한 사용자 누구나 읽기만 가능하고 쓰기는 누구에게나 거부합니다(8단계).
// 강사의 공지 추가·수정은 판정기가 아니라 서버의 관리 경로(/api/admin/notices)가 처리합니다.
import { requireLogin } from '../src/memo-api.mjs';
import { noticeRoute } from '../src/notice-routes.mjs';

export default async function handler(request, response) {
  // 로그인 검사는 모든 메서드에 먼저 적용됩니다. 로그인한 사용자의 쓰기는 noticeRoute가 403으로 거부합니다.
  const context = await requireLogin(request, response, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  if (!context) return undefined;
  return noticeRoute(request, response, context);
}
