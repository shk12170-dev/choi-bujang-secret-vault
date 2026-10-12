// 모의 재생: 가상 경보 시각을 기준으로 추가 거부 overlay가 공격 주소만 막고, 정상·애매한 주소는 통과시키며,
// 만료 뒤에는 기존 판정으로 돌아가는지 확인합니다. 실제 판정기(src/decider.mjs)나 운영 ZTNA 경로를
// 부르지 않으며, 기존 판정은 "허용"을 돌려주는 모의 판정입니다. 결과는 실제 접속 허용·회수가 아닙니다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDenyOverlay, MODULE_KEY, respond } from '../xdr/brute-force/respond.mjs';

const MOCK_BASE = Object.freeze({ schema: 'aleph.decision.v1', decision: 'allow', reasonCode: 'mock_base_allow', ruleIds: ['mock.base'] });

export async function replay(alerts) {
  const { decisions, rules } = await respond(alerts);
  const counts = { attackDenied: 0, attackTotal: 0, normalDenied: 0, ambiguousDenied: 0, expiredDenied: 0 };
  const lastExpiry = new Map();
  for (const rule of rules) lastExpiry.set(rule.sourceIp, Math.max(lastExpiry.get(rule.sourceIp) ?? 0, Date.parse(rule.expiresAt)));

  for (const { alert, out } of decisions) {
    const sourceIp = alert?.data?.srcip;
    const at = new Date(Date.parse(alert.timestamp) + 60 * 1000); // 경보 1분 뒤 같은 주소에서 온 요청
    const denied = applyDenyOverlay({ base: MOCK_BASE, rules, sourceIp, at }).decision === 'deny';
    if (out.action === 'block') {
      counts.attackTotal += 1;
      if (denied) counts.attackDenied += 1;
    } else if (out.action === 'alert' && denied) counts.ambiguousDenied += 1;
    else if (out.action === 'record' && denied) counts.normalDenied += 1;
  }
  // 같은 주소의 모든 규칙이 끝난 1초 뒤에는 기존 판정(모의 허용)으로 돌아가야 합니다.
  for (const [sourceIp, expiry] of lastExpiry) {
    if (applyDenyOverlay({ base: MOCK_BASE, rules, sourceIp, at: new Date(expiry + 1000) }).decision === 'deny') counts.expiredDenied += 1;
  }
  return { schema: 'aleph.xdr.replay.v1', moduleKey: MODULE_KEY, base: 'mock_allow', rules: rules.length, ...counts };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const fixture = JSON.parse(readFileSync(join(root, 'xdr', 'fixtures', `${MODULE_KEY}.json`), 'utf8'));
    const result = await replay(fixture.alerts);
    mkdirSync(join(root, 'xdr'), { recursive: true });
    writeFileSync(join(root, 'xdr', 'replay-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`모의 overlay(${MODULE_KEY}): attackDenied ${result.attackDenied}/${result.attackTotal}, normalDenied ${result.normalDenied}, ambiguousDenied ${result.ambiguousDenied}, expiredDenied ${result.expiredDenied}`);
    if (result.normalDenied || result.ambiguousDenied || result.expiredDenied || result.attackDenied !== result.attackTotal) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
