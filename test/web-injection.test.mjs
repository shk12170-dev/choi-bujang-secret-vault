import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { replay } from '../scripts/xdr-replay.mjs';
import * as bruteForceModule from '../xdr/brute-force/respond.mjs';
import { decide } from '../xdr/web-injection/decide.mjs';
import { readAlerts } from '../xdr/web-injection/read-alerts.mjs';
import * as webModule from '../xdr/web-injection/respond.mjs';
import { isDeniedAddress } from '../xdr/ztna-overlay.mjs';

const fixturePath = new URL('../xdr/fixtures/web-injection.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const bfFixture = JSON.parse(await readFile(new URL('../xdr/fixtures/brute-force.json', import.meta.url), 'utf8'));
const decideSource = await readFile(new URL('../xdr/web-injection/decide.mjs', import.meta.url), 'utf8');
const num = id => Number(id.slice(3));
const expectedFor = id => (num(id) <= 8 ? 'block' : num(id) <= 17 ? 'alert' : 'record');
const base = { id: 'v', timestamp: '2026-10-12T00:00:00Z' };
const web = (description, level, count, url) => ({ ...base, rule: { level, mitre: ['T1190'], description }, data: { srcip: '203.0.113.200', url, ...(count === undefined ? {} : { count: String(count) }) } });

test('경보 읽기 모듈은 경보 건수와 뽑은 줄 수가 같고 요청 주소 원문을 내보내지 않는다', () => {
  const rows = readAlerts(fixturePath);
  assert.equal(rows.length, fixture.alerts.length);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['account', 'at', 'description', 'id', 'level', 'srcip']);
  assert.ok(!JSON.stringify(rows).includes('/search?'));
});

test('명확한 공격은 block, 애매한 시도는 alert, 정상 이벤트는 record로 나뉜다', () => {
  for (const alert of fixture.alerts) {
    const out = decide(alert);
    assert.equal(out.action, expectedFor(alert.id), `${alert.id}: ${out.reason}`);
    assert.ok(Number.isFinite(out.confidence) && out.confidence >= 0 && out.confidence <= 1);
    assert.equal(out.action, out.confidence >= 0.85 ? 'block' : out.confidence >= 0.5 ? 'alert' : 'record');
    assert.ok(!out.reason.includes(alert.data.url ?? '\u0000') || alert.data.url === '/', '이유에 요청 주소 원문이 없다');
  }
});

test('경보 번호·주소·순서를 바꿔도 같은 판단이 나온다(정답 고정 없음)', () => {
  fixture.alerts.forEach((alert, i) => {
    const moved = { ...alert, id: `zz-${i}`, data: { ...alert.data, srcip: `198.18.1.${i + 1}` } };
    assert.equal(decide(moved).action, decide(alert).action, alert.id);
  });
});

test('select·script·SQL 단어 하나, 수준, 태그만으로는 막지 않는다', () => {
  assert.notEqual(decide(web('주소에 select 라는 수업명이 여러 번 있습니다.', 12, 30, '/search?q=select-course')).action, 'block');
  assert.notEqual(decide(web('script 수업 자료를 30번 조회했습니다.', 12, 30, '/search?q=script-class')).action, 'block');
  assert.notEqual(decide(web('SQL 이라는 수업 공지 제목을 조회했습니다.', 14, 20, '/search?q=sql-class-notice')).action, 'block');
  assert.notEqual(decide(web('스크립트라는 단어가 있습니다. 삽입 표식은 아닙니다.', 12, 9, '/search?q=x')).action, 'block');
  assert.equal(decide(web('자료 목록을 조회했습니다.', 3, undefined, '/api/notes')).action, 'record');
});

test('실제 구문 형태의 변형도 구조·반복·수준이 맞으면 막고, 반복이 없으면 알림만 남긴다', () => {
  const sqlUrl = `/notes?q=${encodeURIComponent("1' OR '1'='1 UNION SELECT name FROM users")}`;
  assert.equal(decide(web('웹 요청 경보', 11, 6, sqlUrl)).action, 'block');
  assert.equal(decide(web('웹 요청 경보', 11, 1, sqlUrl)).action, 'alert');
  // 두 번 인코딩된 스크립트 태그
  const scriptUrl = `/search?q=${encodeURIComponent(encodeURIComponent('<script>alert(1)</script>'))}`;
  assert.equal(decide(web('웹 요청 경보', 12, 7, scriptUrl)).action, 'block');
  assert.equal(decide(web('웹 요청 경보', 12, 7, '/files?path=../../../etc/passwd')).action, 'block');
  assert.equal(decide(web('웹 요청 경보', 12, 7, '/files?path=..%2F..%2F..%2Fetc')).action, 'block');
  assert.equal(decide(web('웹 요청 경보', 12, 7, `/notes?q=${encodeURIComponent('a; cat /etc/hosts')}`)).action, 'block');
  // 구조가 있어도 수준이 낮으면 알림
  assert.equal(decide(web('웹 요청 경보', 6, 30, sqlUrl)).action, 'alert');
  // 아주 긴 주소·깨진 인코딩도 오류 없이 처리
  assert.ok(['alert', 'record', 'block'].includes(decide(web('웹 요청 경보', 6, 1, `/x?q=%E0%A4%A${'A'.repeat(10000)}`)).action));
});

test('제출용 decide.mjs는 import 없이 파일 하나로 독립 실행되고 결과가 같다', async () => {
  const code = decideSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /^\s*import\b|\bimport\(|\brequire\(|\bfetch\(|\bprocess\b|\bDate\b|readFile|writeFile|XMLHttpRequest|WebSocket|\beval\(|new Function/mu);
  const standalone = await import(`data:text/javascript;base64,${Buffer.from(decideSource).toString('base64')}`);
  for (const alert of fixture.alerts) assert.deepEqual(await standalone.decide(alert), decide(alert));
});

test('패턴 목록은 근거가 한 줄씩 있고 결정 모듈의 상수와 같은 이름·기법을 쓴다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/web-injection/patterns.json', import.meta.url), 'utf8'));
  assert.match(patterns.source, /T1190/u);
  for (const pattern of patterns.patterns) {
    assert.ok(pattern.name && pattern.condition, pattern.id);
    assert.ok(typeof pattern.evidence === 'string' && pattern.evidence.trim().length > 10 && !pattern.evidence.includes('\n'), pattern.id);
    assert.equal(pattern.technique, 'T1190');
    // decide.mjs 맨 위 상수에 이름·조건·근거가 그대로 옮겨져 있다.
    for (const field of ['name', 'condition', 'evidence']) assert.ok(decideSource.includes(pattern[field]), `${pattern.id}.${field}`);
    assert.ok(decideSource.includes(`id: '${pattern.id}'`), pattern.id);
  }
});

test('모든 판단의 reason에 근거 패턴 이름이 한 줄로 들어 있다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/web-injection/patterns.json', import.meta.url), 'utf8'));
  for (const alert of fixture.alerts) {
    const { reason } = decide(alert);
    assert.ok(patterns.patterns.some(pattern => reason.includes(pattern.id)), `${alert.id}: ${reason}`);
    assert.ok(!reason.includes('\n') && reason.length <= 200, alert.id);
  }
});

test('형식이 이상한 입력은 오류 없이 record로 남는다', () => {
  for (const bad of [null, undefined, 'x', 7, [], {}, { rule: null, data: 'x' }, { rule: { level: 'high', description: 5 }, data: { url: 42, count: 'abc' } }]) {
    const out = decide(bad);
    assert.equal(out.action, 'record');
    assert.ok(out.confidence >= 0 && out.confidence <= 1);
  }
});

test('차단 후보는 block만, 15분 만료·근거 번호가 있고 다른 모듈 규칙·알림 중복을 보존한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wi-'));
  try {
    const rulesPath = join(dir, 'deny-rules.json');
    const logPath = join(dir, 'alerts.log');
    await bruteForceModule.respond(bfFixture.alerts, { rulesPath, logPath });
    const result = await webModule.respond(fixture.alerts, { rulesPath, logPath });
    assert.deepEqual(result.counts, { block: 8, alert: 9, record: 9 });
    assert.equal(result.rules.length, 8);
    for (const rule of result.rules) {
      assert.equal(expectedFor(rule.evidenceAlertId), 'block');
      assert.equal(rule.moduleKey, 'web-injection');
      assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.issuedAt), 15 * 60 * 1000);
    }
    const saved = JSON.parse(await readFile(rulesPath, 'utf8'));
    assert.equal(saved.rules.filter(rule => rule.moduleKey === 'brute-force').length, 10, '다른 모듈 규칙 보존');
    assert.equal(saved.rules.length, 18);

    const log = (await readFile(logPath, 'utf8')).trim().split('\n');
    const webLines = log.filter(line => line.includes(' | web-injection | '));
    assert.equal(webLines.length, 17);
    assert.ok(!webLines.some(line => /user\d+|\/search\?|\/notes\?|\/files\?/u.test(line)), '알림 로그에 계정·요청 주소 원문이 없다');
    assert.equal((await webModule.respond(fixture.alerts, { rulesPath, logPath })).logLinesAdded, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('두 모듈 모의 재생: 공격 18건만 막히고, 겹친 주소는 모든 규칙이 끝난 뒤 풀린다', async () => {
  const result = await replay([
    { module: bruteForceModule, alerts: bfFixture.alerts },
    { module: webModule, alerts: fixture.alerts },
  ]);
  assert.deepEqual(
    { attackDenied: result.attackDenied, attackTotal: result.attackTotal, normalDenied: result.normalDenied, ambiguousDenied: result.ambiguousDenied, expiredDenied: result.expiredDenied },
    { attackDenied: 18, attackTotal: 18, normalDenied: 0, ambiguousDenied: 0, expiredDenied: 0 },
  );
  assert.deepEqual(result.sharedAddresses, ['203.0.113.10']);
  const rules = [...(await bruteForceModule.respond(bfFixture.alerts)).rules, ...(await webModule.respond(fixture.alerts)).rules];
  const shared = rules.filter(rule => rule.sourceIp === '203.0.113.10');
  const lastExpiry = shared.map(rule => rule.expiresAt).sort().at(-1);
  const firstExpiry = shared.map(rule => rule.expiresAt).sort()[0];
  assert.equal(isDeniedAddress(rules, '203.0.113.10', firstExpiry), true, '먼저 끝난 규칙 뒤에도 다른 모듈 규칙이 유효하면 거부');
  assert.equal(isDeniedAddress(rules, '203.0.113.10', lastExpiry), false, '마지막 규칙이 끝나면 풀림');
});
