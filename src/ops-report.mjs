// 12단계 제작 2: 1~11단계의 정상·금지 요청을 실제로 보내 보고, 기대 결과·실제 결과·요청 ID·확인 시각을 한 표로 남깁니다.
//
// 원칙
//   - 보낸 요청의 실제 응답 상태만 기록합니다. 보내지 않은 요청은 「미실행」이며 통과로 세지 않습니다.
//   - 로그인이 필요한 요청은 학생이 환경변수로 시험용 토큰을 넣었을 때만 보냅니다. 토큰은 보고서·출력에 쓰지 않습니다.
//   - 심판의 41종 공격 시험은 이 저장소에 목록이 없어 실행하지 않았고, 보고서는 41종 통과를 주장하지 않습니다.
import { randomUUID } from 'node:crypto';

const UUID_PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

// 한 줄 = 요청 하나. kind: normal(허용돼야 함) · forbidden(거부돼야 함)
//   auth: none · forged(위조 토큰) · A · B(학생이 넣은 시험용 토큰)
//   needs: 이 요청에 필요한 환경변수 이름(없으면 미실행)
export function buildCases(config, { foreignMemoId = UUID_PLACEHOLDER } = {}) {
  const originalApi = typeof config.originalApiUrl === 'string' ? config.originalApiUrl : null;
  const cases = [
    { stage: '1', id: 'home_public', kind: 'normal', method: 'GET', path: '/', auth: 'none', expect: [200], note: '첫 화면은 누구나 열 수 있음' },
    { stage: '1', id: 'aleph_json_public', kind: 'normal', method: 'GET', path: '/aleph.json', auth: 'none', expect: [200], note: '배포 정보 공개' },
    { stage: '2', id: 'static_notes_empty', kind: 'normal', method: 'GET', path: '/data.json', auth: 'none', expect: [200], note: '공개 자료에 메모 없음', check: body => Array.isArray(body?.notes) && body.notes.length === 0 },
    { stage: '3', id: 'list_without_login', kind: 'forbidden', method: 'GET', path: '/api/notes', auth: 'none', expect: [401, 403], note: '로그인 없는 목록 요청 거부' },
    { stage: '3', id: 'list_forged_token', kind: 'forbidden', method: 'GET', path: '/api/notes', auth: 'forged', expect: [401, 403], note: '위조 토큰 거부' },
    { stage: '3', id: 'login_empty', kind: 'forbidden', method: 'POST', path: '/api/auth/login', auth: 'none', body: {}, expect: [400, 401], note: '빈 로그인 요청 거부' },
    { stage: '4', id: 'item_without_login', kind: 'forbidden', method: 'GET', path: `/api/notes/${UUID_PLACEHOLDER}`, auth: 'none', expect: [401, 403], note: '번호만 아는 비로그인 조회 거부' },
    { stage: '4', id: 'create_without_login', kind: 'forbidden', method: 'POST', path: '/api/notes', auth: 'none', body: { title: 'x' }, expect: [401, 403], note: '비로그인 추가 거부' },
    { stage: '8', id: 'notice_write_without_login', kind: 'forbidden', method: 'PUT', path: `/api/notices/${UUID_PLACEHOLDER}`, auth: 'none', body: { title: 'x', role: 'instructor' }, expect: [401, 403], note: '비로그인 공지 수정 거부(role 위조 포함)' },
    { stage: '8', id: 'admin_notice_write_without_login', kind: 'forbidden', method: 'PUT', path: `/api/admin/notices/${UUID_PLACEHOLDER}`, auth: 'none', body: { title: 'x' }, expect: [401, 403], note: '비로그인 강사 경로 거부' },
    { stage: '10', id: 'restore_without_login', kind: 'forbidden', method: 'POST', path: '/api/notes/restore', auth: 'none', body: { id: UUID_PLACEHOLDER }, expect: [401, 403], note: '비로그인 복원 요청 거부' },
    { stage: '11', id: 'device_status_without_login', kind: 'forbidden', method: 'GET', path: '/api/device/status', auth: 'none', expect: [401, 403], note: '비로그인 기기 상태 거부' },
    { stage: '11', id: 'device_request_without_login', kind: 'forbidden', method: 'POST', path: '/api/device/request', auth: 'none', body: {}, expect: [401, 403], note: '비로그인 기기 승인 요청 거부' },
    { stage: '11', id: 'manifest_public', kind: 'normal', method: 'GET', path: '/manifest.webmanifest', auth: 'none', expect: [200], note: '앱 설정 공개', check: body => typeof body?.name === 'string' },
    { stage: '12', id: 'ops_without_login', kind: 'forbidden', method: 'GET', path: '/api/checks?view=ops', auth: 'none', expect: [401, 403], note: '비로그인 작전실 요약 거부' },
    // 로그인한 시험 계정(학생이 토큰을 환경변수로 넣은 경우에만 실행)
    { stage: '4', id: 'a_list_own', kind: 'normal', method: 'GET', path: '/api/notes', auth: 'A', expect: [200], needs: ['ALEPH_TOKEN_A'], note: 'A의 자기 목록 허용(승인된 기기)', check: body => Array.isArray(body) },
    { stage: '8', id: 'a_notices_read', kind: 'normal', method: 'GET', path: '/api/notices', auth: 'A', expect: [200], needs: ['ALEPH_TOKEN_A'], note: 'A의 공지 읽기 허용' },
    { stage: '12', id: 'a_ops_summary', kind: 'normal', method: 'GET', path: '/api/checks?view=ops', auth: 'A', expect: [200], needs: ['ALEPH_TOKEN_A'], note: 'A의 작전실 요약 허용' },
    { stage: '4', id: 'a_read_foreign', kind: 'forbidden', method: 'GET', path: `/api/notes/${foreignMemoId}`, auth: 'A', expect: [404], needs: ['ALEPH_TOKEN_A', 'ALEPH_B_MEMO_ID'], note: 'A가 B의 메모 조회 거부' },
    { stage: '4', id: 'a_update_foreign', kind: 'forbidden', method: 'PUT', path: `/api/notes/${foreignMemoId}`, auth: 'A', body: { title: 'x' }, expect: [404], needs: ['ALEPH_TOKEN_A', 'ALEPH_B_MEMO_ID'], note: 'A가 B의 메모 수정 거부' },
    { stage: '4', id: 'a_delete_foreign', kind: 'forbidden', method: 'DELETE', path: `/api/notes/${foreignMemoId}`, auth: 'A', expect: [404], needs: ['ALEPH_TOKEN_A', 'ALEPH_B_MEMO_ID'], note: 'A가 B의 메모 삭제 거부' },
    { stage: '10', id: 'a_restore_foreign', kind: 'forbidden', method: 'POST', path: '/api/notes/restore', auth: 'A', body: { id: foreignMemoId }, expect: [404], needs: ['ALEPH_TOKEN_A', 'ALEPH_B_MEMO_ID'], note: 'A가 B의 사본 복원 거부' },
  ];
  if (originalApi) {
    cases.push({ stage: '5', id: 'original_api_keyless', kind: 'forbidden', method: 'GET', path: originalApi, absolute: true, auth: 'none', expect: [401, 403], note: '키 없는 원본 API 직접 호출 거부' });
  }
  return cases;
}

function authHeader(auth, env, forged) {
  if (auth === 'A') return env.ALEPH_TOKEN_A ? `Bearer ${env.ALEPH_TOKEN_A}` : null;
  if (auth === 'B') return env.ALEPH_TOKEN_B ? `Bearer ${env.ALEPH_TOKEN_B}` : null;
  if (auth === 'forged') return `Bearer ${forged}`;
  return undefined;
}

// 요청을 순서대로 보냅니다. 서버 내부 값이나 응답 본문은 기록하지 않고 상태·형식·일치 여부만 남깁니다.
export async function runCases(cases, { baseUrl, env = {}, fetchImpl = fetch, now = () => new Date(), forgedToken }) {
  const results = [];
  for (const item of cases) {
    const missing = (item.needs ?? []).filter(name => !env[name]);
    const base = { stage: item.stage, id: item.id, kind: item.kind, method: item.method, expect: item.expect, note: item.note };
    if (missing.length) {
      results.push({ ...base, path: item.path, status: 'not_run', reason: `필요한 값 없음: ${missing.join(', ')}` });
      continue;
    }
    const requestId = randomUUID();
    const checkedAt = now().toISOString();
    const url = item.absolute ? item.path : new URL(item.path, baseUrl).href;
    const headers = { 'X-Request-Id': requestId, ...(item.body ? { 'Content-Type': 'application/json' } : {}) };
    const authorization = authHeader(item.auth, env, forgedToken);
    if (authorization) headers.Authorization = authorization;
    if (env.ALEPH_USER_AGENT && item.auth !== 'none' && item.auth !== 'forged') headers['User-Agent'] = env.ALEPH_USER_AGENT;
    let response;
    try {
      response = await fetchImpl(url, {
        method: item.method, headers, redirect: 'manual', signal: AbortSignal.timeout(10000),
        ...(item.body ? { body: JSON.stringify(item.body) } : {}),
      });
    } catch {
      results.push({ ...base, path: item.absolute ? '(원본 API 주소)' : item.path, status: 'error', requestId, checkedAt, reason: '요청을 보내지 못함' });
      continue;
    }
    let body = null;
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('json')) { try { body = await response.json(); } catch { /* JSON이 아님 */ } }
    const statusOk = item.expect.includes(response.status);
    const checkOk = item.check ? Boolean(item.check(body)) : true;
    results.push({
      ...base,
      path: item.absolute ? '(원본 API 주소)' : item.path,
      status: statusOk && checkOk ? 'passed' : 'failed',
      httpStatus: response.status,
      requestId,
      serverRequestId: response.headers.get('x-vercel-id') ?? null,
      checkedAt,
    });
  }
  return results;
}

export function summarize(results) {
  const count = status => results.filter(item => item.status === status).length;
  return {
    total: results.length, passed: count('passed'), failed: count('failed'), not_run: count('not_run'), error: count('error'),
    forbiddenRejected: results.filter(item => item.kind === 'forbidden' && item.status === 'passed').length,
    normalAllowed: results.filter(item => item.kind === 'normal' && item.status === 'passed').length,
  };
}

const LABELS = { passed: '통과', failed: '실패', not_run: '미실행', error: '오류' };

export function toMarkdown(results, { commit, baseUrl, generatedAt }) {
  const sum = summarize(results);
  const lines = [
    '# 탈환 작전실 시험 보고',
    '',
    `- 대상: ${baseUrl}`,
    `- 배포 커밋: ${commit ?? '알 수 없음'}`,
    `- 작성 시각: ${generatedAt}`,
    `- 전체 ${sum.total}건: 통과 ${sum.passed} · 실패 ${sum.failed} · 오류 ${sum.error} · 미실행 ${sum.not_run}`,
    `- 41종 공격 시험: 미실행(이 저장소에 목록이 없어 실행하지 않았고 통과로 세지 않음)`,
    '',
    '| 단계 | 구분 | 요청 | 기대 | 실제 | 결과 | 요청 ID | 서버 요청 ID | 확인 시각 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const item of results) {
    lines.push(`| ${item.stage} | ${item.kind === 'normal' ? '정상(허용)' : '금지(거부)'} | ${item.method} ${item.path} | ${item.expect.join('/')} | ${item.httpStatus ?? '-'} | ${LABELS[item.status]}${item.reason ? ` (${item.reason})` : ''} | ${item.requestId ?? '-'} | ${item.serverRequestId ?? '-'} | ${item.checkedAt ?? '-'} |`);
  }
  return `${lines.join('\n')}\n`;
}
