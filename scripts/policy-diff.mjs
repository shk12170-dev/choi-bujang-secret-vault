// npm run policy:diff — 정책 사본과 현재 시험 정책의 차이만 보여 줍니다. 아무것도 쓰거나 바꾸지 않습니다.
import { previewRestore } from '../src/policy-restore.mjs';
import { readCurrentPolicy, readSnapshotFile } from './policy-snapshot-lib.mjs';

const REASONS = {
  snapshot_missing: '정책 사본이 없습니다(backup/policy-snapshot.json).',
  snapshot_invalid: '정책 사본 형식이 올바르지 않습니다.',
  snapshot_shape_invalid: '정책 사본의 항목이 정해진 목록과 다릅니다.',
  snapshot_schema_invalid: '정책 사본의 schema가 다릅니다.',
  snapshot_version_invalid: '정책 사본의 version 형식이 올바르지 않습니다.',
  snapshot_commit_invalid: '정책 사본의 commit 형식이 올바르지 않습니다.',
  snapshot_created_at_invalid: '정책 사본의 createdAt 형식이 올바르지 않습니다.',
  snapshot_policy_invalid: '정책 사본의 정책 항목이 정해진 목록과 다릅니다.',
  snapshot_digest_invalid: '정책 사본의 digest 형식이 올바르지 않습니다.',
  snapshot_digest_mismatch: '정책 사본의 내용이 digest와 맞지 않습니다(변조 또는 손상).',
  current_policy_invalid: '현재 정책을 읽지 못했습니다.',
};

const result = previewRestore(await readSnapshotFile(), await readCurrentPolicy());
if (!result.ok) {
  console.log(`복원 중단: ${REASONS[result.reason] ?? '정책 사본을 검증하지 못했습니다.'}`);
  console.log('정책은 바뀌지 않았습니다.');
  process.exitCode = 1;
} else {
  console.log(`복원할 버전: ${result.version} · 커밋 ${result.commit} · 사본 생성 ${result.createdAt}`);
  console.log(`사본 digest: ${result.digest}`);
  if (result.unchanged) console.log('변경 범위: 없음(현재 시험 정책이 사본과 같습니다)');
  else {
    console.log(`변경 범위: ${result.changes.length}곳${result.truncated ? ' (일부만 표시)' : ''} — 복원하면 현재 값이 아래 사본 값으로 바뀝니다`);
    for (const change of result.changes) {
      if (change.change === 'list') {
        console.log(`  - ${change.path}: 추가 ${JSON.stringify(change.restoreAdds)} / 제거 ${JSON.stringify(change.restoreRemoves)}`);
      } else {
        console.log(`  - ${change.path}: ${JSON.stringify(change.current)} → ${JSON.stringify(change.restoreTo)}`);
      }
    }
  }
  console.log('이 명령은 미리보기이며 아무것도 적용하지 않았습니다(applied: false).');
}
