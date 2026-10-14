import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDetection } from '../scripts/detect-test.mjs';
import { detect } from '../src/detect.mjs';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);
const reads = (count, { owner = 'learner_fixture', intervalSeconds = 2, start = START, method = 'GET', ...extra } = {}) =>
  Array.from({ length: count }, (_, i) => ({
    at: new Date(start + i * intervalSeconds * 1000).toISOString(), method, identity: { sub: owner }, ...extra,
  }));
const propose = subject => ({ action: 'propose_revocation', reasonCode: 'burst_read', subject });
const OBSERVE = { action: 'observe' };

test('제공된 탐지 연습 여섯 항목이 모두 통과한다', async () => {
  const results = await checkDetection(detect);
  assert.equal(results.length, 6);
  for (const item of results) assert.equal(item.passed, true, item.name);
});

test('복합 의심 사건: 처음 보는 네트워크와 다량 조회가 함께 있으면 회수를 제안한다', () => {
  assert.deepEqual(detect(reads(121, { network: 'unusual' })), propose('learner_fixture'));
  assert.deepEqual(detect(reads(300, { network: 'unusual', region: 'foreign' })), propose('learner_fixture'));
  // 구간 안에 처음 보는 네트워크가 한 건이라도 섞여 있으면 복합 조건이다.
  const mixed = reads(150, { network: 'usual' });
  mixed[75] = { ...mixed[75], network: 'unusual' };
  assert.deepEqual(detect(mixed), propose('learner_fixture'));
  // signals.network 모양도 읽는다.
  assert.deepEqual(detect(reads(130, { signals: { network: 'unusual' } })), propose('learner_fixture'));
});

test('정상 사건은 그대로 둔다: 평소 네트워크의 다량 조회, 처음 보는 네트워크의 적은 조회', () => {
  assert.deepEqual(detect(reads(200, { network: 'usual' })), OBSERVE); // 다량이어도 평소 네트워크
  assert.deepEqual(detect(reads(30, { network: 'unusual' })), OBSERVE); // 처음 보는 네트워크지만 조회가 적음
  assert.deepEqual(detect(reads(120, { network: 'unusual' })), OBSERVE); // 정확히 120건은 해당 없음
  assert.deepEqual(detect(reads(30)), OBSERVE);
  assert.deepEqual(detect([]), OBSERVE);
});

test('지역 하나만으로는 확정하지 않는다', () => {
  assert.deepEqual(detect(reads(30, { region: 'foreign' })), OBSERVE);
  assert.deepEqual(detect(reads(30, { region: 'foreign', network: 'usual' })), OBSERVE);
  assert.deepEqual(detect(reads(200, { region: 'foreign', network: 'usual' })), OBSERVE);
  assert.deepEqual(detect(reads(60, { signals: { region: 'foreign', network: 'usual', hour: 3 } })), OBSERVE);
});

test('네트워크 값이 없는 사건(연습 계약 모양)은 계약대로 다량 조회만 본다', () => {
  assert.deepEqual(detect(reads(121)), propose('learner_fixture'));
  assert.deepEqual(detect(reads(120)), OBSERVE);
});

test('사용자별로 따로 센다: 다른 사용자의 사건을 합산하지 않고 의심 사용자만 지목한다', () => {
  const both = [...reads(100, { network: 'unusual' }), ...reads(100, { owner: 'other_fixture', network: 'unusual' })]
    .sort((a, b) => a.at.localeCompare(b.at));
  assert.deepEqual(detect(both), OBSERVE);
  const mixed = [...reads(130, { owner: 'heavy_user', network: 'unusual' }), ...reads(40, { owner: 'normal_user', network: 'usual' })]
    .sort((a, b) => a.at.localeCompare(b.at));
  assert.deepEqual(detect(mixed), propose('heavy_user'));
});

test('10분 구간 기준: 흩어진 조회는 합치지 않고, 입력 순서가 뒤섞여도 같은 결과다', () => {
  assert.deepEqual(detect(reads(200, { intervalSeconds: 7, network: 'unusual' })), OBSERVE); // 10분 밖으로 흩어짐
  // 5초 간격 121건은 양 끝이 정확히 10분 차이이며 구간 양 끝을 포함하므로 해당한다.
  assert.deepEqual(detect(reads(121, { intervalSeconds: 5, network: 'unusual' })), propose('learner_fixture'));
  // 6초 간격 121건은 양 끝이 12분 차이라 한 구간에 120건을 넘지 않는다.
  assert.deepEqual(detect(reads(121, { intervalSeconds: 6, network: 'unusual' })), OBSERVE);
  const shuffled = reads(150, { network: 'unusual' }).reverse();
  assert.deepEqual(detect(shuffled), propose('learner_fixture'));
  // 두 번으로 나뉜 조회가 각각 120건 이하이면 합치지 않는다.
  const twoBursts = [...reads(100, { network: 'unusual' }), ...reads(100, { network: 'unusual', start: START + 3 * 60 * 60 * 1000 })];
  assert.deepEqual(detect(twoBursts), OBSERVE);
});

test('조회(GET)만 센다: 쓰기 사건은 다량 조회에 포함하지 않는다', () => {
  assert.deepEqual(detect(reads(200, { method: 'POST', network: 'unusual' })), OBSERVE);
  const half = [...reads(70, { network: 'unusual' }), ...reads(70, { network: 'unusual', method: 'PUT', start: START + 1000 })];
  assert.deepEqual(detect(half), OBSERVE);
});

test('결과에는 이름 몇 개만 담기고 사건 내용·네트워크 값·토큰은 담지 않는다', () => {
  const marker = ['tok', 'MARKER', '777'].join('-');
  // 기기 값이 없는 사건은 계약이 정한 세 이름, 확인된 기기가 있으면 기기 식별자 하나가 더해진다.
  const noDevice = detect(reads(130, { network: 'unusual', decision: 'allow', token: marker, title: marker, body: marker }));
  assert.deepEqual(Object.keys(noDevice).sort(), ['action', 'reasonCode', 'subject']);
  const withDevice = detect(reads(130, { network: 'unusual', deviceId: 'a'.repeat(16), decision: 'allow', token: marker, title: marker, body: marker }));
  assert.deepEqual(Object.keys(withDevice).sort(), ['action', 'deviceId', 'reasonCode', 'subject']);
  const result = withDevice;
  assert.ok(!JSON.stringify(result).includes(marker));
  assert.ok(!JSON.stringify(result).includes('unusual'));
  // 사용자 식별자로 쓸 수 없는 값(실명·이메일)은 사건 자체를 읽지 않으므로 지목되지도 않는다.
  assert.deepEqual(detect(reads(200, { owner: '홍길동', network: 'unusual' })), OBSERVE);
  assert.deepEqual(detect(reads(200, { owner: ['a', 'b.invalid'].join('@'), network: 'unusual' })), OBSERVE);
});

test('이상한 입력은 오류 없이 처리하고 배열이 아니면 값을 노출하지 않는 오류를 낸다', () => {
  assert.deepEqual(detect([null, 'x', 7, {}, { at: 'bad', method: 'GET' }]), OBSERVE);
  for (const bad of [null, undefined, {}, 'x']) assert.throws(() => detect(bad), error => error.message === 'invalid_detection_events');
});
