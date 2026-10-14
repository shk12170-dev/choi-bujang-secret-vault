import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildCases, runCases, summarize, toMarkdown } from '../src/ops-report.mjs';
import { buildOpsSummary } from '../src/ops-summary.mjs';

const LOGIN = { kind: 'student', userId: randomUUID() };

const fakeDb = tables => ({
  from: name => {
    const filters = [];
    const api = {
      select() { return api; },
      eq(key, value) { filters.push([key, value]); return api; },
      then: resolve => {
        const rows = tables[name];
        if (rows === 'error') return resolve({ data: null, error: { code: 'x' } });
        resolve({ data: (rows ?? []).filter(row => filters.every(([k, v]) => row[k] === v)), error: null });
      },
    };
    return api;
  },
});

test('작전실 요약은 판정기·탐지를 실제로 실행한 결과와 서버 기록의 개수를 담고 본문은 담지 않는다', async () => {
  const noteId = randomUUID();
  const db = fakeDb({
    device_approvals: [
      { id: randomUUID(), owner_id: LOGIN.userId, status: 'approved', title: '넣지 않는 값' },
      { id: randomUUID(), owner_id: LOGIN.userId, status: 'pending' },
      { id: randomUUID(), owner_id: randomUUID(), status: 'approved' }, // 다른 사용자의 기록은 세지 않는다
    ],
    note_backups: [{ id: noteId, owner_id: LOGIN.userId, title: '메모 제목', body: '메모 본문 마커' }],
    note_restore_audit: [{ seq: 1, owner_id: LOGIN.userId, restored_at: '2026-10-14T11:00:00Z' }],
  });
  const summary = await buildOpsSummary({ login: LOGIN, db, now: new Date('2026-10-15T00:00:00Z'), commit: 'abcdef0123456789' });
  assert.equal(summary.step >= 12, true);
  assert.equal(summary.commit, 'abcdef012345');
  assert.equal(summary.decider.source, 'live_api');
  assert.equal(summary.decider.allMatch, true);
  assert.deepEqual(summary.decider.probes.map(p => [p.id, p.actual]), [
    ['registered_memo_read', 'allow'], ['unregistered_device', 'deny'], ['memo_list', 'deny'], ['memo_write', 'deny'], ['compound_anomaly', 'step_up'],
  ]);
  assert.equal(summary.detection.allMatch, true);
  assert.deepEqual(summary.detection.probes.map(p => p.actual), ['observe', 'observe', 'propose_revocation']);
  // 서버 기록의 개수가 그대로 보인다(가린 식별자만).
  assert.deepEqual([summary.revocation.devices.approved, summary.revocation.devices.pending, summary.revocation.devices.denied], [1, 1, 0]);
  assert.equal(summary.recovery.backups.count, 1);
  assert.equal(summary.recovery.backups.ids[0], `${noteId.slice(0, 8)}…`);
  assert.equal(summary.recovery.restoreAudit.lastRestoreAt, '2026-10-14T11:00:00Z');
  assert.equal(summary.recovery.snapshot.verified, true);
  // 회수 시스템과 41종 시험은 실행하지 않았다고 표시한다.
  assert.equal(summary.revocation.source, 'not_run');
  assert.ok(summary.notRun.some(item => item.id === 'attack_41'));
  // 메모 본문·제목·전체 식별자는 어디에도 없다.
  const dump = JSON.stringify(summary);
  assert.ok(!dump.includes('메모 본문 마커') && !dump.includes('메모 제목') && !dump.includes(noteId));
});

test('표를 읽지 못하면 값을 만들어 채우지 않고 읽지 못함으로 표시한다', async () => {
  const summary = await buildOpsSummary({ login: LOGIN, db: fakeDb({ device_approvals: 'error', note_backups: 'error', note_restore_audit: 'error' }) });
  assert.equal(summary.revocation.devices.source, 'unavailable');
  assert.equal(summary.recovery.backups.source, 'unavailable');
  assert.equal(summary.recovery.restoreAudit.source, 'unavailable');
  assert.equal(summary.recovery.backups.count, 0);
  assert.equal(summary.decider.source, 'live_api'); // 판정기는 DB와 무관하게 실행됨
});

test('시험 절차: 보낸 요청은 실제 응답 상태로, 필요한 값이 없으면 미실행으로 남긴다', async () => {
  const config = { originalApiUrl: 'https://example.invalid/rest/v1/user_notes' };
  const cases = buildCases(config);
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url: String(url), headers: init.headers });
    const path = new URL(url).pathname;
    const open = ['/', '/aleph.json', '/data.json', '/manifest.webmanifest'].includes(path);
    const body = path === '/data.json' ? { notes: [] } : path === '/manifest.webmanifest' ? { name: 'app' } : { ok: true };
    return new Response(JSON.stringify(open ? body : { error: 'LOGIN_REQUIRED' }), { status: open ? 200 : 401, headers: { 'content-type': 'application/json', 'x-vercel-id': 'icn1::abc' } });
  };
  const results = await runCases(cases, { baseUrl: 'https://app.example.invalid', env: {}, fetchImpl, now: () => new Date('2026-10-15T00:00:00Z'), forgedToken: 'forged.token.value' });
  const byId = Object.fromEntries(results.map(item => [item.id, item]));
  assert.equal(byId.list_without_login.status, 'passed');
  assert.equal(byId.list_without_login.httpStatus, 401);
  assert.match(byId.list_without_login.requestId, /^[0-9a-f-]{36}$/u);
  assert.equal(byId.list_without_login.serverRequestId, 'icn1::abc');
  assert.equal(byId.list_without_login.checkedAt, '2026-10-15T00:00:00.000Z');
  assert.equal(byId.static_notes_empty.status, 'passed');
  // 토큰이 필요한 요청은 보내지 않고 미실행으로 남긴다. 통과로 세지 않는다.
  for (const id of ['a_list_own', 'a_read_foreign', 'a_ops_summary']) assert.equal(byId[id].status, 'not_run', id);
  assert.ok(!sent.some(entry => /\/api\/notes\/[0-9a-f-]{36}$/u.test(entry.url) && entry.headers.Authorization && !entry.headers.Authorization.includes('forged')));
  const sum = summarize(results);
  assert.equal(sum.not_run, 7);
  assert.equal(sum.passed + sum.not_run, sum.total);
  const md = toMarkdown(results, { commit: 'abc', baseUrl: 'https://app.example.invalid', generatedAt: '2026-10-15T00:00:00Z' });
  assert.match(md, /41종 공격 시험: 미실행/u);
  assert.match(md, /\| 미실행 \(필요한 값 없음/u);
});

test('기대와 다른 응답은 실패로 남기고 토큰 값은 보고서에 쓰지 않는다', async () => {
  const token = ['tok', 'ENV', 'MARKER', '99'].join('-');
  const cases = buildCases({}).filter(item => ['a_list_own', 'list_without_login'].includes(item.id));
  const fetchImpl = async () => new Response('{"error":"X"}', { status: 500, headers: { 'content-type': 'application/json' } });
  const results = await runCases(cases, { baseUrl: 'https://app.example.invalid', env: { ALEPH_TOKEN_A: token }, fetchImpl, forgedToken: 'f.f.f' });
  assert.deepEqual(results.map(item => item.status), ['failed', 'failed']);
  const dump = JSON.stringify(results) + toMarkdown(results, { commit: null, baseUrl: 'x', generatedAt: 'y' });
  assert.ok(!dump.includes(token));
});

test('작전실 화면은 서버 응답만 표로 그리고 저장 공간·성공 문구 상수를 쓰지 않는다', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /await api\('\/api\/ops'\)/u);
  assert.match(html, /미실행/u);
  assert.doesNotMatch(html, /sessionStorage|localStorage|indexedDB|document\.cookie/u);
  // 화면 코드가 통과·승인 문구를 스스로 만들지 않는다: 표시 문구는 서버 응답 필드에서 온다.
  const ops = html.slice(html.indexOf('function renderOps'), html.indexOf('async function loadOps'));
  assert.doesNotMatch(ops, /통과했습니다|모두 통과|성공했습니다/u);
});
