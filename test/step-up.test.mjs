import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { checkDecider } from '../scripts/decider-test.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { RULE_IDS, decide, describeStepUp } from '../src/decider.mjs';

const { normal, suspicious } = fixtureRequests();
const make = (patch = {}) => ({ ...suspicious, requestId: randomUUID(), ...patch });
const fixtureSignals = (signals, recentEvents = suspicious.recentEvents) => make({ signals: { source: 'judge_fixture', ...signals }, recentEvents });
const burst = (count = 20, ageSeconds = 60, kind = 'risk_signal') => [{ kind, ageSeconds, count }];
const answer = async request => ({ request, response: await decide(request) });

function assertValid({ request, response }) {
  assert.equal(Object.keys(response).sort().join(','), 'decision,reasonCode,requestId,ruleIds,schema');
  assert.equal(response.requestId, request.requestId);
  assert.ok(['allow', 'deny', 'step_up'].includes(response.decision));
  assert.match(response.reasonCode, /^[a-z][a-z0-9_]{0,63}$/u);
  assert.ok(response.ruleIds.length > 0 && response.ruleIds.every(id => RULE_IDS.includes(id)));
}

test('규칙 이름 step_up_required가 등록되어 있고 기기 규칙·기본 거부도 남아 있다', () => {
  for (const id of ['starter.deny', 'device_registered', 'step_up_required']) assert.ok(RULE_IDS.includes(id), id);
  assert.equal(new Set(RULE_IDS).size, RULE_IDS.length);
});

test('정해진 복합 사건은 추가 확인(step_up)과 이유 코드 step_up_required로 나온다', async () => {
  const item = await answer(make());
  assertValid(item);
  assert.deepEqual(
    [item.response.decision, item.response.reasonCode, item.response.ruleIds],
    ['step_up', 'step_up_required', ['step_up_required']],
  );
});

test('정상 사건은 허용으로 나온다', async () => {
  const item = await answer({ ...normal, requestId: randomUUID() });
  assertValid(item);
  assert.deepEqual([item.response.decision, item.response.reasonCode], ['allow', 'approved']);
});

test('사유가 요소별로 남는다: 시각·네트워크·읽기 급증(지역은 참고 표시뿐)', () => {
  const full = describeStepUp(make());
  assert.deepEqual(full.factors, { unusual_hour: true, unusual_network: true, read_burst: true });
  assert.equal(full.region_foreign, true);
  assert.equal(full.matched, true);
  const quiet = describeStepUp({ ...normal, requestId: randomUUID() });
  assert.deepEqual(quiet.factors, { unusual_hour: false, unusual_network: false, read_burst: false });
  assert.equal(quiet.matched, false);
  // 사유 객체에 주소·값 원문이 들어가지 않는다.
  assert.deepEqual(Object.keys(full).sort(), ['evaluated', 'factors', 'matched', 'region_foreign', 'stepUp']);
});

test('지역 하나만으로는 추가 확인도 거부도 만들지 않는다', async () => {
  const onlyRegion = await answer(fixtureSignals({ region: 'foreign', network: 'usual', hour: 14 }, []));
  assertValid(onlyRegion);
  assert.deepEqual([onlyRegion.response.decision, onlyRegion.response.reasonCode], ['allow', 'approved']);
  assert.equal(describeStepUp(onlyRegion.request).region_foreign, true);
  // 지역이 평소와 같아도 세 요소가 겹치면 추가 확인이다(지역은 근거가 아니다).
  const localButComplex = await answer(fixtureSignals({ region: 'local', network: 'unusual', hour: 3 }));
  assert.equal(localButComplex.response.decision, 'step_up');
});

test('요소가 하나나 둘뿐이면 추가 확인을 보내지 않는다', async () => {
  const cases = {
    '시각만 다름': fixtureSignals({ region: 'local', network: 'usual', hour: 3 }, []),
    '네트워크만 다름': fixtureSignals({ region: 'local', network: 'unusual', hour: 14 }, []),
    '읽기 급증만': fixtureSignals({ region: 'local', network: 'usual', hour: 14 }, burst()),
    '시각+네트워크': fixtureSignals({ region: 'local', network: 'unusual', hour: 3 }, []),
    '시각+급증': fixtureSignals({ region: 'local', network: 'usual', hour: 3 }, burst()),
    '네트워크+급증': fixtureSignals({ region: 'local', network: 'unusual', hour: 14 }, burst()),
  };
  for (const [name, request] of Object.entries(cases)) {
    const item = await answer(request);
    assertValid(item);
    assert.equal(item.response.decision, 'allow', name);
  }
});

test('읽기 급증 기준: 종류·시간·건수가 맞아야 한다', async () => {
  const signals = { region: 'foreign', network: 'unusual', hour: 3 };
  const decision = async events => (await decide(fixtureSignals(signals, events))).decision;
  assert.equal(await decision(burst(10, 600)), 'step_up'); // 경계값
  assert.equal(await decision([{ kind: 'risk_signal', ageSeconds: 100, count: 6 }, { kind: 'risk_signal', ageSeconds: 200, count: 4 }]), 'step_up'); // 합산
  assert.equal(await decision(burst(9, 60)), 'allow'); // 건수 부족
  assert.equal(await decision(burst(50, 601)), 'allow'); // 오래된 사건
  assert.equal(await decision(burst(50, 60, 'login_success')), 'allow'); // 알 수 없는 종류는 세지 않음
  assert.equal(await decision([]), 'allow');
});

test('평소와 다른 시각 기준: 7~21시는 평소, 그 밖은 평소와 다름', async () => {
  const decision = async hour => (await decide(fixtureSignals({ region: 'foreign', network: 'unusual', hour }))).decision;
  for (const hour of [0, 3, 6, 22, 23]) assert.equal(await decision(hour), 'step_up', `hour ${hour}`);
  for (const hour of [7, 12, 14, 21]) assert.equal(await decision(hour), 'allow', `hour ${hour}`);
});

test('다시 확인한 요청(stepUp 검증됨)은 허용하고, 범위를 벗어난 값은 인정하지 않는다', async () => {
  const verified = await answer(make({ stepUp: { verified: true, authAgeSeconds: 60 } }));
  assertValid(verified);
  assert.deepEqual([verified.response.decision, verified.response.reasonCode], ['allow', 'approved']);
  for (const stepUp of [
    { verified: true, authAgeSeconds: 901 }, { verified: true, authAgeSeconds: -5 }, { verified: true, authAgeSeconds: null },
    { verified: 'true', authAgeSeconds: 10 }, { verified: true }, null,
  ]) {
    const item = await answer(make({ stepUp }));
    assert.equal(item.response.decision, 'step_up', JSON.stringify(stepUp));
  }
});

test('출처가 불명확하거나 실제 경로(source none)의 값은 추가 확인의 근거가 되지 않는다', async () => {
  for (const signals of [
    { source: 'client_header', region: 'foreign', network: 'unusual', hour: 3 },
    { source: 'none', region: 'foreign', network: 'unusual', hour: 3 },
    { source: 'none', region: 'unknown', network: 'unknown', hour: 3 },
  ]) {
    const item = await answer(make({ signals }));
    assertValid(item);
    assert.equal(item.response.decision, 'allow', signals.source);
  }
  // 값이 빠진 가상 사건도 임의의 값으로 채워 판단하지 않는다.
  const missingNetwork = await answer(make({ signals: { source: 'judge_fixture', region: 'foreign', hour: 3 } }));
  assert.equal(missingNetwork.response.decision, 'allow');
});

test('기기 규칙이 먼저다: 미등록 기기는 복합 사건이어도 device_not_registered로 거부된다', async () => {
  const item = await answer(make({ deviceRegistered: false }));
  assertValid(item);
  assert.deepEqual([item.response.decision, item.response.reasonCode, item.response.ruleIds], ['deny', 'device_not_registered', ['device_registered']]);
  // 등록 기기라도 읽기가 아니면 기존처럼 기본 거부다.
  const write = await answer(make({ method: 'POST' }));
  assert.deepEqual([write.response.decision, write.response.ruleIds], ['deny', ['starter.deny']]);
});

test('이 규칙은 거부(deny)를 만들지 않는다: 어떤 조합에서도 영구 차단 없음', async () => {
  const hours = [0, 3, 12, 14, 23];
  for (const region of ['foreign', 'local', 'unknown', 'x']) {
    for (const network of ['usual', 'unusual']) {
      for (const hour of hours) {
        for (const events of [[], burst()]) {
          const { response } = await answer(fixtureSignals({ region, network, hour }, events));
          assert.notEqual(response.decision, 'deny');
        }
      }
    }
  }
});

test('제공된 연습 스크립트(decider:test)의 네 항목이 모두 통과한다', async () => {
  const results = await checkDecider({ decide, ruleIds: RULE_IDS });
  assert.equal(results.length, 4);
  for (const item of results) assert.equal(item.passed, true, item.name);
});

test('판정기는 토큰·헤더 같은 민감 값을 읽거나 기록하거나 응답에 되돌리지 않는다', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/decider.mjs', import.meta.url), 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\bconsole\./u);
  assert.doesNotMatch(code, /\bprocess\b|\bfetch\(|\bimport\s|\brequire\(|writeFile|appendFile|localStorage/u);
  assert.doesNotMatch(code, /request\??\.(authorization|token|headers|cookie)\b/iu);
  // 계약에 없는 이름으로 토큰이 붙어 와도 응답·사유 어디에도 나타나지 않는다.
  const marker = ['tok', 'MARKER', '0123456789'].join('-');
  const request = make({ authorization: `Bearer ${marker}`, token: marker, headers: { cookie: marker }, stepUp: { verified: false, authAgeSeconds: null } });
  const { response } = await answer(request);
  assert.ok(!JSON.stringify(response).includes(marker));
  assert.ok(!JSON.stringify(describeStepUp(request)).includes(marker));
});

test('직접 확인: 정상과 복합 이상 사건의 판정이 다르고, 추가 확인 응답에는 자료가 실리지 않는다', async () => {
  const ordinary = await decide({ ...normal, requestId: randomUUID() });
  const unusual = await decide(make());
  assert.notEqual(ordinary.decision, unusual.decision);
  assert.deepEqual([ordinary.decision, unusual.decision], ['allow', 'step_up']);
  // 추가 확인(step_up) 응답은 결정에 필요한 5개 이름뿐이고, 메모·본문·토큰 같은 자료 필드가 없다.
  assert.deepEqual(Object.keys(unusual).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  for (const value of Object.values(unusual)) assert.ok(typeof value === 'string' || Array.isArray(value));
  assert.ok(unusual.ruleIds.every(id => RULE_IDS.includes(id)));
  assert.ok(!/title|body|content|notes|memo|token|authorization/iu.test(JSON.stringify(unusual)));
  // 추가 확인이 필요한 사건에서 판정기는 자료를 읽어 오지 않는다(데이터 접근 코드가 없다).
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/decider.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n'), /supabase|\.from\(|\/api\/notes|user_notes|fetch\(/iu);
});
