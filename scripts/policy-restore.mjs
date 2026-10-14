// npm run policy:restore [-- --confirm <사본 digest>]
// 검증한 정책 사본으로 시험 정책을 되돌립니다. 확인 값 없이 실행하면 바뀔 항목만 보여 주고 아무것도 쓰지 않습니다.
//   되돌리는 것: aleph.config.json의 allowedRoutes(설정 파일이 가진 정책 항목)만
//   되돌리지 않는 것: 단계(step), 설정의 다른 항목, 감사 기록(backup/restore-audit.jsonl은 덧붙이기만 함)
//   코드가 가진 항목(규칙 이름·자원 구분표·탐지 기준값)이 사본과 다르면 자동으로 바꾸지 않고 비교할 파일을 알려 줍니다.
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { planRestore, previewRestore } from '../src/policy-restore.mjs';
import { readCurrentPolicy, readSnapshotFile } from './policy-snapshot-lib.mjs';

const CONFIG_URL = new URL('../aleph.config.json', import.meta.url);
const AUDIT_URL = new URL('../backup/restore-audit.jsonl', import.meta.url);
const CHECK_FILES = ['test/api-zones.test.mjs', 'test/zones.test.mjs', 'test/decider.test.mjs'];

const argIndex = process.argv.indexOf('--confirm');
const confirmDigest = argIndex > -1 ? process.argv[argIndex + 1] : undefined;

const snapshot = await readSnapshotFile();
const current = await readCurrentPolicy();
const preview = previewRestore(snapshot, current);
if (!preview.ok) {
  console.log(`복원 중단: 정책 사본을 사용할 수 없습니다(${preview.reason}). 정책은 바뀌지 않았습니다.`);
  process.exit(1);
}

console.log(`복원할 버전: ${preview.version} · 커밋 ${preview.commit} · 사본 생성 ${preview.createdAt}`);
console.log(`사본 digest: ${preview.digest}`);
if (preview.unchanged) {
  console.log('바뀔 항목: 없음(현재 시험 정책이 사본과 같습니다). 아무것도 쓰지 않았습니다.');
  process.exit(0);
}
console.log(`바뀔 항목 ${preview.changes.length}곳 (현재 → 사본):`);
for (const change of preview.changes) {
  if (change.change === 'list') console.log(`  - ${change.path}: 추가 ${JSON.stringify(change.restoreAdds)} / 제거 ${JSON.stringify(change.restoreRemoves)}`);
  else console.log(`  - ${change.path}: ${JSON.stringify(change.current)} → ${JSON.stringify(change.restoreTo)}`);
}

if (confirmDigest === undefined) {
  console.log('\n확인하지 않아 아무것도 적용하지 않았습니다. 위 항목과 버전이 맞으면 아래처럼 사본 digest를 그대로 넣어 다시 실행하세요.');
  console.log(`  npm run policy:restore -- --confirm ${preview.digest}`);
  process.exit(0);
}

const plan = planRestore(snapshot, current, { confirmDigest });
if (!plan.ok) {
  console.log(`복원 중단: 확인 값이 사본 digest와 다릅니다(${plan.reason}). 아무것도 쓰지 않았습니다.`);
  process.exit(1);
}

if (plan.restoredPaths.includes('allowedRoutes')) {
  const config = JSON.parse(await readFile(CONFIG_URL, 'utf8'));
  config.allowedRoutes = plan.nextPolicy.allowedRoutes;
  await writeFile(CONFIG_URL, `${JSON.stringify(config, null, 2)}\n`);
}
await mkdir(new URL('../backup/', import.meta.url), { recursive: true });
await appendFile(AUDIT_URL, `${JSON.stringify(plan.audit)}\n`); // 덧붙이기만 합니다. 기존 감사 기록은 지우거나 고치지 않습니다.

console.log(`\n되돌린 항목: ${plan.restoredPaths.length ? plan.restoredPaths.join(', ') : '없음'}`);
console.log(`감사 기록 한 줄을 덧붙였습니다(backup/restore-audit.jsonl).`);
for (const item of plan.manualPaths) {
  console.log(`직접 되돌려야 하는 항목: ${item.path}${item.file ? ` — 비교: git diff ${plan.commit.slice(0, 12)} -- ${item.file}` : ''}`);
}

console.log('\n복원 뒤 확인(B의 A 자료 요청 거부, A 정상 요청 유지, 판정기 응답):');
const check = spawnSync(process.execPath, ['--test', ...CHECK_FILES], { encoding: 'utf8' });
const summary = String(check.stdout).split('\n').filter(line => /^ℹ (tests|pass|fail)/u.test(line));
console.log(summary.join('\n') || '확인 결과를 읽지 못했습니다.');
if (check.status !== 0) { console.log('복원 뒤 확인이 실패했습니다. 위 항목을 먼저 확인하세요.'); process.exit(1); }
if (plan.manualPaths.length) { console.log('코드 항목이 남아 있어 완전히 복원되지는 않았습니다.'); process.exit(2); }
console.log('복원과 확인을 마쳤습니다.');
