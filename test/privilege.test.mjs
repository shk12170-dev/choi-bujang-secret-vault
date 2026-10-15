import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { replay } from '../scripts/xdr-replay.mjs';
import * as bruteForceModule from '../xdr/brute-force/respond.mjs';
import * as knownCveModule from '../xdr/known-cve/respond.mjs';
import * as persistenceModule from '../xdr/persistence/respond.mjs';
import { decide } from '../xdr/privilege/decide.mjs';
import { readAlerts } from '../xdr/privilege/read-alerts.mjs';
import * as privilegeModule from '../xdr/privilege/respond.mjs';
import * as webModule from '../xdr/web-injection/respond.mjs';
import { isDeniedAddress } from '../xdr/ztna-overlay.mjs';

const fixturePath = new URL('../xdr/fixtures/privilege.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const readJson = async name => JSON.parse(await readFile(new URL(`../xdr/fixtures/${name}.json`, import.meta.url), 'utf8'));
const decideSource = await readFile(new URL('../xdr/privilege/decide.mjs', import.meta.url), 'utf8');
const num = id => Number(id.slice(3));
const expectedFor = id => (num(id) <= 9 ? 'block' : num(id) <= 17 ? 'alert' : 'record');
const make = (description, level, data = {}) => ({
  id: 'v-1', timestamp: '2026-10-12T00:00:00Z', rule: { level, mitre: ['T1078'], description },
  data: { srcip: '203.0.113.200', srcuser: 'user09', ...data },
});

test('경보 읽기 모듈은 경보 건수와 뽑은 줄 수가 같다', () => {
  const rows = readAlerts(fixturePath);
  assert.equal(rows.length, fixture.alerts.length);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['account', 'at', 'description', 'id', 'level', 'srcip']);
});

test('명확한 공격은 block, 애매한 시도는 alert, 정상 이벤트는 record로 나뉜다', () => {
  for (const alert of fixture.alerts) {
    const out = decide(alert);
    assert.equal(out.action, expectedFor(alert.id), `${alert.id}: ${out.reason}`);
    assert.ok(Number.isFinite(out.confidence) && out.confidence >= 0 && out.confidence <= 1);
    assert.equal(out.action, out.confidence >= 0.85 ? 'block' : out.confidence >= 0.5 ? 'alert' : 'record');
  }
});

test('모든 reason에 근거 패턴 이름이 한 줄로 있고 계정 이름이 없다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/privilege/patterns.json', import.meta.url), 'utf8'));
  for (const alert of fixture.alerts) {
    const { reason } = decide(alert);
    assert.ok(patterns.patterns.some(pattern => reason.includes(pattern.id)), `${alert.id}: ${reason}`);
    assert.ok(!reason.includes('\n') && reason.length <= 260, alert.id);
    assert.ok(!/user\d+|admin01|svc-lab/u.test(reason), `${alert.id}: 이유에 계정 이름이 있다`);
  }
});

test('경보 번호·주소·계정·순서를 바꿔도 같은 판단이 나온다(정답 고정 없음)', () => {
  fixture.alerts.forEach((alert, i) => {
    const moved = { ...alert, id: `zz-${i}`, data: { ...alert.data, srcip: `198.18.4.${i + 1}`, srcuser: `u${i}` } };
    assert.equal(decide(moved).action, decide(alert).action, alert.id);
  });
});

test('관리자라는 단어, 관리 계정의 정상 로그인, 일반 그룹 추가, 수준 하나만으로는 막지 않는다', () => {
  assert.equal(decide(make('수업용 관리 계정 admin01 이 평소 주소에서 로그인했습니다.', 3)).action, 'record');
  assert.notEqual(decide(make('관리자 그룹 정책을 읽었습니다.', 13)).action, 'block');
  assert.notEqual(decide(make('user02 가 과제 그룹에 추가됐습니다. 관리자 그룹은 아닙니다.', 12, { group: 'project-week3' })).action, 'block');
  assert.notEqual(decide(make('수업 중 권한 상승이 1건 있고 이어서 명령은 없습니다.', 12)).action, 'block');
  assert.notEqual(decide(make('수업 시간에 권한 상승 창이 한 번 뜨고 취소됐습니다.', 12)).action, 'block');
  assert.notEqual(decide(make('관리자 명령이 실패 1건으로 끝났습니다.', 12)).action, 'block');
  // 사건 하나만(근거 하나): 알림
  assert.equal(decide(make('평소 주소에서 관리자 명령이 한 번 실행됐습니다.', 11)).action, 'alert');
  assert.equal(decide(make('user03 이 관리자 그룹에 추가됐습니다.', 11, { group: 'administrators' })).action, 'alert');
});

test('사건과 정황이 둘 이상 겹치고 수준 10 이상이면 막고, 수준이 낮으면 알림만 남긴다', () => {
  const addRemote = make('user09 가 원격 주소에서 관리자 그룹에 추가됐습니다.', 11, { group: 'administrators' });
  assert.equal(decide(addRemote).action, 'block');
  assert.equal(decide({ ...addRemote, rule: { ...addRemote.rule, level: 7 } }).action, 'alert');
  assert.equal(decide(make('같은 주소에서 계정 5개가 관리자 그룹에 추가됐습니다.', 10, { count: '5', group: 'administrators' })).action, 'block');
  assert.equal(decide(make('세션이 관리자 권한으로 바뀌었고 요청 주소는 처음 봅니다.', 12)).action, 'block');
  assert.equal(decide(make('user09 가 다른 계정의 권한으로 관리자 명령을 실행했습니다.', 12)).action, 'block');
  assert.ok(['alert', 'record', 'block'].includes(decide(make('관리자'.repeat(5000), 12, { group: 'g'.repeat(5000), count: { a: 1 } })).action));
});

test('제출용 decide.mjs는 import 없이 파일 하나로 독립 실행되고 결과가 같다', async () => {
  const code = decideSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /^\s*import\b|\bimport\(|\brequire\(|\bfetch\(|\bprocess\b|\bDate\b|readFile|writeFile|XMLHttpRequest|WebSocket|\beval\(|new Function/mu);
  const standalone = await import(`data:text/javascript;base64,${Buffer.from(decideSource).toString('base64')}`);
  for (const alert of fixture.alerts) assert.deepEqual(await standalone.decide(alert), decide(alert));
});

test('패턴 목록은 근거가 한 줄씩 있고 decide.mjs 상수에 이름·조건·근거가 그대로 있다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/privilege/patterns.json', import.meta.url), 'utf8'));
  assert.match(patterns.source, /T1068/u);
  assert.match(patterns.source, /T1078/u);
  for (const pattern of patterns.patterns) {
    assert.ok(typeof pattern.evidence === 'string' && pattern.evidence.trim().length > 10 && !pattern.evidence.includes('\n'), pattern.id);
    assert.match(pattern.technique, /^T1(068|078)$/u);
    for (const field of ['name', 'condition', 'evidence']) assert.ok(decideSource.includes(pattern[field]), `${pattern.id}.${field}`);
    assert.ok(decideSource.includes(`"${pattern.id}"`), pattern.id);
  }
});

test('형식이 이상한 입력은 오류 없이 record로 남는다', () => {
  for (const bad of [null, undefined, 'x', 7, [], {}, { rule: null, data: 'x' }, { rule: { level: 'high', description: 5 }, data: { group: 42, count: 'abc' } }]) {
    const out = decide(bad);
    assert.equal(out.action, 'record');
    assert.ok(out.confidence >= 0 && out.confidence <= 1);
  }
});

test('차단 후보는 block만, 15분 만료·근거 번호가 있고 다른 모듈 규칙을 보존하며 로그에 계정이 없다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pv-'));
  try {
    const rulesPath = join(dir, 'deny-rules.json');
    const logPath = join(dir, 'alerts.log');
    for (const [module, key] of [[bruteForceModule, 'brute-force'], [webModule, 'web-injection'], [knownCveModule, 'known-cve'], [persistenceModule, 'persistence']]) {
      await module.respond((await readJson(key)).alerts, { rulesPath, logPath });
    }
    const result = await privilegeModule.respond(fixture.alerts, { rulesPath, logPath });
    assert.deepEqual(result.counts, { block: 9, alert: 8, record: 9 });
    assert.equal(result.rules.length, 9);
    for (const rule of result.rules) {
      assert.equal(expectedFor(rule.evidenceAlertId), 'block');
      assert.equal(rule.moduleKey, 'privilege');
      assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.issuedAt), 15 * 60 * 1000);
      assert.ok(!/user\d+|admin01|svc-lab/u.test(JSON.stringify(rule)), '규칙에 계정 이름이 없다');
    }
    const saved = JSON.parse(await readFile(rulesPath, 'utf8'));
    assert.equal(saved.rules.length, 43);
    for (const key of ['brute-force', 'web-injection', 'known-cve', 'persistence']) assert.ok(saved.rules.some(r => r.moduleKey === key), `${key} 규칙 보존`);
    const log = (await readFile(logPath, 'utf8')).trim().split('\n').filter(line => line.includes(' | privilege | '));
    assert.equal(log.length, 17);
    assert.ok(!log.some(line => /user\d+|admin01|svc-lab/u.test(line)), '알림 로그에 계정이 없다');
    assert.equal((await privilegeModule.respond(fixture.alerts, { rulesPath, logPath })).logLinesAdded, 0);
    // 관리 계정·서비스 계정의 정상 이벤트 주소는 막히지 않는다
    for (const ip of ['192.0.2.10', '198.51.100.10']) assert.equal(isDeniedAddress(saved.rules, ip, '2026-09-27T12:00:00+09:00'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('다섯 모듈 모의 재생: 공격 43건만 막히고 정상·애매한 계정은 통과하며 만료 뒤 풀린다', async () => {
  const result = await replay([
    { module: bruteForceModule, alerts: (await readJson('brute-force')).alerts },
    { module: webModule, alerts: (await readJson('web-injection')).alerts },
    { module: knownCveModule, alerts: (await readJson('known-cve')).alerts },
    { module: persistenceModule, alerts: (await readJson('persistence')).alerts },
    { module: privilegeModule, alerts: fixture.alerts },
  ]);
  assert.deepEqual(
    { attackDenied: result.attackDenied, attackTotal: result.attackTotal, normalDenied: result.normalDenied, ambiguousDenied: result.ambiguousDenied, expiredDenied: result.expiredDenied },
    { attackDenied: 43, attackTotal: 43, normalDenied: 0, ambiguousDenied: 0, expiredDenied: 0 },
  );
  assert.deepEqual(result.byModule.privilege, { rules: 9, attackDenied: 9, attackTotal: 9, normalDenied: 0, ambiguousDenied: 0 });
});
