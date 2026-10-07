// POST /api/auth/login · /api/auth/refresh · /api/auth/logout (5단계: 로그인도 서버 한곳으로 모음)
import { authRoute } from '../../src/auth-proxy.mjs';

export default function handler(request, response) {
  return authRoute(request, response);
}
