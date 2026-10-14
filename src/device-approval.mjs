// 11단계 제작 2: 기기 승인 요청과 서버의 등록 기기 확인.
//
// 흐름
//   1. 로그인한 학생이 POST /api/device/request 로 "이 기기를 승인해 달라"고 요청합니다. 요청은 대기(pending) 기록만 만듭니다.
//   2. 승인(approved)·거부(denied)는 이 앱의 어떤 경로로도 바꿀 수 없습니다. 서버 운영자가 데이터베이스에서 직접 바꿉니다
//      (supabase/device_approvals.sql). 화면의 버튼은 요청만 하며 권한을 주지 않습니다.
//   3. 보호 자료 API(requireLogin)는 학생 로그인의 요청마다 이 기기가 (사용자, 기기) 쌍으로 승인됐는지 서버에서 다시 확인합니다.
//
// 기기 구분: 브라우저에는 기기 키·핸들·토큰을 아무것도 맡기지 않습니다(쿠키·localStorage·sessionStorage·IndexedDB 모두).
//   서버가 요청 머리글(User-Agent)에서 그때그때 기기 표시 값을 계산해 SHA-256만 비교·저장합니다.
//   - 이 값은 비밀이 아니며 키가 아닙니다. 사용자 승인에 곁들이는 구분 표시일 뿐이고, 하드웨어의 증명이 아닙니다.
//   - 같은 사용자라도 브라우저나 기기 종류가 다르면 다른 기기로 구분되어 따로 승인이 필요합니다.
//   - 한계: 머리글은 위조할 수 있습니다. 승인은 로그인한 사용자에 묶여 있어 다른 사용자 계정으로는 쓸 수 없지만,
//     같은 사용자가 같은 User-Agent를 보내면 같은 기기로 보입니다. 브라우저 업데이트로 User-Agent가 바뀌면 다시 승인이 필요합니다.
import { createHash } from 'node:crypto';

export const STATUSES = Object.freeze(['pending', 'approved', 'denied']);
const MAX_PENDING_PER_USER = 5;
const MAX_AGENT_LENGTH = 300;

// 요청 머리글에서 기기 구분 값(해시)을 만듭니다. User-Agent가 없거나 너무 길면 null(구분할 수 없음).
export function deviceKeyOf(headers) {
  const raw = headers?.['user-agent'];
  if (typeof raw !== 'string') return null;
  const agent = raw.trim().toLowerCase();
  if (agent.length === 0 || agent.length > MAX_AGENT_LENGTH) return null;
  return createHash('sha256').update(`device-v1\n${agent}`, 'utf8').digest('hex');
}

// 이 사용자·기기 쌍의 승인 상태를 서버 DB에서 읽습니다.
//   'unrequested' 요청한 적 없음(기기를 구분할 수 없는 경우 포함) · 'pending' · 'approved' · 'denied' · 'error' 확인하지 못함
export async function deviceStatus(db, userId, deviceKey) {
  if (!deviceKey) return 'unrequested';
  const { data, error } = await db.from('device_approvals').select('status')
    .eq('owner_id', userId).eq('device_hash', deviceKey).maybeSingle();
  if (error) return 'error';
  if (!data) return 'unrequested';
  return STATUSES.includes(data.status) ? data.status : 'denied';
}

// 보호 자료 API의 관문. 학생 로그인만 기기 승인을 요구합니다.
// 심판 접수 서버가 발급한 시험 신원(kind 'judge')은 사람 학생의 기기를 가리키지 않으므로 이 관문의 대상이 아닙니다.
export async function deviceGate(db, login, headers) {
  if (login?.kind !== 'student') return { allowed: true, status: 'not_applicable' };
  const status = await deviceStatus(db, login.userId, deviceKeyOf(headers));
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
    const status = await deviceStatus(db, login.userId, deviceKeyOf(request.headers));
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
    const deviceKey = deviceKeyOf(request.headers);
    if (!deviceKey) {
      logDeny('device_unidentified');
      return response.status(400).json({ error: 'DEVICE_UNIDENTIFIED' });
    }
    const current = await deviceStatus(db, login.userId, deviceKey);
    if (current === 'error') return response.status(503).json({ error: 'DEVICE_CHECK_UNAVAILABLE' });
    if (current !== 'unrequested') return response.status(200).json({ status: current }); // 이미 요청됨: 상태를 바꾸지 않음

    // 한 사용자의 대기 요청 수를 제한합니다.
    const pending = await db.from('device_approvals').select('id').eq('owner_id', login.userId).eq('status', 'pending');
    if (pending.error) return response.status(503).json({ error: 'DEVICE_CHECK_UNAVAILABLE' });
    if ((pending.data ?? []).length >= MAX_PENDING_PER_USER) {
      logDeny('too_many_pending');
      return response.status(429).json({ error: 'TOO_MANY_PENDING_REQUESTS' });
    }
    const inserted = await db.from('device_approvals')
      .insert({ owner_id: login.userId, device_hash: deviceKey, status: 'pending' }).select('id').single();
    if (inserted.error) {
      if (inserted.error.code === '23505') return response.status(200).json({ status: 'pending' });
      console.error('device: request insert failed', inserted.error.code || 'unknown');
      return response.status(502).json({ error: 'DEVICE_UNAVAILABLE' });
    }
    return response.status(200).json({ status: 'pending' });
  }

  return response.status(404).json({ error: 'NOT_FOUND' });
}
