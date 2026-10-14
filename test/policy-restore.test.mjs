import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildPolicy, createSnapshot, policyDigest, previewRestore, verifySnapshot } from '../src/policy-restore.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import { DETECTION_POLICY } from '../src/detect.mjs';
import { RESOURCE_KINDS } from '../src/resources.mjs';

const ROUTES = ['GET /api/notes/:id', 'GET /api/notices', 'GET /api/notices/:id'];
const policy = (over = {}) => buildPolicy({
  step: 9, ruleIds: RULE_IDS, allowedRoutes: ROUTES, resourceKinds: RESOURCE_KINDS, detection: DETECTION_POLICY, ...over,
});
const snapshot = (p = policy()) => createSnapshot(p, { version: 'step9-verified', commit: '6d47e15959533864eb752a5a7eb583aabd90a541', createdAt: '2026-10-14T00:00:00Z' });
const clone = value => JSON.parse(JSON.stringify(value));

test('사본과 현재 정책이 같으면 변경 범위가 없고 버전·digest가 보인다', () => {
  const result = previewRestore(snapshot(), policy());
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.equal(result.unchanged, true);
  assert.deepEqual(result.changes, []);
  assert.equal(result.version, 'step9-verified');
  assert.match(result.digest, /^[0-9a-f]{64}$/u);
  assert.match(result.commit, /^[0-9a-f]{40}$/u);
});

test('현재 정책이 침해로 바뀐 곳만 변경 범위에 나온다', () => {
  const tampered = policy({
    ruleIds: ['starter.deny', 'device_registered'], // 규칙 두 개 사라짐
    allowedRoutes: [...ROUTES, 'DELETE /api/notes/:id'], // 허용 경로 추가
    detection: { ...DETECTION_POLICY, burstOver: 100000 }, // 탐지 기준 완화
  });
  const result = previewRestore(snapshot(), tampered);
  assert.equal(result.ok, true);
  const byPath = Object.fromEntries(result.changes.map(change => [change.path, change]));
  assert.deepEqual(Object.keys(byPath).sort(), ['allowedRoutes', 'detection.burstOver', 'ruleIds']);
  assert.deepEqual(byPath.ruleIds.restoreAdds.sort(), ['step_up_required', 'zone_access']);
  assert.deepEqual(byPath.allowedRoutes.restoreRemoves, ['DELETE /api/notes/:id']);
  assert.equal(byPath['detection.burstOver'].current, 100000);
  assert.equal(byPath['detection.burstOver'].restoreTo, 120);
  // 같은 항목은 나오지 않는다.
  assert.ok(!('step' in byPath) && !('resourceKinds' in byPath));
});

test('자원 종류 구분표가 바뀐 것도 항목 단위로 보인다', () => {
  const kinds = clone(RESOURCE_KINDS);
  kinds['student.memo'].owner = 'anyone';
  const result = previewRestore(snapshot(), policy({ resourceKinds: kinds }));
  assert.deepEqual(result.changes.map(change => change.path), ['resourceKinds.student.memo.owner']);
});

test('사본이 없으면 중단하고 차이를 만들지 않는다', () => {
  for (const missing of [null, undefined]) {
    const result = previewRestore(missing, policy());
    assert.deepEqual(result, { ok: false, applied: false, reason: 'snapshot_missing' });
  }
});

test('검증에 실패한 사본은 중단한다(변조·손상·형식 오류)', () => {
  const good = snapshot();
  const cases = {
    snapshot_digest_mismatch: (() => { const bad = clone(good); bad.policy.ruleIds.push('x.allow_all'); return bad; })(),
    snapshot_shape_invalid: { ...clone(good), extra: 1 },
    snapshot_schema_invalid: { ...clone(good), schema: 'other' },
    snapshot_version_invalid: { ...clone(good), version: '../etc' },
    snapshot_commit_invalid: { ...clone(good), commit: 'not-a-sha' },
    snapshot_created_at_invalid: { ...clone(good), createdAt: 'yesterday' },
    snapshot_digest_invalid: { ...clone(good), digest: 'abc' },
    snapshot_policy_invalid: { ...clone(good), policy: { step: 9 } },
    snapshot_invalid: 'unreadable',
  };
  for (const [reason, raw] of Object.entries(cases)) {
    const result = previewRestore(raw, policy());
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
    assert.equal(result.applied, false);
    assert.ok(!('changes' in result) && !('version' in result));
  }
});

test('검증과 미리보기는 입력을 바꾸지 않고 정책에 비밀값 모양을 담지 않는다', () => {
  const current = policy();
  const raw = snapshot();
  const before = JSON.stringify([current, raw]);
  previewRestore(raw, current);
  verifySnapshot(raw);
  assert.equal(JSON.stringify([current, raw]), before);
  assert.equal(policyDigest(current), policyDigest(clone(current)));
  assert.doesNotMatch(JSON.stringify(current), /https?:|sb_|sk-|eyJ|token|secret/iu);
});

test('정책 사본 코드는 파일·네트워크·환경 값에 접근하지 않는다', async () => {
  const source = await readFile(new URL('../src/policy-restore.mjs', import.meta.url), 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\bfetch\(|node:fs|node:child_process|\bprocess\b|writeFile|XMLHttpRequest/u);
});

test('저장소의 정책 사본이 있으면 검증을 통과하고 현재 정책과 같다', async () => {
  const raw = JSON.parse(await readFile(new URL('../backup/policy-snapshot.json', import.meta.url), 'utf8'));
  assert.equal(verifySnapshot(raw).ok, true);
  const { readCurrentPolicy } = await import('../scripts/policy-snapshot-lib.mjs');
  const result = previewRestore(raw, await readCurrentPolicy());
  assert.equal(result.ok, true);
  assert.equal(result.unchanged, true);
});

// ── 제작 2: 복원 절차 ──
import { planRestore } from '../src/policy-restore.mjs';

test('단계(step)는 복원 대상이 아니며 비교에서도 빠진다', () => {
  const result = previewRestore(snapshot(), policy({ step: 10 }));
  assert.equal(result.unchanged, true);
  assert.deepEqual(result.changes, []);
});

test('확인 값(digest)이 없거나 다르면 복원 계획을 만들지 않는다', () => {
  const tampered = policy({ allowedRoutes: [...ROUTES, 'DELETE /api/notes/:id'] });
  const raw = snapshot();
  for (const confirmDigest of [undefined, '', 'abc', 'f'.repeat(64)]) {
    const result = planRestore(raw, tampered, { confirmDigest });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'confirmation_mismatch');
    assert.ok(!('nextPolicy' in result));
  }
});

test('사본이 없거나 검증에 실패하면 확인 값이 맞아도 복원하지 않는다', () => {
  const raw = snapshot();
  const bad = clone(raw); bad.policy.ruleIds.push('x.allow_all');
  assert.equal(planRestore(null, policy(), { confirmDigest: raw.digest }).reason, 'snapshot_missing');
  assert.equal(planRestore(bad, policy(), { confirmDigest: raw.digest }).reason, 'snapshot_digest_mismatch');
});

test('설정 항목(허용 경로)은 사본 값으로 되돌리고 단계·다른 서비스 규칙·코드 항목은 건드리지 않는다', () => {
  const raw = snapshot();
  const current = { ...policy({ step: 10, allowedRoutes: [...ROUTES, 'PUT /api/notes/:id'], ruleIds: ['starter.deny'] }), otherService: { rules: ['keep.me'] } };
  const before = JSON.stringify(current);
  const plan = planRestore(raw, current, { confirmDigest: raw.digest, now: new Date('2026-10-14T00:00:00Z') });
  assert.equal(plan.ok, true);
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.restoredPaths, ['allowedRoutes']);
  assert.deepEqual(plan.manualPaths, [{ path: 'ruleIds', file: 'src/decider.mjs' }]);
  assert.deepEqual(plan.nextPolicy.allowedRoutes, ROUTES);
  assert.equal(plan.nextPolicy.step, 10); // 단계는 그대로
  assert.deepEqual(plan.nextPolicy.otherService, { rules: ['keep.me'] }); // 다른 서비스 규칙 보존
  assert.deepEqual(plan.nextPolicy.ruleIds, ['starter.deny']); // 코드 항목은 자동으로 바꾸지 않음
  assert.equal(JSON.stringify(current), before); // 입력은 바뀌지 않음
  assert.deepEqual(Object.keys(plan.audit).sort(), ['at', 'digest', 'event', 'manual', 'restored', 'version']);
  assert.equal(plan.audit.at, '2026-10-14T00:00:00Z');
});

test('복원 도구는 감사 기록을 덧붙이기만 하고 지우거나 고치지 않는다', async () => {
  const source = await readFile(new URL('../scripts/policy-restore.mjs', import.meta.url), 'utf8');
  assert.match(source, /appendFile\(AUDIT_URL/u);
  assert.doesNotMatch(source, /writeFile\(AUDIT_URL|unlink|rm\(|truncate/u);
});
