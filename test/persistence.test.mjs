import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { replay } from '../scripts/xdr-replay.mjs';
import * as bruteForceModule from '../xdr/brute-force/respond.mjs';
import * as knownCveModule from '../xdr/known-cve/respond.mjs';
import { decide } from '../xdr/persistence/decide.mjs';
import { readAlerts } from '../xdr/persistence/read-alerts.mjs';
import * as persistenceModule from '../xdr/persistence/respond.mjs';
import * as webModule from '../xdr/web-injection/respond.mjs';
import { isDeniedAddress } from '../xdr/ztna-overlay.mjs';

const fixturePath = new URL('../xdr/fixtures/persistence.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const readJson = async name => JSON.parse(await readFile(new URL(`../xdr/fixtures/${name}.json`, import.meta.url), 'utf8'));
const decideSource = await readFile(new URL('../xdr/persistence/decide.mjs', import.meta.url), 'utf8');
const num = id => Number(id.slice(3));
const expectedFor = id => (num(id) <= 8 ? 'block' : num(id) <= 16 ? 'alert' : 'record');
const make = (description, level, data = {}) => ({
  id: 'v-1', timestamp: '2026-10-12T00:00:00Z', rule: { level, mitre: ['T1543'], description },
  data: { srcip: '203.0.113.200', srcuser: 'user09', ...data },
});
const TEMP = 'C:\\Users\\user09\\AppData\\Local\\Temp\\x.exe';

test('경보 읽기 모듈은 건수가 같고 파일 경로를 내보내지 않는다', () => {
  const rows = readAlerts(fixturePath);
  assert.equal(rows.length, fixture.alerts.length);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['account', 'at', 'description', 'id', 'level', 'srcip']);
  assert.ok(!JSON.stringify(rows).includes('AppData'));
});

test('명확한 공격은 block, 애매한 시도는 alert, 정상 이벤트는 record로 나뉜다', () => {
  for (const alert of fixture.alerts) {
    const out = decide(alert);
    assert.equal(out.action, expectedFor(alert.id), `${alert.id}: ${out.reason}`);
    assert.ok(Number.isFinite(out.confidence) && out.confidence >= 0 && out.confidence <= 1);
    assert.equal(out.action, out.confidence >= 0.85 ? 'block' : out.confidence >= 0.5 ? 'alert' : 'record');
  }
});

test('모든 reason에 근거 패턴 이름이 한 줄로 있고 경로·계정이 없다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/persistence/patterns.json', import.meta.url), 'utf8'));
  for (const alert of fixture.alerts) {
    const { reason } = decide(alert);
    assert.ok(patterns.patterns.some(pattern => reason.includes(pattern.id)), `${alert.id}: ${reason}`);
    assert.ok(!reason.includes('\n') && reason.length <= 260, alert.id);
    assert.ok(!/appdata|temp\\|user\d+|svc-lab/iu.test(reason), `${alert.id}: 이유에 경로·계정이 있다`);
  }
});

test('경보 번호·주소·계정·순서를 바꿔도 같은 판단이 나온다(정답 고정 없음)', () => {
  fixture.alerts.forEach((alert, i) => {
    const moved = { ...alert, id: `zz-${i}`, data: { ...alert.data, srcip: `198.18.3.${i + 1}`, srcuser: `u${i}` } };
    assert.equal(decide(moved).action, decide(alert).action, alert.id);
  });
});

test('서비스·예약 작업이라는 말, 서명 미확인, 수준 하나만으로는 막지 않는다', () => {
  assert.notEqual(decide(make('서비스 등록이 있습니다.', 13)).action, 'block');
  assert.notEqual(decide(make('예약 작업이 하나 있습니다. 서명은 확인되지 않았습니다.', 12, { path: 'C:\\lab\\a.cmd' })).action, 'block');
  assert.notEqual(decide(make('임시 폴더에 실행 파일이 하나 생겼습니다. 서비스 등록은 없습니다.', 12, { path: TEMP })).action, 'block');
  assert.notEqual(decide(make('시작 폴더 변경이 1건입니다. 이어서 실행된 기록은 없습니다.', 12)).action, 'block');
  assert.equal(decide(make('기존 수업 도구 서비스가 서명된 채로 실행 중입니다.', 3, { path: 'C:\\lab\\class-tool\\signed-service.exe' })).action, 'record');
  assert.equal(decide(make('운영체제 업데이트 예약이 평소 시각에 그대로입니다.', 2)).action, 'record');
});

test('지속 수단 + 의심 요인 둘 이상 + 수준 10 이상이면 막고, 수준이 낮으면 알림만 남긴다', () => {
  const unsignedTemp = make('서명 없는 서비스가 임시 폴더의 실행 파일을 가리킵니다.', 11, { path: TEMP });
  assert.equal(decide(unsignedTemp).action, 'block');
  // 요인 하나씩(서명 없음 또는 새 서비스)만으로는 막지 않고, 둘이 함께일 때 막는다.
  assert.notEqual(decide(make('서명 없는 서비스가 있습니다.', 12)).action, 'block');
  assert.notEqual(decide(make('새 서비스가 등록됐습니다.', 12)).action, 'block');
  assert.equal(decide(make('서명 없는 새 서비스가 있습니다.', 12)).action, 'block');
  assert.equal(decide({ ...unsignedTemp, rule: { ...unsignedTemp.rule, level: 8 } }).action, 'alert');
  assert.equal(decide(make('처음 보는 예약 작업이 수업 시간 밖에 실행됩니다.', 10)).action, 'block');
  assert.equal(decide(make('시작 폴더에 평소 목록에 없는 프로그램이 추가됐습니다.', 11, { path: 'C:\\Users\\user09\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.exe' })).action, 'block');
  // 경로 구분자가 /로 오거나 대소문자가 달라도 같다
  assert.equal(decide(make('서명 없는 서비스가 임시 폴더의 실행 파일을 가리킵니다.', 11, { path: 'c:/users/user09/appdata/local/temp/x.exe' })).action, 'block');
  // 아주 긴 값·이상한 형식도 오류 없이 처리
  assert.ok(['alert', 'record', 'block'].includes(decide(make('서비스', 12, { path: 'C:\\'.padEnd(20000, 'A'), count: { x: 1 } })).action));
});

test('제출용 decide.mjs는 import 없이 파일 하나로 독립 실행되고 결과가 같다', async () => {
  const code = decideSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /^\s*import\b|\bimport\(|\brequire\(|\bfetch\(|\bprocess\b|\bDate\b|readFile|writeFile|XMLHttpRequest|WebSocket|\beval\(|new Function/mu);
  const standalone = await import(`data:text/javascript;base64,${Buffer.from(decideSource).toString('base64')}`);
  for (const alert of fixture.alerts) assert.deepEqual(await standalone.decide(alert), decide(alert));
});

test('패턴 목록은 근거가 한 줄씩 있고 decide.mjs 상수에 이름·조건·근거가 그대로 있다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/persistence/patterns.json', import.meta.url), 'utf8'));
  assert.match(patterns.source, /T1543/u);
  assert.match(patterns.source, /T1053/u);
  for (const pattern of patterns.patterns) {
    assert.ok(typeof pattern.evidence === 'string' && pattern.evidence.trim().length > 10 && !pattern.evidence.includes('\n'), pattern.id);
    assert.match(pattern.technique, /^T1(543|053|547)(\.\d{3})?$/u);
    for (const field of ['name', 'condition', 'evidence']) assert.ok(decideSource.includes(pattern[field]), `${pattern.id}.${field}`);
    assert.ok(decideSource.includes(`"${pattern.id}"`), pattern.id);
  }
});

test('형식이 이상한 입력은 오류 없이 record로 남는다', () => {
  for (const bad of [null, undefined, 'x', 7, [], {}, { rule: null, data: 'x' }, { rule: { level: 'high', description: 5 }, data: { path: 42, count: 'abc' } }]) {
    const out = decide(bad);
    assert.equal(out.action, 'record');
    assert.ok(out.confidence >= 0 && out.confidence <= 1);
  }
});

test('차단 후보는 block만, 15분 만료·근거 번호가 있고 다른 모듈 규칙을 보존하며 로그에 경로·계정이 없다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ps-'));
  try {
    const rulesPath = join(dir, 'deny-rules.json');
    const logPath = join(dir, 'alerts.log');
    await bruteForceModule.respond((await readJson('brute-force')).alerts, { rulesPath, logPath });
    await webModule.respond((await readJson('web-injection')).alerts, { rulesPath, logPath });
    await knownCveModule.respond((await readJson('known-cve')).alerts, { rulesPath, logPath });
    const result = await persistenceModule.respond(fixture.alerts, { rulesPath, logPath });
    assert.deepEqual(result.counts, { block: 8, alert: 8, record: 8 });
    assert.equal(result.rules.length, 8);
    for (const rule of result.rules) {
      assert.equal(expectedFor(rule.evidenceAlertId), 'block');
      assert.equal(rule.moduleKey, 'persistence');
      assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.issuedAt), 15 * 60 * 1000);
      assert.ok(!/appdata|temp\\|user\d+/iu.test(JSON.stringify(rule)), '규칙에 경로·계정이 없다');
    }
    const saved = JSON.parse(await readFile(rulesPath, 'utf8'));
    assert.equal(saved.rules.length, 34);
    for (const key of ['brute-force', 'web-injection', 'known-cve']) assert.ok(saved.rules.some(r => r.moduleKey === key), `${key} 규칙 보존`);
    const log = (await readFile(logPath, 'utf8')).trim().split('\n').filter(line => line.includes(' | persistence | '));
    assert.equal(log.length, 16);
    assert.ok(!log.some(line => /user\d+|svc-lab|appdata|temp\\/iu.test(line)), '알림 로그에 계정·경로가 없다');
    assert.equal((await persistenceModule.respond(fixture.alerts, { rulesPath, logPath })).logLinesAdded, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('네 모듈 모의 재생: 공격 34건만 막히고 정상·애매한 PC는 통과하며 만료 뒤 풀린다', async () => {
  const result = await replay([
    { module: bruteForceModule, alerts: (await readJson('brute-force')).alerts },
    { module: webModule, alerts: (await readJson('web-injection')).alerts },
    { module: knownCveModule, alerts: (await readJson('known-cve')).alerts },
    { module: persistenceModule, alerts: fixture.alerts },
  ]);
  assert.deepEqual(
    { attackDenied: result.attackDenied, attackTotal: result.attackTotal, normalDenied: result.normalDenied, ambiguousDenied: result.ambiguousDenied, expiredDenied: result.expiredDenied },
    { attackDenied: 34, attackTotal: 34, normalDenied: 0, ambiguousDenied: 0, expiredDenied: 0 },
  );
  assert.deepEqual(result.byModule.persistence, { rules: 8, attackDenied: 8, attackTotal: 8, normalDenied: 0, ambiguousDenied: 0 });
  const { rules } = await persistenceModule.respond(fixture.alerts);
  const last = rules.map(rule => rule.expiresAt).sort().at(-1);
  assert.equal(isDeniedAddress(rules, rules[0].sourceIp, rules[0].issuedAt), true);
  assert.equal(isDeniedAddress(rules, rules[0].sourceIp, last), false);
});
