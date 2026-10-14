// 10단계 제작 1: 침해 전에 검증한 안전 정책 사본과 현재 시험 정책의 "차이만" 보여 주는 읽기 전용 기능입니다.
// 이 파일은 파일을 쓰거나 네트워크를 부르거나 운영 정책을 바꾸지 않습니다. 사본이 없거나 검증에 실패하면 차이를 만들지 않고 중단합니다.
// 정책에는 규칙 이름·허용 경로·자원 종류·탐지 기준값만 담습니다. 키·토큰·주소·사용자 값은 담지 않습니다.
//
// 한계: 사본의 digest는 내용이 사고로 바뀌었는지 알려 주는 무결성 값입니다. 사본과 digest를 함께 다시 만들 수 있는 사람까지
// 막는 서명은 아닙니다. 사본이 저장소의 어느 커밋에서 왔는지는 version·commit으로 사람이 대조해야 합니다.
import { createHash } from 'node:crypto';

export const SNAPSHOT_SCHEMA = 'aleph.policy-snapshot.v1';
const SNAPSHOT_KEYS = ['schema', 'version', 'createdAt', 'commit', 'policy', 'digest'];
const POLICY_KEYS = ['step', 'ruleIds', 'allowedRoutes', 'resourceKinds', 'detection'];
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const COMMIT = /^[0-9a-f]{7,40}$/u;
const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const MAX_CHANGES = 100;

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// 키 순서와 상관없이 같은 값이면 같은 문자열이 되도록 정규화합니다.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function policyDigest(policy) {
  return createHash('sha256').update(canonical(policy)).digest('hex');
}

// 현재 시험 정책을 구현에서 읽어 모읍니다. 호출하는 쪽이 값을 넘기고, 이 함수는 복사본만 만듭니다.
export function buildPolicy({ step, ruleIds, allowedRoutes, resourceKinds, detection }) {
  const kinds = {};
  for (const [name, kind] of Object.entries(resourceKinds ?? {})) {
    kinds[name] = { zone: kind.zone, owner: kind.owner, base: [...kind.base] };
  }
  return {
    step,
    ruleIds: [...ruleIds].sort(),
    allowedRoutes: [...allowedRoutes].sort(),
    resourceKinds: kinds,
    detection: { ...detection },
  };
}

// 정책 사본 파일 내용을 만듭니다(기록은 호출한 쪽이 합니다).
export function createSnapshot(policy, { version, commit, createdAt }) {
  return { schema: SNAPSHOT_SCHEMA, version, createdAt, commit, policy, digest: policyDigest(policy) };
}

// 사본 검증: 통과하면 { ok: true, snapshot }, 아니면 { ok: false, reason } (값은 노출하지 않음)
export function verifySnapshot(raw) {
  if (raw === null || raw === undefined) return { ok: false, reason: 'snapshot_missing' };
  if (!isPlainObject(raw)) return { ok: false, reason: 'snapshot_invalid' };
  if (Object.keys(raw).sort().join() !== [...SNAPSHOT_KEYS].sort().join()) return { ok: false, reason: 'snapshot_shape_invalid' };
  if (raw.schema !== SNAPSHOT_SCHEMA) return { ok: false, reason: 'snapshot_schema_invalid' };
  if (typeof raw.version !== 'string' || !VERSION.test(raw.version)) return { ok: false, reason: 'snapshot_version_invalid' };
  if (typeof raw.commit !== 'string' || !COMMIT.test(raw.commit)) return { ok: false, reason: 'snapshot_commit_invalid' };
  if (typeof raw.createdAt !== 'string' || !ISO_AT.test(raw.createdAt) || !Number.isFinite(Date.parse(raw.createdAt))) {
    return { ok: false, reason: 'snapshot_created_at_invalid' };
  }
  if (!isPlainObject(raw.policy) || Object.keys(raw.policy).sort().join() !== [...POLICY_KEYS].sort().join()) {
    return { ok: false, reason: 'snapshot_policy_invalid' };
  }
  if (typeof raw.digest !== 'string' || !/^[0-9a-f]{64}$/u.test(raw.digest)) return { ok: false, reason: 'snapshot_digest_invalid' };
  if (policyDigest(raw.policy) !== raw.digest) return { ok: false, reason: 'snapshot_digest_mismatch' };
  return { ok: true, snapshot: raw };
}

// 복원 범위: 사본의 정책 항목 중 단계를 뺀 나머지. 이 밖의 항목(다른 서비스 규칙 등)은 읽지도 바꾸지도 않습니다.
export const RESTORE_SCOPE = Object.freeze(['allowedRoutes', 'ruleIds', 'resourceKinds', 'detection']);
// 설정 파일이 가진 항목은 도구가 바로 되돌리고, 코드가 가진 항목은 커밋 비교로 사람이 되돌립니다.
export const CONFIG_OWNED = Object.freeze(['allowedRoutes']);
export const CODE_OWNER_FILES = Object.freeze({ ruleIds: 'src/decider.mjs', resourceKinds: 'src/resources.mjs', detection: 'src/detect.mjs' });

function pickScope(policy) {
  const out = {};
  for (const key of RESTORE_SCOPE) if (key in policy) out[key] = policy[key];
  return out;
}

// 복원하면 "현재 → 사본" 방향으로 무엇이 바뀌는지만 계산합니다. 값은 정책 안의 규칙 이름·경로·기준값뿐입니다.
function diffValue(path, current, restoreTo, out) {
  if (canonical(current) === canonical(restoreTo)) return;
  if (isPlainObject(current) && isPlainObject(restoreTo)) {
    for (const key of [...new Set([...Object.keys(current), ...Object.keys(restoreTo)])].sort()) {
      diffValue(path ? `${path}.${key}` : key, current[key], restoreTo[key], out);
    }
    return;
  }
  if (Array.isArray(current) && Array.isArray(restoreTo)) {
    const currentSet = new Set(current.map(canonical));
    const restoreSet = new Set(restoreTo.map(canonical));
    out.push({
      path, change: 'list',
      restoreAdds: restoreTo.filter(item => !currentSet.has(canonical(item))),
      restoreRemoves: current.filter(item => !restoreSet.has(canonical(item))),
    });
    return;
  }
  out.push({
    path,
    change: current === undefined ? 'restore_adds' : restoreTo === undefined ? 'restore_removes' : 'restore_changes',
    current, restoreTo,
  });
}

// 실행 전 미리보기. 항상 applied: false이며 아무것도 쓰지 않습니다.
//   { ok: true, applied: false, version, commit, digest, createdAt, changes: [...], unchanged: boolean, truncated }
//   { ok: false, applied: false, reason }  — 사본이 없거나 검증 실패(복원 중단)
export function previewRestore(rawSnapshot, currentPolicy) {
  const verified = verifySnapshot(rawSnapshot);
  if (!verified.ok) return { ok: false, applied: false, reason: verified.reason };
  if (!isPlainObject(currentPolicy)) return { ok: false, applied: false, reason: 'current_policy_invalid' };
  const { snapshot } = verified;
  const changes = [];
  // 단계(step)는 복원 대상이 아닙니다. 단계가 올라간 것을 사본 때문에 되돌리면 안 되므로 비교에서 뺍니다.
  diffValue('', pickScope(currentPolicy), pickScope(snapshot.policy), changes);
  return {
    ok: true,
    applied: false,
    version: snapshot.version,
    commit: snapshot.commit,
    createdAt: snapshot.createdAt,
    digest: snapshot.digest,
    unchanged: changes.length === 0,
    truncated: changes.length > MAX_CHANGES,
    changes: changes.slice(0, MAX_CHANGES),
  };
}

// 복원 절차(순수 함수): 실행 전에 보인 사본의 digest를 그대로 다시 입력해야 합니다(확인).
//   성공: { ok: true, applied: false, version, digest, nextPolicy, restoredPaths, manualPaths, audit }
//     nextPolicy는 현재 정책에 복원 범위의 항목만 사본 값으로 바꾼 복사본입니다. 범위 밖 항목(단계, 다른 서비스 규칙)은 그대로입니다.
//     restoredPaths: 설정 파일 항목으로 도구가 되돌리는 최상위 항목, manualPaths: 코드에서 사람이 되돌려야 하는 항목(파일 이름 포함)
//   실패: { ok: false, applied: false, reason } — 사본 없음·검증 실패·확인 불일치
// 파일 기록은 호출한 쪽이 합니다. audit은 덧붙일 한 줄이며 값은 항목 이름과 개수뿐입니다.
export function planRestore(rawSnapshot, currentPolicy, { confirmDigest, now } = {}) {
  const preview = previewRestore(rawSnapshot, currentPolicy);
  if (!preview.ok) return preview;
  if (typeof confirmDigest !== 'string' || confirmDigest !== preview.digest) {
    return { ok: false, applied: false, reason: 'confirmation_mismatch', version: preview.version, digest: preview.digest };
  }
  const { snapshot } = verifySnapshot(rawSnapshot);
  const changedTop = [...new Set(preview.changes.map(change => change.path.split('.')[0]))];
  const restoredPaths = changedTop.filter(key => CONFIG_OWNED.includes(key));
  const manualPaths = changedTop.filter(key => !CONFIG_OWNED.includes(key)).map(key => ({ path: key, file: CODE_OWNER_FILES[key] ?? null }));
  const nextPolicy = JSON.parse(JSON.stringify(currentPolicy));
  for (const key of restoredPaths) nextPolicy[key] = JSON.parse(JSON.stringify(snapshot.policy[key]));
  const at = now instanceof Date ? now : new Date();
  return {
    ok: true,
    applied: false,
    version: preview.version,
    commit: preview.commit,
    digest: preview.digest,
    nextPolicy,
    restoredPaths,
    manualPaths,
    audit: {
      at: at.toISOString().replace(/\.\d{3}Z$/u, 'Z'),
      event: 'policy_restore',
      version: preview.version,
      digest: preview.digest,
      restored: restoredPaths,
      manual: manualPaths.map(item => item.path),
    },
  };
}
