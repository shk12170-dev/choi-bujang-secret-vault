import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { CASE_IDS, evaluateCase } from '../src/check-cases.mjs';
import { CHECKS, MAX_REQUESTS, base64urlAscii, classify, runChecks, summarize } from '../src/checks-core.mjs';

const BASE = 'https://app.example.invalid';
const ORIGINAL = 'https://db.example.invalid/rest/v1/user_notes';

// 응답은 읽는 항목(status·headers.get·text)만 가진 일반 객체로 흉내 낸다(격리 환경에는 Response 전역이 없다).
const reply = (status, body, type = 'application/json') => ({
  status, headers: { get: name => (name.toLowerCase() === 'content-type' ? type : null) }, text: async () => JSON.stringify(body),
});

function routeFetch(log) {
  return async (url, init = {}) => {
    log.push({ url: String(url), method: String(init.method ?? 'GET').toUpperCase(), headers: init.headers ?? {} });
    const parsed = new URL(url);
    if (parsed.hostname === 'db.example.invalid') return reply(401, { message: 'No API key' });
    if (parsed.pathname === '/data.json') return reply(200, { notes: [] });
    if (parsed.pathname === '/aleph.json') return reply(200, { allowedRoutes: ['GET /api/notes/:id'], originalApiUrl: ORIGINAL });
    if (parsed.pathname === '/api/checks' && parsed.searchParams.get('case')) return reply(200, { jsonReady: true });
    return reply(401, { error: 'LOGIN_REQUIRED' });
  };
}

test('점검은 20건 이하이고 GET만 24건 이하로 보내며 점검마다 요청은 한 건이다', async () => {
  assert.ok(CHECKS.length <= 20);
  assert.equal(new Set(CHECKS.map(item => item.id)).size, CHECKS.length);
  const log = [];
  const { attempts, requestsSent } = await runChecks({ baseUrl: BASE, originalApiUrl: ORIGINAL, fetchImpl: routeFetch(log) });
  assert.equal(attempts.length, CHECKS.length);
  assert.ok(requestsSent <= MAX_REQUESTS);
  assert.equal(log.length, requestsSent);
  assert.deepEqual([...new Set(log.map(item => item.method))], ['GET']);
  // 쓰기 요청이 필요한 점검은 보내지 않고 not_run이다.
  const notRun = attempts.filter(item => item.observed === 'not_run').map(item => item.attackId).sort();
  assert.deepEqual(notRun, ['s10-restore-unauth', 's11-notice-write']);
  assert.equal(log.length, CHECKS.length - notRun.length); // 점검당 한 건
});

test('observed에는 HTTP 상태와 key=value 사실만 있고 설명 문장이 없다', async () => {
  const { attempts } = await runChecks({ baseUrl: BASE, originalApiUrl: ORIGINAL, fetchImpl: routeFetch([]) });
  for (const item of attempts) {
    assert.deepEqual(Object.keys(item).sort(), ['attackId', 'expected', 'observed']);
    assert.match(item.observed, /^(not_run|HTTP \d{3}(; [A-Za-z]+=(true|false))?)$/u, `${item.attackId}: ${item.observed}`);
    assert.ok(item.expected.length <= 300 && item.observed.length <= 300);
  }
});

test('분류: 거부 점검은 401·403만 막음이고 200이면 실패, 응답이 맞지 않으면 실패, 보내지 않은 점검은 not_run', async () => {
  const { attempts } = await runChecks({ baseUrl: BASE, originalApiUrl: ORIGINAL, fetchImpl: routeFetch([]) });
  const sum = summarize(attempts);
  assert.deepEqual(sum, { total: 20, blocked: 18, failed: 0, notRun: 2 });
  assert.equal(classify({ attackId: 's03-unauth-list', observed: 'HTTP 200' }), 'failed');
  assert.equal(classify({ attackId: 's03-unauth-list', observed: 'HTTP 403' }), 'blocked');
  assert.equal(classify({ attackId: 's01-static-notes', observed: 'HTTP 200; notesEmpty=false' }), 'failed');
  assert.equal(classify({ attackId: 's06-device-registered', observed: 'HTTP 200; jsonReady=false' }), 'failed');
  assert.equal(classify({ attackId: 's10-restore-unauth', observed: 'not_run' }), 'not_run');
  assert.equal(classify({ attackId: 'unknown', observed: 'HTTP 401' }), 'failed');
});

test('요청 수 상한을 넘으면 더 보내지 않고 not_run으로 남긴다', async () => {
  const log = [];
  const { runOne } = await import('../src/checks-core.mjs');
  const state = { sent: MAX_REQUESTS, uuid: 'u', forgedToken: 'f' };
  const result = await runOne(CHECKS[0], { baseUrl: BASE, originalApiUrl: ORIGINAL, fetchImpl: routeFetch(log), state });
  assert.equal(result.observed, 'not_run');
  assert.equal(log.length, 0);
});

test('Buffer 없이 만든 base64url이 Buffer 결과와 같고 위조 토큰 조각이 해석된다', () => {
  for (const text of ['{"alg":"ES256","typ":"JWT"}', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}', 'a', 'ab', 'abc', '']) {
    assert.equal(base64urlAscii(text), Buffer.from(text).toString('base64url'));
  }
  assert.throws(() => base64urlAscii('한글'), /ascii_only/u);
});

test('서버의 규칙 점검은 가상 입력을 실제로 실행해 일치 여부와 출처를 돌려준다', async () => {
  assert.equal(CASE_IDS.length, 8);
  for (const id of CASE_IDS) {
    const result = await evaluateCase(id);
    assert.equal(result.case, id);
    assert.equal(result.jsonReady, true, id);
    assert.equal(result.engine, 'ALEPH SDP 엔진');
    assert.equal(result.engineEnforced, 'not_run');
    assert.match(result.source, /^학생 /u);
  }
  assert.deepEqual((await evaluateCase('step-up')).actual, 'step_up');
  assert.equal(await evaluateCase('nope'), null);
});

test('점검 코드와 번들 점검 경로는 격리 환경이 허용하지 않는 기능을 쓰지 않는다', async () => {
  for (const file of ['src/checks-core.mjs', 'src/attack-check.mjs']) {
    const code = (await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).split('\n')
      .filter(line => !line.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /Buffer\.|new Response|globalThis\.crypto|[^.\w]crypto\.randomUUID|node:fs|child_process/u, file);
  }
});
