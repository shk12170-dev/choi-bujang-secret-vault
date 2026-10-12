import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { replay } from '../scripts/xdr-replay.mjs';
import * as bruteForceModule from '../xdr/brute-force/respond.mjs';
import { decide } from '../xdr/brute-force/decide.mjs';
import { readAlerts } from '../xdr/brute-force/read-alerts.mjs';
import { applyDenyOverlay, isDeniedAddress, respond } from '../xdr/brute-force/respond.mjs';

const fixturePath = new URL('../xdr/fixtures/brute-force.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const decideSource = await readFile(new URL('../xdr/brute-force/decide.mjs', import.meta.url), 'utf8');
const num = id => Number(id.slice(3));
const expectedFor = id => (num(id) <= 10 ? 'block' : num(id) <= 19 ? 'alert' : 'record');

test('경보 읽기 모듈은 경보 건수와 뽑은 줄 수가 같다', () => {
  const rows = readAlerts(fixturePath);
  assert.equal(rows.length, fixture.alerts.length);
  assert.ok(rows.every(row => row.id !== '-' && row.at !== '-' && row.srcip !== '-'));
});

test('읽기 모듈은 비밀값처럼 보이는 값을 가려서 출력한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'));
  try {
    const path = join(dir, 'f.json');
    await writeFile(path, JSON.stringify({ schema: 'aleph.xdr.fixture.v1', alerts: [{
      id: 'x-1', timestamp: '2026-01-01T00:00:00Z',
      rule: { level: 5, description: 'token=abcDEF123456 실패 sb_secret_ZZZZZZZZZZZZ eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.sig12345' },
      data: { srcip: '192.0.2.1', srcuser: 'user01' },
    }] }));
    const [row] = readAlerts(path);
    assert.doesNotMatch(row.description, /abcDEF123456|sb_secret_ZZZ|eyJhbGci/u);
    assert.match(row.description, /\[가림\]/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('명확한 공격은 block, 애매한 시도는 alert, 정상 이벤트는 record로 나뉜다', () => {
  for (const alert of fixture.alerts) {
    const out = decide(alert);
    assert.equal(out.action, expectedFor(alert.id), `${alert.id}: ${out.reason}`);
    assert.ok(Number.isFinite(out.confidence) && out.confidence >= 0 && out.confidence <= 1);
    assert.equal(out.action, out.confidence >= 0.85 ? 'block' : out.confidence >= 0.5 ? 'alert' : 'record');
  }
});

test('경보 번호·주소·순서를 바꿔도 같은 판단이 나온다(정답 고정 없음)', () => {
  const shuffled = [...fixture.alerts].reverse().map((alert, i) => ({
    ...alert, id: `zz-${i}`, data: { ...alert.data, srcip: `198.18.0.${i + 1}` },
  }));
  const original = new Map(fixture.alerts.map(a => [JSON.stringify(a.rule) + JSON.stringify({ ...a.data, srcip: '' }), decide(a).action]));
  for (const alert of shuffled) {
    assert.equal(decide(alert).action, original.get(JSON.stringify(alert.rule) + JSON.stringify({ ...alert.data, srcip: '' })));
  }
});

test('수준·단어·태그 하나만으로는 막지 않는다(복합 조건)', () => {
  const base = { id: 'v', timestamp: '2026-10-12T00:00:00Z', data: { srcip: '203.0.113.200', srcuser: 'user09' } };
  // 수준만 높고 실패 집계가 적음 → 차단 아님
  assert.notEqual(decide({ ...base, rule: { level: 14, mitre: ['T1110'], description: '로그인 실패 4건이 있습니다.' }, data: { ...base.data, count: '4' } }).action, 'block');
  // 실패는 많지만 수준이 낮음 → 차단 아님
  assert.notEqual(decide({ ...base, rule: { level: 6, description: '로그인 실패 60건이 있습니다.' }, data: { ...base.data, count: '60' } }).action, 'block');
  // 실패는 많지만 오랜 시간에 걸침 → 차단 아님
  assert.notEqual(decide({ ...base, rule: { level: 12, description: '3시간 동안 로그인 실패 30건, 120분에 걸쳐 흩어졌습니다.' }, data: { ...base.data, count: '30' } }).action, 'block');
  // MITRE 태그만 있고 정상 로그인 → 기록
  assert.equal(decide({ ...base, rule: { level: 3, mitre: ['T1110'], description: '로그인이 성공했습니다.' } }).action, 'record');
  // 변형: 짧은 시간 실패 25건, 수준 11 → 차단
  assert.equal(decide({ ...base, rule: { level: 11, description: '4분 안에 로그인 실패 25건이 쌓였습니다.' }, data: { ...base.data, count: '25' } }).action, 'block');
  // 변형: 계정 6개에 같은 비밀번호, 수준 10 → 차단
  assert.equal(decide({ ...base, rule: { level: 10, description: '서로 다른 계정 6개에 같은 비밀번호 실패가 이어졌습니다.' }, data: { ...base.data, count: '6' } }).action, 'block');
});

test('제출용 decide.mjs는 import 없이 파일 하나로 독립 실행되고 결과가 같다', async () => {
  const code = decideSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /^\s*import\b|\bimport\(|\brequire\(|\bfetch\(|\bprocess\b|\bDate\b|readFile|writeFile|XMLHttpRequest|WebSocket/mu);
  const standalone = await import(`data:text/javascript;base64,${Buffer.from(decideSource).toString('base64')}`);
  for (const alert of fixture.alerts) assert.deepEqual(await standalone.decide(alert), decide(alert));
});

test('패턴 목록은 근거가 한 줄씩 있고 결정 모듈의 상수와 같은 이름·기법을 쓴다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/brute-force/patterns.json', import.meta.url), 'utf8'));
  assert.match(patterns.source, /T1110/u);
  for (const pattern of patterns.patterns) {
    assert.ok(pattern.name && pattern.condition, pattern.id);
    assert.ok(typeof pattern.evidence === 'string' && pattern.evidence.trim().length > 10 && !pattern.evidence.includes('\n'), pattern.id);
    assert.match(pattern.technique, /^T1110(\.00[1-4])?$/u);
    assert.ok(decideSource.includes(`id: '${pattern.id}'`) && decideSource.includes(`'${pattern.technique}'`) && decideSource.includes(pattern.name), pattern.id);
  }
});

test('형식이 이상한 입력은 오류 없이 record로 남는다', () => {
  for (const bad of [null, undefined, 'x', 7, [], {}, { rule: null, data: 'x' }, { rule: { level: 'high', description: 5 }, data: { count: 'abc' } }]) {
    const out = decide(bad);
    assert.equal(out.action, 'record');
    assert.ok(out.confidence >= 0 && out.confidence <= 1);
  }
});

test('차단 후보는 block만, 15분 만료와 근거 번호가 있고 다른 모듈 규칙·알림 중복을 보존한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'));
  try {
    const rulesPath = join(dir, 'deny-rules.json');
    const logPath = join(dir, 'alerts.log');
    const other = { sourceIp: '203.0.113.250', action: 'deny', confidence: 0.96, evidenceAlertId: 'wi-01', issuedAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-09-27T00:15:00.000Z', moduleKey: 'web-injection', reason: 'x' };
    await writeFile(rulesPath, JSON.stringify({ schema: 'aleph.xdr.deny-rules.v1', rules: [other] }));

    const result = await respond(fixture.alerts, { rulesPath, logPath });
    assert.deepEqual(result.counts, { block: 10, alert: 9, record: 9 });
    assert.equal(result.rules.length, 10);
    for (const rule of result.rules) {
      assert.equal(expectedFor(rule.evidenceAlertId), 'block');
      assert.equal(rule.action, 'deny');
      assert.equal(rule.moduleKey, 'brute-force');
      assert.ok(rule.confidence >= 0.85);
      assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.issuedAt), 15 * 60 * 1000);
      assert.equal(Date.parse(rule.issuedAt), Date.parse(fixture.alerts.find(a => a.id === rule.evidenceAlertId).timestamp));
    }
    const saved = JSON.parse(await readFile(rulesPath, 'utf8'));
    assert.ok(saved.rules.some(rule => rule.moduleKey === 'web-injection'), '다른 모듈 규칙 보존');

    const log = (await readFile(logPath, 'utf8')).trim().split('\n');
    assert.equal(log.length, 19);
    assert.ok(log.every(line => / \| brute-force \| (block|alert) \| bf-\d+ \| /u.test(line)));
    assert.ok(!log.some(line => /user\d+/u.test(line)), '알림 로그에 계정이 없다');
    assert.equal((await respond(fixture.alerts, { rulesPath, logPath })).logLinesAdded, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('모의 재생: 공격만 막히고 정상·애매한 주소는 통과하며 만료 뒤 기존 판정으로 돌아간다', async () => {
  const result = await replay([{ module: bruteForceModule, alerts: fixture.alerts }]);
  assert.deepEqual(
    { attackDenied: result.attackDenied, attackTotal: result.attackTotal, normalDenied: result.normalDenied, ambiguousDenied: result.ambiguousDenied, expiredDenied: result.expiredDenied },
    { attackDenied: 10, attackTotal: 10, normalDenied: 0, ambiguousDenied: 0, expiredDenied: 0 },
  );
  const { rules } = await respond(fixture.alerts);
  const base = { decision: 'allow', reasonCode: 'mock', ruleIds: ['mock'] };
  const rule = rules[0];
  assert.equal(applyDenyOverlay({ base, rules, sourceIp: rule.sourceIp, at: new Date(Date.parse(rule.issuedAt) - 1000) }), base, '발급 전에는 기존 판정');
  // 같은 주소의 규칙이 여러 개면(bf-01·bf-02) 마지막 규칙이 끝나야 풀린다.
  const sameIp = rules.filter(r => r.sourceIp === rule.sourceIp);
  assert.ok(sameIp.length >= 2, '같은 주소 규칙이 둘 이상인 경우를 시험한다');
  assert.equal(isDeniedAddress(rules, rule.sourceIp, rule.expiresAt), true, '첫 규칙이 끝나도 다른 규칙이 유효하면 계속 거부');
  const lastExpiry = sameIp.map(r => r.expiresAt).sort().at(-1);
  assert.equal(isDeniedAddress(rules, rule.sourceIp, lastExpiry), false, '마지막 규칙의 만료 시각에는 풀림');
  assert.equal(applyDenyOverlay({ base, rules, sourceIp: '10.0.0.1', at: rule.issuedAt }), base, '내부망 주소는 overlay가 막지 않음');
});

test('내부망 주소와 정상 이벤트가 같은 주소에서 확인된 경우는 막지 않는다', async () => {
  const attack = (id, ip) => ({ id, timestamp: '2026-10-12T00:00:00Z', rule: { level: 12, description: '같은 주소에서 2분 안에 로그인 실패 48건이 쌓였습니다.' }, data: { srcip: ip, srcuser: 'user01', count: '48' } });
  const normal = (id, ip) => ({ id, timestamp: '2026-10-12T00:00:01Z', rule: { level: 3, description: '로그인이 성공했습니다.' }, data: { srcip: ip, srcuser: 'user02' } });
  const result = await respond([
    attack('t-1', '10.0.0.5'), attack('t-2', '192.168.1.9'), attack('t-3', '127.0.0.1'),
    attack('t-4', '198.51.100.77'), normal('t-5', '198.51.100.77'), attack('t-6', '203.0.113.99'),
    { ...attack('t-7', '203.0.113.98'), timestamp: 'not-a-time' },
  ]);
  assert.deepEqual(result.rules.map(r => r.sourceIp), ['203.0.113.99']);
  assert.equal(result.skipped.length, 5);
});
