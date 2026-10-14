// 11단계 제작 2: 기기 승인 요청과 서버의 등록 기기 확인.
//
// 흐름
//   1. 로그인한 학생이 POST /api/device/request 로 "이 기기를 승인해 달라"고 요청합니다. 요청은 대기(pending) 기록만 만듭니다.
//   2. 승인(approved)·거부(denied)는 이 앱의 어떤 경로로도 바꿀 수 없습니다. 서버 운영자가 데이터베이스에서 직접 바꿉니다
//      (supabase/device_approvals.sql). 화면의 버튼은 요청만 하며 권한을 주지 않습니다.
//   3. 보호 자료 API(requireLogin)는 학생 로그인의 요청마다 이 기기가 (사용자, 기기) 쌍으로 승인됐는지 서버에서 다시 확인합니다.
//
// 기기 식별: 서버가 만든 무작위 값(기기 핸들)을 HttpOnly·Secure·SameSite=Strict 쿠키로 브라우저에 맡깁니다.
//   - 화면의 스크립트는 이 값을 읽지 못하고, localStorage·sessionStorage에 기기 키나 토큰을 넣지 않습니다.
//   - 서버 DB에는 핸들의 SHA-256만 저장합니다. 핸들 원문은 응답 본문에도, 로그에도 나오지 않습니다.
//   - 한계: 쿠키는 이 기기를 가리키는 운반 값입니다. 쿠키가 통째로 복사되면 그 기기로 보일 수 있습니다.
//     승인은 (사용자, 기기) 쌍에 묶이므로 다른 사용자 계정으로는 쓸 수 없지만, 기기 하드웨어의 증명은 아닙니다.
import { createHash, randomBytes } from 'node:crypto';

export const DEVICE_COOKIE = 'bb_device';
export const STATUSES = Object.freeze(['pending', 'approved', 'denied']);
const HANDLE = /^[A-Za-z0-9_-]{43}$/u;
const MAX_PENDING_PER_USER = 5;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export const hashHandle = handle => createHash('sha256').update(handle, 'utf8').digest('hex');
export const newHandle = () => randomBytes(32).toString('base64url');

export function readHandle(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length > 4096) return null;
  for (const part of cookieHeader.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() !== DEVICE_COOKIE) continue;
    const value = part.slice(at + 1).trim();
    return HANDLE.test(value) ? value : null;
  }
  return null;
}

export const cookieFor = handle =>
  `${DEVICE_COOKIE}=${handle}; Max-Age=${COOKIE_MAX_AGE}; Path=/api; HttpOnly; Secure; SameSite=Strict`;

// 이 사용자·기기 쌍의 승인 상태를 서버 DB에서 읽습니다.
//   'unrequested' 요청한 적 없음 · 'pending' · 'approved' · 'denied' · 'error' 확인하지 못함
export async function deviceStatus(db, userId, handle) {
  if (!handle) return 'unrequested';
  const { data, error } = await db.from('device_approvals').select('status')
    .eq('owner_id', userId).eq('device_hash', hashHandle(handle)).maybeSingle();
  if (error) return 'error';
  if (!data) return 'unrequested';
  return STATUSES.includes(data.status) ? data.status : 'denied';
}

// 보호 자료 API의 관문. 학생 로그인만 기기 승인을 요구합니다.
// 심판 접수 서버가 발급한 시험 신원(kind 'judge')은 사람 학생의 기기를 가리키지 않으므로 이 관문의 대상이 아닙니다.
export async function deviceGate(db, login, cookieHeader) {
  if (login?.kind !== 'student') return { allowed: true, status: 'not_applicable' };
  const status = await deviceStatus(db, login.userId, readHandle(cookieHeader));
  return { allowed: status === 'approved', status };
}

const logDeny = reason => console.warn(`device: deny action=request reason=${reason}`);

// GET /api/device/status · POST /api/device/request (api/device/[action].js)
export async function deviceRoute(request, response, { login, db }) {
  const action = String(request.query?.action ?? '');
  if (action === 'status') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (login.kind !== 'student') return response.status(200).json({ status: 'not_applicable' });
    const status = await deviceStatus(db, login.userId, readHandle(request.headers?.cookie));
    if (status === 'error') return response.status(503).json({ error: 'DEVICE_CHECK_UNAVAILABLE' });
    return response.status(200).json({ status });
  }

  if (action === 'request') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (login.kind !== 'student') {
      logDeny('not_student');
      return response.status(403).json({ error: 'STUDENT_ONLY' });
    }
    // 요청 본문은 읽지 않습니다. 상태·사용자·기기 값을 클라이언트가 정할 수 없습니다.
    const existingHandle = readHandle(request.headers?.cookie);
    const current = await deviceStatus(db, login.userId, existingHandle);
    if (current === 'error') return response.status(503).json({ error: 'DEVICE_CHECK_UNAVAILABLE' });
    if (current !== 'unrequested') return response.status(200).json({ status: current }); // 이미 요청됨: 상태를 바꾸지 않음

    // 새 기기 핸들(쿠키가 없거나 이 사용자의 기록이 없음). 한 사용자의 대기 요청 수를 제한합니다.
    const pending = await db.from('device_approvals').select('id').eq('owner_id', login.userId).eq('status', 'pending');
    if (pending.error) return response.status(503).json({ error: 'DEVICE_CHECK_UNAVAILABLE' });
    if ((pending.data ?? []).length >= MAX_PENDING_PER_USER) {
      logDeny('too_many_pending');
      return response.status(429).json({ error: 'TOO_MANY_PENDING_REQUESTS' });
    }
    const handle = existingHandle ?? newHandle();
    const inserted = await db.from('device_approvals')
      .insert({ owner_id: login.userId, device_hash: hashHandle(handle), status: 'pending' }).select('id').single();
    if (inserted.error) {
      if (inserted.error.code === '23505') return response.status(200).json({ status: 'pending' });
      console.error('device: request insert failed', inserted.error.code || 'unknown');
      return response.status(502).json({ error: 'DEVICE_UNAVAILABLE' });
    }
    if (!existingHandle) response.setHeader('Set-Cookie', cookieFor(handle));
    return response.status(200).json({ status: 'pending' });
  }

  return response.status(404).json({ error: 'NOT_FOUND' });
}
