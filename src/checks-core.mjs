// 12단계: 제출 묶음(npm run bundle)과 서버의 GET /api/checks가 같이 쓰는 점검 목록과 실행 함수.
// 같은 함수·같은 목록에서 나온 값만 묶음의 attackAttempts와 작전실 화면 수치로 쓰므로 둘이 어긋나지 않습니다.
//
// 규칙
//   - 점검(attackId) 하나에 요청은 한 건만 보냅니다. 요청 방식은 GET만이고 전체 24건을 넘지 않습니다(코드로 강제).
//   - observed에는 HTTP 상태와 key=value 사실만 적습니다(예: `HTTP 401`, `HTTP 200; jsonReady=true`). 설명은 expected에 둡니다.
//   - 쓰기 요청이 필요한 점검은 보내지 않고 observed를 not_run으로 둡니다.
//   - 쓰는 모듈은 node:crypto뿐이며 Buffer·Response 같은 전역에 기대지 않고, 응답은 status와 json()만 읽습니다(격리 환경).
import { randomUUID } from 'node:crypto';

export const MAX_REQUESTS = 24;
const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);
const DENIED = [401, 403];

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// ASCII 문자열만 base64url로 바꿉니다(Buffer 없이). 위조 토큰 머리·본문 조각에만 씁니다.
export function base64urlAscii(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i);
    const b = i + 1 < text.length ? text.charCodeAt(i + 1) : NaN;
    const c = i + 2 < text.length ? text.charCodeAt(i + 2) : NaN;
    if (a > 127 || b > 127 || c > 127) throw new TypeError('ascii_only');
    const n = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (!Number.isNaN(b)) out += B64URL[(n >> 6) & 63];
    if (!Number.isNaN(c)) out += B64URL[n & 63];
  }
  return out;
}

// 점검 정의. kind: deny(거부돼야 함) · static(공개 자료에 메모 없음) · aleph(배포 정보) · case(서버가 실행한 규칙 점검) · not_run
export const CHECKS = Object.freeze([
  { id: 's01-static-notes', stage: 1, kind: 'static', path: '/data.json', expected: 'HTTP 200; notesEmpty=true' },
  { id: 's03-unauth-list', stage: 3, kind: 'deny', path: '/api/notes', expected: 'HTTP 401 또는 403' },
  { id: 's03-fake-token', stage: 3, kind: 'deny', path: '/api/notes', forged: true, expected: 'HTTP 401 또는 403' },
  { id: 's04-other-note', stage: 4, kind: 'deny', path: ctx => `/api/notes/${ctx.uuid}`, expected: 'HTTP 401 또는 403' },
  { id: 's04-query-identity', stage: 4, kind: 'deny', path: ctx => `/api/notes?owner_id=${ctx.uuid}`, expected: 'HTTP 401 또는 403' },
  { id: 's05-direct-table', stage: 5, kind: 'deny', absolute: 'originalApiUrl', expected: 'HTTP 401 또는 403' },
  { id: 's05-aleph-json', stage: 5, kind: 'aleph', path: '/aleph.json', expected: 'HTTP 200; jsonReady=true' },
  { id: 's06-device-unregistered', stage: 6, kind: 'case', case: 'device-unregistered', expected: 'HTTP 200; jsonReady=true' },
  { id: 's06-device-registered', stage: 6, kind: 'case', case: 'device-registered', expected: 'HTTP 200; jsonReady=true' },
  { id: 's07-step-up', stage: 7, kind: 'case', case: 'step-up', expected: 'HTTP 200; jsonReady=true' },
  { id: 's08-zone-list', stage: 8, kind: 'case', case: 'zone-list', expected: 'HTTP 200; jsonReady=true' },
  { id: 's08-zone-write', stage: 8, kind: 'case', case: 'zone-write', expected: 'HTTP 200; jsonReady=true' },
  { id: 's08-notice-unauth', stage: 8, kind: 'deny', path: '/api/notices', expected: 'HTTP 401 또는 403' },
  { id: 's09-detect-compound', stage: 9, kind: 'case', case: 'detect-compound', expected: 'HTTP 200; jsonReady=true' },
  { id: 's09-detect-normal', stage: 9, kind: 'case', case: 'detect-normal', expected: 'HTTP 200; jsonReady=true' },
  { id: 's10-policy-verified', stage: 10, kind: 'case', case: 'policy-verified', expected: 'HTTP 200; jsonReady=true' },
  { id: 's10-restore-unauth', stage: 10, kind: 'not_run', expected: 'not_run(POST가 필요해 격리 환경에서 보내지 않음)' },
  { id: 's11-device-unauth', stage: 11, kind: 'deny', path: '/api/device/status', expected: 'HTTP 401 또는 403' },
  { id: 's11-notice-write', stage: 11, kind: 'not_run', expected: 'not_run(PUT이 필요해 격리 환경에서 보내지 않음)' },
  { id: 's12-ops-unauth', stage: 12, kind: 'deny', path: '/api/checks?view=ops', expected: 'HTTP 401 또는 403' },
]);

// 점검 하나를 보냅니다. 반환: { attackId, expected, observed }
//   격리 환경의 요청 기록기는 이전 단계 점검과 같은 모양의 요청(URL 객체, redirect: 'error', AbortSignal.timeout)과
//   응답의 status·json()만 확실히 지원하므로 그 범위 안에서만 씁니다. 응답을 받지 못한 요청은 not_run으로 남깁니다.
export async function runOne(def, { baseUrl, originalApiUrl, fetchImpl, state }) {
  const base = { attackId: def.id, expected: def.expected };
  if (def.kind === 'not_run') return { ...base, observed: 'not_run' };

  let target;
  try {
    if (def.absolute) {
      if (def.absolute !== 'originalApiUrl' || typeof originalApiUrl !== 'string' || !originalApiUrl.startsWith('https://')) {
        return { ...base, observed: 'not_run' };
      }
      target = new URL(originalApiUrl);
    } else if (def.kind === 'case') {
      target = new URL(`/api/checks?case=${def.case}`, baseUrl);
    } else {
      target = new URL(typeof def.path === 'function' ? def.path({ uuid: state.uuid }) : def.path, baseUrl);
    }
  } catch {
    return { ...base, observed: 'not_run' };
  }
  if (state.sent >= MAX_REQUESTS) return { ...base, observed: 'not_run' };
  state.sent += 1;

  const init = { redirect: 'error', signal: AbortSignal.timeout(10000) };
  if (def.forged) init.headers = { Authorization: `Bearer ${state.forgedToken}` };
  let response;
  try {
    response = await fetchImpl(target, init);
  } catch {
    return { ...base, observed: 'not_run' }; // 응답을 받지 못한 요청은 결과를 적지 않습니다.
  }
  const status = response.status;
  if (!Number.isInteger(status)) return { ...base, observed: 'not_run' };
  let body = null;
  try { body = await response.json(); } catch { body = null; } // JSON이 아니면 사실 값은 false로 둡니다.

  if (def.kind === 'static') return { ...base, observed: `HTTP ${status}; notesEmpty=${Array.isArray(body?.notes) && body.notes.length === 0}` };
  if (def.kind === 'aleph') {
    const ready = Boolean(body) && Array.isArray(body.allowedRoutes) && typeof body.originalApiUrl === 'string' && body.originalApiUrl.startsWith('https://');
    return { ...base, observed: `HTTP ${status}; jsonReady=${ready}` };
  }
  if (def.kind === 'case') return { ...base, observed: `HTTP ${status}; jsonReady=${body?.jsonReady === true}` };
  return { ...base, observed: `HTTP ${status}` };
}

// 점검 결과 분류: blocked(기대대로 막거나 확인됨) · failed · not_run
export function classify(attempt) {
  if (attempt.observed === 'not_run') return 'not_run';
  const def = CHECKS.find(item => item.id === attempt.attackId);
  const match = /^HTTP (\d{3})(?:; (.+))?$/u.exec(attempt.observed);
  if (!def || !match) return 'failed';
  const status = Number(match[1]);
  const fact = match[2] ?? '';
  if (def.kind === 'deny') return DENIED.includes(status) ? 'blocked' : 'failed';
  if (def.kind === 'static') return status === 200 && fact === 'notesEmpty=true' ? 'blocked' : 'failed';
  return status === 200 && fact === 'jsonReady=true' ? 'blocked' : 'failed';
}

export function summarize(attempts) {
  const results = attempts.map(classify);
  const count = value => results.filter(item => item === value).length;
  return { total: attempts.length, blocked: count('blocked'), failed: count('failed'), notRun: count('not_run') };
}

// 점검을 모두 실행합니다. 서버(/api/checks)와 제출 묶음이 같은 함수를 부릅니다.
//   제출 묶음은 요청 순서가 기록과 같도록 차례대로 보내고(기본), 서버는 응답 시간을 줄이려고 parallel: true로 한꺼번에 보냅니다.
export async function runChecks({ baseUrl, originalApiUrl = null, fetchImpl = globalThis.fetch, parallel = false }) {
  const forgedToken = `${base64urlAscii('{"alg":"ES256","typ":"JWT"}')}.${base64urlAscii(`{"sub":"${randomUUID()}","role":"authenticated"}`)}.${'A'.repeat(86)}`;
  const state = { sent: 0, uuid: randomUUID(), forgedToken };
  const context = { baseUrl, originalApiUrl, fetchImpl, state };
  let attempts;
  if (parallel) {
    attempts = await Promise.all(CHECKS.map(def => runOne(def, context)));
  } else {
    attempts = [];
    for (const def of CHECKS) attempts.push(await runOne(def, context));
  }
  return { attempts, requestsSent: state.sent };
}
