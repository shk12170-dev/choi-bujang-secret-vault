// 3단계 메모 API 공통 도우미. 로그인 검사는 시작 틀의 src/verify-login.mjs를 그대로 씁니다.
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';
import { resourceOfRequest } from './resources.mjs';
import { deviceGate } from './device-approval.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const isUuid = value => typeof value === 'string' && UUID.test(value);

let verifyLogin;
let database;

// 환경변수와 로그인 확인을 준비합니다. 실패하면 응답을 직접 보내고 null을 돌려줍니다.
// 사용자 ID는 서버가 검증한 토큰에서만 얻습니다. 브라우저가 보낸 userId·role은 읽지 않습니다.
// 11단계: 학생 로그인은 이 기기가 (사용자, 기기) 쌍으로 승인된 경우에만 보호 자료 경로를 지나갑니다(deviceGate: false는 승인 요청 경로만).
export async function requireLogin(request, response, allowedMethods, { deviceGate: gateDevice = true } = {}) {
  response.setHeader('Cache-Control', 'no-store');
  if (!allowedMethods.includes(request.method)) {
    response.setHeader('Allow', allowedMethods.join(', '));
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return null;
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('notes: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });
    return null;
  }
  let login;
  try {
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: secretKey });
    login = await verifyLogin(request.headers?.authorization);
  } catch {
    console.error('notes: login verifier unavailable');
    response.status(500).json({ error: 'LOGIN_CHECK_UNAVAILABLE' });
    return null;
  }
  if (!login) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(401).json({ error: 'LOGIN_REQUIRED', message: '로그인한 사용자만 자료를 볼 수 있습니다.' });
    return null;
  }
  database ??= createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  if (gateDevice) {
    const gate = await deviceGate(database, login, request.headers);
    if (gate.status === 'error') {
      response.status(503).json({ error: 'DEVICE_CHECK_UNAVAILABLE' });
      return null;
    }
    if (!gate.allowed) {
      console.warn(`device: deny resource=gate reason=${gate.status}`);
      response.status(403).json({ error: 'DEVICE_NOT_APPROVED', status: gate.status });
      return null;
    }
  }
  // 8단계: 요청마다 서버가 구별한 자원 ID를 응답 머리글과 컨텍스트에 남깁니다(없는 경로면 null).
  const resource = resourceOfRequest(request);
  if (resource) response.setHeader('X-Resource-Id', resource.resourceId);
  return { login, db: database, resource };
}

export function readJsonBody(request) {
  const body = request.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  if (typeof body === 'string' && body.length <= 20000) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* 아래에서 거부 */ }
  }
  return null;
}

// 제목 1~200자, 본문 5000자 이하 문자열만 받습니다.
export function validateMemo(input, { requireTitle }) {
  const out = {};
  if (input.title !== undefined || requireTitle) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) return { error: 'INVALID_TITLE' };
    out.title = input.title.trim();
  }
  if (input.body !== undefined) {
    if (typeof input.body !== 'string' || input.body.length > 5000) return { error: 'INVALID_BODY' };
    out.body = input.body;
  }
  return { value: out };
}

export const memoView = row => ({ id: row.id, title: row.title, body: row.body });

// 데이터베이스 오류는 코드만 기록하고 요청 내용·키는 기록하지 않습니다.
export function databaseFailure(response, error) {
  console.error('notes: query failed', error?.code || 'unknown');
  return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
}
