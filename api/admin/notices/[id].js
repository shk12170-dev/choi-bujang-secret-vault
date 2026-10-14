// 강사 관리 경로: 공지 수정(PUT). 서버의 강사 허용 목록에 있는 검증된 로그인 사용자만 통과합니다(8단계).
import { requireLogin } from '../../../src/memo-api.mjs';
import { adminNoticeRoute } from '../../../src/notice-routes.mjs';

export default async function handler(request, response) {
  const context = await requireLogin(request, response, ['PUT']);
  if (!context) return undefined;
  return adminNoticeRoute(request, response, context);
}
