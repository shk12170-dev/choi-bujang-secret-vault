// 5단계: 로그인·토큰 갱신·로그아웃을 서버가 Supabase Auth에 대신 요청합니다.
// 브라우저는 Supabase 주소나 공개 키를 모르고 /api/auth/* 만 부릅니다.
// SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY는 Vercel 환경변수에만 둡니다. 비밀번호·토큰은 로그에 남기지 않습니다.
const EMAIL_MAX = 254;
const PASSWORD_MAX = 200;
const TOKEN_MAX = 4096;
const ACTIONS = new Set(['login', 'refresh', 'logout']);

const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

async function callAuth(path, { body, token } = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* 본문 없음 */ }
  return { response, data };
}

// 브라우저에는 필요한 값만 돌려줍니다.
const sessionView = data => ({
  access_token: data.access_token,
  refresh_token: data.refresh_token,
  expires_at: data.expires_at,
  email: data.user?.email ?? null,
});

function failure(response, upstream, data) {
  const code = typeof data?.error_code === 'string' ? data.error_code : 'auth_failed';
  if (upstream.status === 429) return response.status(429).json({ error: code });
  if (upstream.status >= 500) {
    console.error('auth: upstream error', upstream.status);
    return response.status(502).json({ error: 'AUTH_UNAVAILABLE' });
  }
  return response.status(401).json({ error: code });
}

export async function authRoute(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const action = String(request.query?.action ?? '');
  if (!ACTIONS.has(action)) return response.status(404).json({ error: 'NOT_FOUND' });
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    console.error('auth: missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY');
    return response.status(500).json({ error: 'AUTH_NOT_CONFIGURED' });
  }
  const input = request.body && typeof request.body === 'object' ? request.body : {};

  try {
    if (action === 'login') {
      if (!isText(input.email, EMAIL_MAX) || !isText(input.password, PASSWORD_MAX)) {
        return response.status(400).json({ error: 'INVALID_INPUT' });
      }
      const { response: upstream, data } = await callAuth('token?grant_type=password',
        { body: { email: input.email.trim(), password: input.password } });
      if (!upstream.ok || !data?.access_token) return failure(response, upstream, data);
      return response.status(200).json(sessionView(data));
    }

    if (action === 'refresh') {
      if (!isText(input.refresh_token, TOKEN_MAX)) return response.status(400).json({ error: 'INVALID_INPUT' });
      const { response: upstream, data } = await callAuth('token?grant_type=refresh_token',
        { body: { refresh_token: input.refresh_token } });
      if (!upstream.ok || !data?.access_token) return failure(response, upstream, data);
      return response.status(200).json(sessionView(data));
    }

    // logout: 요청의 로그인 토큰으로 이 세션만 끝냅니다. 토큰이 이미 무효여도 브라우저는 로그아웃 상태가 됩니다.
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(request.headers?.authorization ?? '');
    if (match) await callAuth('logout?scope=local', { token: match[1] });
    return response.status(200).json({ ok: true });
  } catch {
    console.error('auth: request failed');
    return response.status(502).json({ error: 'AUTH_UNAVAILABLE' });
  }
}
