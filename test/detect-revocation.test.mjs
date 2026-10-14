import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDetection } from '../scripts/detect-test.mjs';
import { detect } from '../src/detect.mjs';
import { decide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);
const DEVICE_A = 'a1b2c3d4e5f60718';
const DEVICE_B = 'f0e1d2c3b4a59687';
const reads = (count, { owner = 'learner_fixture', intervalSeconds = 2, start = START, method = 'GET', ...extra } = {}) =>
  Array.from({ length: count }, (_, i) => ({
    at: new Date(start + i * intervalSeconds * 1000).toISOString(), method, identity: { sub: owner }, ...extra,
  }));
const byTime = events => [...events].sort((x, y) => x.at.localeCompare(y.at));
const OBSERVE = { action: 'observe' };

test('연습 계약 모양의 사건은 계약이 정한 세 이름의 회수 제안을 그대로 돌려준다', async () => {
  assert.deepEqual(detect(reads(121)), { action: 'propose_revocation', reasonCode: 'burst_read', subject: 'learner_fixture' });
  const results = await checkDetection(detect);
  for (const item of results) assert.equal(item.passed, true, item.name);
});

test('의심 사건은 대상(사용자·확인된 기기 한 개)과 이유 코드가 있는 회수 제안을 낸다', () => {
  const result = detect(reads(130, { deviceId: DEVICE_A, network: 'unusual', decision: 'allow' }));
  assert.deepEqual(result, { action: 'propose_revocation', reasonCode: 'burst_read', subject: 'learner_fixture', deviceId: DEVICE_A });
  assert.equal(typeof result.deviceId, 'string'); // 배열이 아니라 기기 한 개
  assert.match(result.deviceId, /^[0-9a-f]{16}$/u);
  assert.ok(result.reasonCode.length > 0 && result.subject.length > 0);
});

test('정상 사건은 회수를 제안하지 않는다(기기 값이 있어도)', () => {
  assert.deepEqual(detect(reads(30, { deviceId: DEVICE_A, network: 'usual' })), OBSERVE);
  assert.deepEqual(detect(reads(200, { deviceId: DEVICE_A, network: 'usual' })), OBSERVE);
  assert.deepEqual(detect(reads(120, { deviceId: DEVICE_A, network: 'unusual' })), OBSERVE);
  assert.deepEqual(detect(reads(30, { deviceId: DEVICE_A, network: 'unusual' })), OBSERVE);
  assert.deepEqual(detect(reads(30, { deviceId: DEVICE_A, region: 'foreign' })), OBSERVE);
  assert.deepEqual(detect([]), OBSERVE);
});

test('정상 기기의 사건이 섞여 있어도 의심 기기 한 개만 지목한다', () => {
  // 사용자가 정상 기기로 읽는 중에 다른 기기가 처음 보는 네트워크에서 폭주 조회를 한다.
  const mixed = byTime([
    ...reads(40, { deviceId: DEVICE_A, network: 'usual', intervalSeconds: 10 }),
    ...reads(130, { deviceId: DEVICE_B, network: 'unusual', start: START + 5000 }),
  ]);
  const result = detect(mixed);
  assert.equal(result.action, 'propose_revocation');
  assert.equal(result.deviceId, DEVICE_B);
  assert.notEqual(result.deviceId, DEVICE_A); // 정상 기기는 유지된다
  assert.deepEqual(Object.keys(result).sort(), ['action', 'deviceId', 'reasonCode', 'subject']);
});

test('기기를 하나로 정할 수 없으면 범위를 넓히지 않고 제안하지 않는다', () => {
  // 두 기기가 같은 건수로 번갈아 폭주: 어느 기기인지 정할 수 없음
  const tie = byTime([
    ...reads(70, { deviceId: DEVICE_A, network: 'unusual' }),
    ...reads(70, { deviceId: DEVICE_B, network: 'unusual', start: START + 1000 }),
  ]);
  assert.deepEqual(detect(tie), OBSERVE);
  // 기기 값이 일부 사건에만 있음: 나머지 사건이 어느 기기인지 알 수 없음
  const partial = reads(130, { network: 'unusual' });
  partial[10] = { ...partial[10], deviceId: DEVICE_A };
  assert.deepEqual(detect(partial), OBSERVE);
  // 건수가 다르면 더 많은 기기 한 개
  const uneven = byTime([
    ...reads(90, { deviceId: DEVICE_A, network: 'unusual' }),
    ...reads(40, { deviceId: DEVICE_B, network: 'unusual', start: START + 1000 }),
  ]);
  assert.equal(detect(uneven).deviceId, DEVICE_A);
});

test('형식이 맞지 않는 기기 값은 기기로 확인하지 않는다', () => {
  for (const deviceId of ['A1B2C3D4E5F60718', 'a1b2c3d4e5f6071', 'a1b2c3d4e5f607189', 'device-1', '홍길동', 7, null]) {
    const result = detect(reads(130, { network: 'unusual', deviceId }));
    assert.equal(result.action, 'propose_revocation');
    assert.ok(!('deviceId' in result), String(deviceId)); // 확인된 기기가 없으므로 기기 한정도 없다(연습 계약 모양)
  }
});

test('제안에는 이유 코드와 대상 식별자만 담기고 사건 내용·토큰·네트워크·시각은 담기지 않는다', () => {
  const marker = ['tok', 'MARKER', '4242'].join('-');
  const result = detect(reads(130, {
    deviceId: DEVICE_A, network: 'unusual', token: marker, title: marker, body: marker,
    authorization: `Bearer ${marker}`, name: '홍길동', email: ['a', 'b.invalid'].join('@'),
  }));
  const dump = JSON.stringify(result);
  assert.ok(!dump.includes(marker) && !dump.includes('홍길동') && !dump.includes('b.invalid'));
  assert.ok(!dump.includes('unusual') && !dump.includes('2026'));
  assert.deepEqual(Object.keys(result).sort(), ['action', 'deviceId', 'reasonCode', 'subject']);
});

test('탐지는 접속 허용·거부 응답 형식을 바꾸지 않고 판정기도 그대로다', async () => {
  const { normal, suspicious } = fixtureRequests();
  for (const request of [normal, suspicious]) {
    const response = await decide({ ...request, requestId: crypto.randomUUID() });
    assert.deepEqual(Object.keys(response).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
    assert.ok(!('action' in response) && !('deviceId' in response) && !('subject' in response));
  }
  // 탐지 결과는 판정기 응답과 다른 이름·다른 함수의 결과다.
  const proposal = detect(reads(130, { deviceId: DEVICE_A, network: 'unusual' }));
  assert.ok(!('decision' in proposal) && !('ruleIds' in proposal));
});

test('탐지는 회수 API를 부르거나 기기 권한을 바꾸는 코드가 없다(제안만 돌려준다)', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/detect.mjs', import.meta.url), 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\bfetch\(|\bimport\s|\brequire\(|\bprocess\b|XMLHttpRequest|writeFile|appendFile|localStorage|console\./u);
  assert.doesNotMatch(code, /revoke\(|\.revoke|deleteDevice|setDevice|registerDevice|\/api\//u);
});
