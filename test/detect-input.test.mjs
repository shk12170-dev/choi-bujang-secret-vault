import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { detect, readDetectionEvents } from '../src/detect.mjs';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);
const reads = (count, { owner = 'learner_fixture', intervalSeconds = 2, extra = {} } = {}) => Array.from({ length: count }, (_, i) => ({
  at: new Date(START + i * intervalSeconds * 1000).toISOString(), method: 'GET', identity: { sub: owner }, ...extra,
}));
// 비밀값·실명·본문 모양의 값은 파일에 적지 않고 실행할 때 조립합니다.
const secrets = {
  token: ['tok', 'MARKER', '1234567890'].join('-'),
  bearer: `Bearer ${['aaa', 'bbb', 'ccc'].join('.')}`,
  memoBody: '이 메모 본문은 저장하면 안 됩니다',
  memoTitle: '비밀 메모 제목',
  realName: '홍길동',
  email: ['someone', 'example.invalid'].join('@'),
  cookie: ['session', 'COOKIEVALUE'].join('='),
};

test('정상 사건과 의심 사건(연습 계약 모양)을 그대로 읽는다', () => {
  const normal = readDetectionEvents(reads(30));
  assert.equal(normal.events.length, 30);
  assert.equal(normal.dropped, 0);
  assert.deepEqual(Object.keys(normal.events[0]).sort(), ['at', 'atMs', 'decision', 'deviceId', 'method', 'network', 'subject']);
  assert.deepEqual([normal.events[0].subject, normal.events[0].method, normal.events[0].deviceId, normal.events[0].decision], ['learner_fixture', 'GET', null, null]);
  const suspicious = readDetectionEvents(reads(121));
  assert.equal(suspicious.events.length, 121);
  assert.equal(new Set(suspicious.events.map(e => e.subject)).size, 1);
});

test('가명 사용자·기기·요청 종류·판정을 읽고 subjectId도 가명 사용자로 인정한다', () => {
  const deviceId = 'a'.repeat(16);
  const out = readDetectionEvents([
    { at: '2026-10-01T00:00:00.000Z', method: 'GET', subjectId: 'subj_abc123', deviceId, decision: 'allow' },
    { at: '2026-10-01T00:00:01Z', method: 'POST', identity: { sub: 'learner_fixture' }, deviceId, decision: 'deny' },
    { at: '2026-10-01T00:00:02+09:00', method: 'DELETE', identity: { sub: 'x.y:z-1' }, decision: 'step_up' },
  ]);
  assert.equal(out.events.length, 3);
  assert.deepEqual(out.events.map(e => [e.subject, e.method, e.deviceId, e.decision]), [
    ['subj_abc123', 'GET', deviceId, 'allow'],
    ['learner_fixture', 'POST', deviceId, 'deny'],
    ['x.y:z-1', 'DELETE', null, 'step_up'],
  ]);
  // identity.sub가 있으면 subjectId보다 우선한다.
  const both = readDetectionEvents([{ at: '2026-10-01T00:00:00Z', method: 'GET', identity: { sub: 'from_identity' }, subjectId: 'from_subject' }]);
  assert.equal(both.events[0].subject, 'from_identity');
});

test('메모 내용·토큰·실명·이메일·쿠키는 이름이 무엇이든 읽지도 복사하지도 않는다', () => {
  const polluted = reads(5, { extra: {
    title: secrets.memoTitle, body: secrets.memoBody, content: secrets.memoBody, notes: [{ title: secrets.memoTitle }],
    token: secrets.token, access_token: secrets.token, authorization: secrets.bearer, headers: { cookie: secrets.cookie, authorization: secrets.bearer },
    name: secrets.realName, realName: secrets.realName, email: secrets.email, user: { name: secrets.realName, email: secrets.email },
    path: `/api/notes/${randomUUID()}`, query: `q=${secrets.memoTitle}`, ip: '203.0.113.9', userAgent: secrets.realName,
    deviceId: 'b'.repeat(16), decision: 'allow',
  } });
  const out = readDetectionEvents(polluted);
  assert.equal(out.events.length, 5);
  const dump = JSON.stringify(out);
  for (const [name, value] of Object.entries(secrets)) assert.ok(!dump.includes(value), `${name}가 결과에 남음`);
  assert.ok(!dump.includes('203.0.113.9'));
  assert.ok(!/title|body|content|token|authorization|cookie|email|name|path|query|userAgent/iu.test(Object.keys(out.events[0]).join(',')));
  assert.deepEqual(Object.keys(out.events[0]).sort(), ['at', 'atMs', 'decision', 'deviceId', 'method', 'network', 'subject']);
  assert.deepEqual([out.events[0].deviceId, out.events[0].decision], ['b'.repeat(16), 'allow']);
});

test('사용자 식별자로 쓸 수 없는 값(실명·이메일·공백·한글·너무 긴 값)은 읽지 않고 버린다', () => {
  const bad = [secrets.realName, secrets.email, 'learner fixture', 'ＡＢＣ', '', ' ', 'x'.repeat(81), '-leading', 7, null, {}, ['a']];
  const events = bad.map(sub => ({ at: '2026-10-01T00:00:00Z', method: 'GET', identity: { sub } }));
  const out = readDetectionEvents(events);
  assert.equal(out.events.length, 0);
  assert.equal(out.dropped, bad.length);
  assert.equal(out.droppedBy.subject_invalid, bad.length);
  // 버린 사유 코드에 입력 값이 섞이지 않는다.
  assert.ok(!JSON.stringify(out).includes(secrets.realName));
  assert.ok(!JSON.stringify(out).includes(secrets.email));
});

test('시각·요청 종류가 없거나 틀린 사건은 임의의 값으로 채우지 않고 버린다', () => {
  const good = { at: '2026-10-01T00:00:00.000Z', method: 'GET', identity: { sub: 'u1' } };
  const events = [
    good,
    { ...good, at: undefined }, { ...good, at: 'yesterday' }, { ...good, at: 1790000000000 }, { ...good, at: '2026-13-45T00:00:00Z' },
    { ...good, method: undefined }, { ...good, method: 'get' }, { ...good, method: 'TRACE' }, { ...good, method: 7 },
    null, 'x', 7, [], undefined,
  ];
  const out = readDetectionEvents(events);
  assert.equal(out.events.length, 1);
  assert.equal(out.dropped, events.length - 1);
  assert.deepEqual(Object.keys(out.droppedBy).sort(), ['at_invalid', 'event_not_object', 'method_invalid']);
});

test('기기·판정 값이 형식에 맞지 않으면 null이며 사건 자체는 유지된다', () => {
  const out = readDetectionEvents([
    { at: '2026-10-01T00:00:00Z', method: 'GET', identity: { sub: 'u1' }, deviceId: 'ABCDEF0123456789', decision: 'ALLOW' },
    { at: '2026-10-01T00:00:01Z', method: 'GET', identity: { sub: 'u1' }, deviceId: 'a'.repeat(15), decision: 'maybe' },
    { at: '2026-10-01T00:00:02Z', method: 'GET', identity: { sub: 'u1' }, deviceId: 12, decision: {} },
  ]);
  assert.equal(out.events.length, 3);
  assert.ok(out.events.every(e => e.deviceId === null && e.decision === null));
});

test('입력이 배열이 아니면 값을 노출하지 않는 오류를 낸다', () => {
  for (const bad of [null, undefined, {}, 'text', 7, () => {}]) {
    assert.throws(() => readDetectionEvents(bad), error => error instanceof TypeError && error.message === 'invalid_detection_events');
    assert.throws(() => detect(bad), error => error.message === 'invalid_detection_events');
  }
  const leaky = { toString: () => secrets.token };
  assert.throws(() => readDetectionEvents(leaky), error => !String(error.message).includes(secrets.token));
});

test('사건이 너무 많으면 앞부분만 읽고 초과 건수만 기록한다', () => {
  const out = readDetectionEvents(reads(20005));
  assert.equal(out.events.length, 20000);
  assert.equal(out.truncated, true);
  assert.equal(out.droppedBy.too_many_events, 5);
});

test('이상한 항목이 섞여 있어도 detect는 오류 없이 처리한다', () => {
  assert.deepEqual(detect([]), { action: 'observe' });
  assert.deepEqual(detect([null, 'x', { at: 'bad' }]), { action: 'observe' });
});

test('네트워크 값은 한 단어일 때만 읽고 지역은 읽지 않는다', () => {
  const read = extra => readDetectionEvents([{ at: '2026-10-01T00:00:00Z', method: 'GET', identity: { sub: 'u1' }, ...extra }]).events[0];
  assert.equal(read({ network: 'unusual' }).network, 'unusual');
  assert.equal(read({ signals: { network: 'usual' } }).network, 'usual');
  assert.equal(read({ network: 'unknown' }).network, null);
  assert.equal(read({ network: 'Unusual Net' }).network, null);
  assert.equal(read({ network: 7 }).network, null);
  assert.ok(!('region' in read({ region: 'foreign' })));
  assert.ok(!JSON.stringify(read({ region: 'foreign' })).includes('foreign'));
});
