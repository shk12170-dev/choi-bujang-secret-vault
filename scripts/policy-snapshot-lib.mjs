// 정책 사본 도구가 함께 쓰는 현재 정책 수집·사본 경로입니다(읽기만 합니다).
import { readFile } from 'node:fs/promises';
import { RULE_IDS } from '../src/decider.mjs';
import { DETECTION_POLICY } from '../src/detect.mjs';
import { RESOURCE_KINDS } from '../src/resources.mjs';
import { buildPolicy } from '../src/policy-restore.mjs';

export const SNAPSHOT_PATH = new URL('../backup/policy-snapshot.json', import.meta.url);

export async function readCurrentPolicy() {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  return buildPolicy({
    step: config.step,
    ruleIds: RULE_IDS,
    allowedRoutes: config.allowedRoutes ?? [],
    resourceKinds: RESOURCE_KINDS,
    detection: DETECTION_POLICY,
  });
}

// 사본 파일이 없으면 null, 읽거나 해석하지 못하면 검증 실패로 이어지는 값('unreadable')을 돌려줍니다.
export async function readSnapshotFile(url = SNAPSHOT_PATH) {
  let text;
  try { text = await readFile(url, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return 'unreadable';
  }
  try { return JSON.parse(text); } catch { return 'unreadable'; }
}
