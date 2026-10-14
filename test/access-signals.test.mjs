import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decide, readAccessSignals } from '../src/decider.mjs';

const { normal, suspicious } = fixtureRequests();
const copy = (base, patch = {}) => ({ ...base, requestId: randomUUID(), ...patch });

test('엔진이 넘긴 가상 사건은 출처 fixture로 분류되고 값이 그대로 읽힌다', () => {
  const out = readAccessSignals(suspicious);
  assert.equal(out.trust, 'fixture');
  assert.equal(out.usable, true);
  assert.deepEqual([out.source, out.region, out.network, out.hour], ['judge_fixture', 'foreign', 'unusual', 3]);
  assert.deepEqual(out.recentEvents, [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }]);
  assert.deepEqual(out.stepUp, { verified: false, authAgeSeconds: null });
  assert.deepEqual(out.problems, []);
});

test('실제 경로(source none)는 근거 없음이며 같이 온 값을 위치 증거로 쓰지 않는다', () => {
  const real = copy(normal, { signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 0 } });
  const out = readAccessSignals(real);
  assert.equal(out.trust, 'none');
  assert.equal(out.usable, false);
  assert.deepEqual([out.region, out.network, out.hour], [null, null, null]);
  // 근거가 없다는 값이 정상(local·usual)으로 바뀌지 않는다.
  const padded = readAccessSignals(copy(normal, { signals: { source: 'none', region: 'local', network: 'usual', hour: 14 } }));
  assert.deepEqual([padded.trust, padded.region, padded.network, padded.hour, padded.usable], ['none', null, null, null, false]);
});

test('위조한 클라이언트 헤더·위치 값은 신뢰하는 접속 정보로 승격되지 않는다', () => {
  const forged = copy(normal, {
    // 계약에 없는 이름으로 붙은 값들
    headers: { 'x-forwarded-for': '203.0.113.9', 'x-geo-region': 'local', 'x-network': 'usual' },
    geo: { region: 'local' }, region: 'local', network: 'usual', hour: 14, identity: { sub: 'admin' }, trusted: true,
    // 출처가 알 수 없는 signals
    signals: { source: 'client_header', region: 'local', network: 'usual', hour: 14, trusted: true },
  });
  const out = readAccessSignals(forged);
  assert.equal(out.trust, 'untrusted');
  assert.equal(out.usable, false);
  assert.deepEqual([out.region, out.network, out.hour], [null, null, null]);
  assert.ok(out.problems.some(item => item.startsWith('undeclared_names:')));
  assert.ok(out.problems.includes('signals_source_unknown'));
  // 어떤 값도 결과 객체 어디에도 복사되지 않는다.
  assert.ok(!JSON.stringify(out).includes('203.0.113.9'));
  assert.ok(!JSON.stringify(out).includes('"local"'));
});

test('출처 이름을 흉내 낸 변형(대소문자·공백·다른 이름)은 모두 출처 불명이다', () => {
  for (const source of ['Judge_Fixture', 'judge_fixture ', 'judge-fixture', 'fixture', 'engine', 'browser', '', 'NONE', 7, null, {}]) {
    const out = readAccessSignals(copy(normal, { signals: { source, region: 'foreign', network: 'unusual', hour: 3 } }));
    assert.equal(out.trust, 'untrusted', String(source));
    assert.equal(out.usable, false);
    assert.equal(out.region, null);
  }
});

test('지역·시각·네트워크·행동이 없거나 형태가 틀리면 채우지 않고 사용할 수 없다고 표시한다', () => {
  const only = signals => readAccessSignals(copy(normal, { signals: { source: 'judge_fixture', ...signals } }));
  for (const [signals, missing] of [
    [{ network: 'usual', hour: 14 }, 'region_unknown'],
    [{ region: 'local', hour: 14 }, 'network_unknown'],
    [{ region: 'local', network: 'usual' }, 'hour_unknown'],
    [{ region: 'unknown', network: 'usual', hour: 14 }, 'region_unknown'],
    [{ region: 'local', network: 'usual', hour: 24 }, 'hour_unknown'],
    [{ region: 'local', network: 'usual', hour: '14' }, 'hour_unknown'],
    [{ region: 'local', network: 'usual', hour: 1.5 }, 'hour_unknown'],
    [{ region: 'Local Host', network: 'usual', hour: 14 }, 'region_unknown'],
  ]) {
    const out = only(signals);
    assert.equal(out.usable, false, JSON.stringify(signals));
    assert.ok(out.problems.includes(missing), `${JSON.stringify(signals)} → ${out.problems}`);
  }
  // 행동(recentEvents)이 없거나 형태가 틀리면 빈 목록이고, 임의 항목을 만들지 않는다.
  const noEvents = copy(normal);
  delete noEvents.recentEvents;
  assert.deepEqual(readAccessSignals(noEvents).recentEvents, []);
  assert.deepEqual(readAccessSignals(copy(normal, { recentEvents: 'many' })).recentEvents, []);
  assert.deepEqual(readAccessSignals(copy(normal, { recentEvents: Array.from({ length: 13 }, () => ({ kind: 'x', ageSeconds: 1, count: 1 })) })).recentEvents, []);
  const mixed = readAccessSignals(copy(normal, { recentEvents: [{ kind: 'risk_signal', ageSeconds: 5, count: 3 }, { kind: 'Bad Kind', ageSeconds: -1, count: 'x' }, null] }));
  assert.deepEqual(mixed.recentEvents, [{ kind: 'risk_signal', ageSeconds: 5, count: 3 }]);
  assert.ok(mixed.problems.includes('recent_events_invalid_items'));
});

test('재인증 값은 형태가 맞고 범위 안일 때만 검증됨으로 읽는다', () => {
  const read = stepUp => readAccessSignals(copy(normal, { stepUp })).stepUp;
  assert.deepEqual(read({ verified: true, authAgeSeconds: 60 }), { verified: true, authAgeSeconds: 60 });
  assert.deepEqual(read({ verified: true, authAgeSeconds: 900 }), { verified: true, authAgeSeconds: 900 });
  for (const bad of [
    { verified: true, authAgeSeconds: 901 }, { verified: true, authAgeSeconds: -1 }, { verified: true, authAgeSeconds: null },
    { verified: 'true', authAgeSeconds: 60 }, { verified: true }, { verified: false, authAgeSeconds: 60 }, null, 'yes', undefined,
  ]) {
    assert.deepEqual(read(bad), { verified: false, authAgeSeconds: null }, JSON.stringify(bad));
  }
});

test('형식이 이상한 요청 전체도 오류 없이 출처 불명으로 돌려준다', () => {
  for (const bad of [null, undefined, 'x', 7, [], () => {}]) {
    const out = readAccessSignals(bad);
    assert.equal(out.trust, 'untrusted');
    assert.equal(out.usable, false);
    assert.deepEqual(out.recentEvents, []);
  }
});

test('입력 검사는 6단계 기기 규칙의 판정 결과를 바꾸지 않는다', async () => {
  assert.equal((await decide(copy(normal))).decision, 'allow');
  const unregistered = await decide(copy(normal, { deviceRegistered: false }));
  assert.deepEqual([unregistered.decision, unregistered.reasonCode], ['deny', 'device_not_registered']);
  // 위조한 위치 값은 판정을 바꾸지 못한다: 출처 불명 값으로는 추가 확인도 거부도 만들지 않는다.
  const forged = await decide(copy(suspicious, { signals: { source: 'client_header', region: 'foreign', network: 'unusual', hour: 3 } }));
  assert.equal(forged.decision, 'allow');
});
