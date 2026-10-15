import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { replay } from '../scripts/xdr-replay.mjs';
import * as bruteForceModule from '../xdr/brute-force/respond.mjs';
import { decide } from '../xdr/exfiltration/decide.mjs';
import { readAlerts } from '../xdr/exfiltration/read-alerts.mjs';
import * as exfiltrationModule from '../xdr/exfiltration/respond.mjs';
import * as knownCveModule from '../xdr/known-cve/respond.mjs';
import * as persistenceModule from '../xdr/persistence/respond.mjs';
import * as privilegeModule from '../xdr/privilege/respond.mjs';
import * as webModule from '../xdr/web-injection/respond.mjs';
import { applyDenyOverlay, isDeniedDestination } from '../xdr/ztna-overlay.mjs';

const fixturePath = new URL('../xdr/fixtures/exfiltration.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const readJson = async name => JSON.parse(await readFile(new URL(`../xdr/fixtures/${name}.json`, import.meta.url), 'utf8'));
const decideSource = await readFile(new URL('../xdr/exfiltration/decide.mjs', import.meta.url), 'utf8');
const num = id => Number(id.slice(3));
const expectedFor = id => (num(id) <= 10 ? 'block' : num(id) <= 20 ? 'alert' : 'record');
const make = (description, level, data = {}) => ({
  id: 'v-1', timestamp: '2026-10-12T00:00:00Z', rule: { level, mitre: ['T1048'], description },
  data: { srcip: '192.0.2.200', srcuser: 'user09', dstip: '203.0.113.200', ...data },
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

test('모든 reason에 근거 패턴 이름이 한 줄로 있고 계정·목적지 주소가 없다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/exfiltration/patterns.json', import.meta.url), 'utf8'));
  for (const alert of fixture.alerts) {
    const { reason } = decide(alert);
    assert.ok(patterns.patterns.some(pattern => reason.includes(pattern.id)), `${alert.id}: ${reason}`);
    assert.ok(!reason.includes('\n') && reason.length <= 260, alert.id);
    assert.ok(!/user\d+|svc-lab|\d+\.\d+\.\d+\.\d+/u.test(reason), `${alert.id}: 이유에 계정·주소가 있다`);
  }
});

test('경보 번호·주소·계정·순서를 바꿔도 같은 판단이 나온다(정답 고정 없음)', () => {
  fixture.alerts.forEach((alert, i) => {
    const moved = { ...alert, id: `zz-${i}`, data: { ...alert.data, srcip: `198.18.5.${i + 1}`, srcuser: `u${i}`, dstip: `198.18.6.${i + 1}` } };
    assert.equal(decide(moved).action, decide(alert).action, alert.id);
  });
});

test('전송량·압축 파일·낯선 목적지·수준 하나만으로는 막지 않는다', () => {
  assert.notEqual(decide(make('전송량이 평소보다 높습니다.', 12, { bytes: '900000000', files: '1' })).action, 'block'); // 정황 없음
  assert.notEqual(decide(make('처음 보는 주소로 작은 파일이 2건 나갔습니다.', 12, { bytes: '400000', files: '2' })).action, 'block'); // 소량
  assert.notEqual(decide(make('수업 시간에 압축 파일 1건을 만들었습니다. 외부 전송은 아직 없습니다.', 12, { bytes: '300000000', files: '1', dstip: undefined })).action, 'block');
  assert.notEqual(decide(make('평소 목적지인데 파일 수가 늘었습니다.', 12, { bytes: '6000000', files: '12' })).action, 'block');
  assert.equal(decide(make('내 메모 한 건을 읽었습니다.', 3, { bytes: '2400', files: '1', dstip: '192.0.2.10' })).action, 'record');
  assert.equal(decide(make('로그아웃했습니다.', 3, { bytes: '300' })).action, 'record');
});

test('대량 전송 + 이상 정황 + 수준 10 이상이면 막고, 수준이 낮으면 알림만 남긴다', () => {
  const big = make('처음 보는 목적지로 큰 파일이 나갔습니다.', 11, { bytes: '90000000', files: '3' });
  assert.equal(decide(big).action, 'block');
  assert.equal(decide({ ...big, rule: { ...big.rule, level: 8 } }).action, 'alert');
  assert.equal(decide(make('수업 시간 밖에 압축 파일이 외부 주소로 나갔습니다.', 12, { bytes: '60000000', files: '1' })).action, 'block');
  assert.equal(decide(make('같은 목적지로 전송이 12번 반복됐습니다.', 11, { bytes: '70000000', count: '12' })).action, 'block');
  assert.equal(decide(make('처음 보는 주소로 나갔습니다.', 11, { bytes: '1000', files: '80' })).action, 'block'); // 파일 수가 많은 경우
  assert.ok(['alert', 'record', 'block'].includes(decide(make('처음 보는', 12, { bytes: { x: 1 }, files: 'abc', count: [] })).action));
});

test('제출용 decide.mjs는 import 없이 파일 하나로 독립 실행되고 결과가 같다', async () => {
  const code = decideSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /^\s*import\b|\bimport\(|\brequire\(|\bfetch\(|\bprocess\b|\bDate\b|readFile|writeFile|XMLHttpRequest|WebSocket|\beval\(|new Function/mu);
  const standalone = await import(`data:text/javascript;base64,${Buffer.from(decideSource).toString('base64')}`);
  for (const alert of fixture.alerts) assert.deepEqual(await standalone.decide(alert), decide(alert));
});

test('패턴 목록은 근거가 한 줄씩 있고 decide.mjs 상수에 이름·조건·근거가 그대로 있다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/exfiltration/patterns.json', import.meta.url), 'utf8'));
  assert.match(patterns.source, /T1041/u);
  assert.match(patterns.source, /T1048/u);
  for (const pattern of patterns.patterns) {
    assert.ok(typeof pattern.evidence === 'string' && pattern.evidence.trim().length > 10 && !pattern.evidence.includes('\n'), pattern.id);
    assert.match(pattern.technique, /^T10(41|48)$/u);
    for (const field of ['name', 'condition', 'evidence']) assert.ok(decideSource.includes(pattern[field]), `${pattern.id}.${field}`);
    assert.ok(decideSource.includes(`"${pattern.id}"`), pattern.id);
  }
});

test('형식이 이상한 입력은 오류 없이 record로 남는다', () => {
  for (const bad of [null, undefined, 'x', 7, [], {}, { rule: null, data: 'x' }, { rule: { level: 'high', description: 5 }, data: { bytes: {}, files: [], count: 'abc' } }]) {
    const out = decide(bad);
    assert.equal(out.action, 'record');
    assert.ok(out.confidence >= 0 && out.confidence <= 1);
  }
});

test('차단 후보는 block만, 목적지를 15분 막고 근거 번호가 있으며 정상 목적지와 다른 모듈 규칙을 보존한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ex-'));
  try {
    const rulesPath = join(dir, 'deny-rules.json');
    const logPath = join(dir, 'alerts.log');
    for (const [module, key] of [[bruteForceModule, 'brute-force'], [webModule, 'web-injection'], [knownCveModule, 'known-cve'], [persistenceModule, 'persistence'], [privilegeModule, 'privilege']]) {
      await module.respond((await readJson(key)).alerts, { rulesPath, logPath });
    }
    const result = await exfiltrationModule.respond(fixture.alerts, { rulesPath, logPath });
    assert.deepEqual(result.counts, { block: 10, alert: 10, record: 10 });
    assert.equal(result.rules.length, 10, '같은 목적지를 향한 경보도 규칙은 경보마다 하나씩이다');
    for (const rule of result.rules) {
      assert.equal(rule.moduleKey, 'exfiltration');
      assert.equal(rule.direction, 'egress');
      assert.ok(rule.destinationIp && !('sourceIp' in rule), '목적지 규칙이다');
      assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.issuedAt), 15 * 60 * 1000);
      assert.match(rule.evidenceAlertId, /^ex-\d+$/u);
      assert.ok(!/user\d+/u.test(JSON.stringify(rule)), '규칙에 계정 이름이 없다');
    }
    const saved = JSON.parse(await readFile(rulesPath, 'utf8'));
    for (const key of ['brute-force', 'web-injection', 'known-cve', 'persistence', 'privilege']) assert.ok(saved.rules.some(r => r.moduleKey === key), `${key} 규칙 보존`);
    // 정상 이벤트가 쓰는 자료실·수업 자료 주소는 막지 않는다.
    for (const ip of ['192.0.2.10', '198.51.100.10']) assert.equal(isDeniedDestination(saved.rules, ip, '2026-09-27T10:00:00+09:00'), false, ip);
    const log = (await readFile(logPath, 'utf8')).trim().split('\n').filter(line => line.includes(' | exfiltration | '));
    assert.equal(log.length, 20);
    assert.ok(!log.some(line => /user\d+|svc-lab/u.test(line)), '알림 로그에 계정이 없다');
    assert.equal((await exfiltrationModule.respond(fixture.alerts, { rulesPath, logPath })).logLinesAdded, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('여섯 모듈 모의 재생: 공격 53건만 막히고 정상·애매한 목적지는 통과하며 만료 뒤 풀린다', async () => {
  const result = await replay([
    { module: bruteForceModule, alerts: (await readJson('brute-force')).alerts },
    { module: webModule, alerts: (await readJson('web-injection')).alerts },
    { module: knownCveModule, alerts: (await readJson('known-cve')).alerts },
    { module: persistenceModule, alerts: (await readJson('persistence')).alerts },
    { module: privilegeModule, alerts: (await readJson('privilege')).alerts },
    { module: exfiltrationModule, alerts: fixture.alerts },
  ]);
  assert.deepEqual(
    { attackDenied: result.attackDenied, attackTotal: result.attackTotal, normalDenied: result.normalDenied, ambiguousDenied: result.ambiguousDenied, expiredDenied: result.expiredDenied },
    { attackDenied: 53, attackTotal: 53, normalDenied: 0, ambiguousDenied: 0, expiredDenied: 0 },
  );
  assert.deepEqual(result.byModule.exfiltration, { rules: 10, attackDenied: 10, attackTotal: 10, normalDenied: 0, ambiguousDenied: 0 });
  // 목적지 규칙은 그 목적지로 향하는 요청에만 걸리고, 같은 값을 출발 주소로 가진 요청은 막지 않는다.
  const { rules } = await exfiltrationModule.respond(fixture.alerts);
  const base = { decision: 'allow', reasonCode: 'mock', ruleIds: ['mock'] };
  const rule = rules[0];
  assert.equal(applyDenyOverlay({ base, rules, destinationIp: rule.destinationIp, at: rule.issuedAt }).decision, 'deny');
  assert.equal(applyDenyOverlay({ base, rules, sourceIp: rule.destinationIp, at: rule.issuedAt }), base);
  assert.equal(applyDenyOverlay({ base, rules, destinationIp: rule.destinationIp, at: new Date(Date.parse(rule.expiresAt) + 1000) }), base);
});
