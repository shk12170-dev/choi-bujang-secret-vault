// GET /api/device/status · POST /api/device/request (11단계: 기기 승인 요청과 상태 확인)
// 로그인 검사는 requireLogin이 하고, 이 경로 자체는 기기 승인 관문의 대상이 아닙니다(승인 요청을 해야 하기 때문).
import { requireLogin } from '../../src/memo-api.mjs';
import { deviceRoute } from '../../src/device-approval.mjs';

export default async function handler(request, response) {
  const context = await requireLogin(request, response, ['GET', 'POST'], { deviceGate: false });
  if (!context) return undefined;
  return deviceRoute(request, response, context);
}
