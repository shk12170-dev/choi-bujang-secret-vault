// npm run policy:snapshot -- <version> — 현재 시험 정책으로 정책 사본(backup/policy-snapshot.json)을 새로 만듭니다.
// 침해 전에, 정책이 올바르다고 확인한 시점에만 실행하세요. 이미 사본이 있으면 덮어쓰지 않습니다.
import { execFileSync } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createSnapshot } from '../src/policy-restore.mjs';
import { SNAPSHOT_PATH, readCurrentPolicy } from './policy-snapshot-lib.mjs';

const version = process.argv[2];
if (!version) { console.log('사용법: npm run policy:snapshot -- <version 예: step9-verified>'); process.exit(1); }
const exists = await access(SNAPSHOT_PATH).then(() => true, () => false);
if (exists) { console.log('이미 정책 사본이 있어 덮어쓰지 않았습니다.'); process.exit(1); }
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
if (dirty) { console.log('작업 트리에 저장하지 않은 변경이 있습니다. 커밋한 뒤 사본을 만드세요.'); process.exit(1); }
const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
const snapshot = createSnapshot(await readCurrentPolicy(), { version, commit, createdAt });
await mkdir(new URL('../backup/', import.meta.url), { recursive: true });
await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`정책 사본을 만들었습니다: ${version} · 커밋 ${commit.slice(0, 12)} · digest ${snapshot.digest}`);
