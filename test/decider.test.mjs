import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { RULE_IDS, decide } from '../src/decider.mjs';

const RESPONSE_KEYS = 'decision,reasonCode,requestId,ruleIds,schema';
const { normal } = fixtureRequests();
const withDevice = (patch = {}) => ({ ...normal, requestId: randomUUID(), ...patch });

function assertValid(request, response) {
  assert.equal(Object.keys(response).sort().join(','), RESPONSE_KEYS);
  assert.equal(response.schema, 'aleph.decision.v1');
  assert.equal(response.requestId, request.requestId);
  assert.ok(['allow', 'deny', 'step_up'].includes(response.decision));
  assert.match(response.reasonCode, /^[a-z][a-z0-9_]{0,63}$/u);
  assert.ok(response.ruleIds.length > 0 && response.ruleIds.every(id => RULE_IDS.includes(id)));
}

test('규칙 이름 device_registered가 RULE_IDS에 있고 기본 거부 규칙도 남아 있다', () => {
  assert.ok(RULE_IDS.includes('device_registered'));
  assert.ok(RULE_IDS.includes('starter.deny'));
  assert.equal(new Set(RULE_IDS).size, RULE_IDS.length);
});

test('등록 기기의 읽기 요청은 허용된다', async () => {
  const request = withDevice({ deviceRegistered: true });
  const response = await decide(request);
  assertValid(request, response);
  assert.equal(response.decision, 'allow');
  assert.deepEqual(response.ruleIds, ['device_registered']);
});

test('미등록이거나 값이 없거나 true가 아닌 형태이면 device_not_registered로 거부된다', async () => {
  const missing = { ...withDevice() };
  delete missing.deviceRegistered;
  for (const request of [
    withDevice({ deviceRegistered: false }),
    missing,
    withDevice({ deviceRegistered: undefined }),
    withDevice({ deviceRegistered: null }),
    withDevice({ deviceRegistered: 'true' }),
    withDevice({ deviceRegistered: 1 }),
    withDevice({ deviceRegistered: { value: true } }),
  ]) {
    const response = await decide(request);
    assertValid(request, response);
    assert.equal(response.decision, 'deny');
    assert.equal(response.reasonCode, 'device_not_registered');
    assert.deepEqual(response.ruleIds, ['device_registered']);
  }
});

test('등록 기기여도 읽기가 아닌 요청은 기본 거부를 유지한다', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const request = withDevice({ method, route: `${method} /notes/:id` });
    const response = await decide(request);
    assertValid(request, response);
    assert.equal(response.decision, 'deny');
    assert.deepEqual(response.ruleIds, ['starter.deny']);
  }
});

test('계약에 없는 값이 요청에 들어 있어도 판단에 쓰지 않는다', async () => {
  // 브라우저·호출자가 임의로 덧붙인 값은 등록 상태를 바꾸지 못한다.
  const forged = withDevice({ deviceRegistered: false, identity: { sub: 'admin' }, role: 'admin', device: { registered: true }, userId: 'x' });
  const response = await decide(forged);
  assert.equal(response.decision, 'deny');
  assert.equal(response.reasonCode, 'device_not_registered');
  const registered = withDevice({ identity: null, role: 'none', device: null });
  assert.equal((await decide(registered)).decision, 'allow');
});

test('형식이 이상한 입력도 오류 없이 형식이 맞는 거부로 답한다', async () => {
  for (const bad of [null, undefined, {}, 'x', 7, []]) {
    const response = await decide(bad);
    assert.equal(response.decision, 'deny');
    assert.equal(response.schema, 'aleph.decision.v1');
    assert.ok(response.ruleIds.every(id => RULE_IDS.includes(id)));
  }
});

test('판정기는 계약의 요청 이름만 읽는다', async () => {
  const source = await readFile(new URL('../src/decider.mjs', import.meta.url), 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  const contract = await readFile(new URL('../docs/DECIDER_REQUEST.md', import.meta.url), 'utf8');
  // 요청 표의 첫 칸에는 `service`, `method`처럼 이름이 여러 개 적힌 줄도 있다.
  const names = new Set();
  for (const line of contract.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const firstCell = line.split('|')[1] ?? '';
    for (const match of firstCell.matchAll(/`([A-Za-z]+)`/gu)) names.add(match[1]);
  }
  assert.ok(['requestId', 'deviceRegistered', 'method'].every(name => names.has(name)));
  const read = [...code.matchAll(/request\??\.([A-Za-z_]+)/gu)].map(match => match[1]);
  assert.ok(read.length > 0);
  for (const name of read) assert.ok(names.has(name), `계약에 없는 요청 이름을 읽음: ${name}`);
  assert.doesNotMatch(code, /request\??\.(role|identity|device|geo|userId)\b|\bprocess\.env\b|\bfetch\(/u);
});
