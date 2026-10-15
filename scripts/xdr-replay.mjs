// 모의 재생: 가상 경보 시각을 기준으로 추가 거부 overlay가 공격 주소만 막고, 정상·애매한 주소는 통과시키며,
// 같은 주소의 모든 모듈 규칙이 끝난 뒤에는 기존 판정으로 돌아가는지 확인합니다. 실제 판정기(src/decider.mjs)나
// 운영 ZTNA 경로를 부르지 않으며, 기존 판정은 "허용"을 돌려주는 모의 판정입니다. 결과는 실제 접속 허용·회수가 아닙니다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bruteForce from '../xdr/brute-force/respond.mjs';
import * as knownCve from '../xdr/known-cve/respond.mjs';
import * as persistence from '../xdr/persistence/respond.mjs';
import * as webInjection from '../xdr/web-injection/respond.mjs';
import { applyDenyOverlay } from '../xdr/ztna-overlay.mjs';

export const MODULES = Object.freeze([bruteForce, webInjection, knownCve, persistence]);
const MOCK_BASE = Object.freeze({ schema: 'aleph.decision.v1', decision: 'allow', reasonCode: 'mock_base_allow', ruleIds: ['mock.base'] });

// inputs: [{ module: respond.mjs 모듈, alerts: 경보 배열 }]
export async function replay(inputs) {
  const runs = [];
  for (const { module, alerts } of inputs) runs.push({ moduleKey: module.MODULE_KEY, ...(await module.respond(alerts)) });
  const rules = runs.flatMap(run => run.rules); // 모든 모듈의 규칙을 함께 적용합니다.

  const byModule = {};
  const totals = { attackDenied: 0, attackTotal: 0, normalDenied: 0, ambiguousDenied: 0, expiredDenied: 0 };
  for (const run of runs) {
    const counts = { attackDenied: 0, attackTotal: 0, normalDenied: 0, ambiguousDenied: 0 };
    for (const { alert, out } of run.decisions) {
      const at = new Date(Date.parse(alert.timestamp) + 60 * 1000); // 경보 1분 뒤 같은 주소에서 온 요청
      const denied = applyDenyOverlay({ base: MOCK_BASE, rules, sourceIp: alert?.data?.srcip, at }).decision === 'deny';
      if (out.action === 'block') {
        counts.attackTotal += 1;
        if (denied) counts.attackDenied += 1;
      } else if (out.action === 'alert' && denied) counts.ambiguousDenied += 1;
      else if (out.action === 'record' && denied) counts.normalDenied += 1;
    }
    byModule[run.moduleKey] = { rules: run.rules.length, ...counts };
    for (const key of Object.keys(counts)) totals[key] += counts[key];
  }

  // 같은 주소의 모든 모듈 규칙 가운데 마지막 만료 1초 뒤에는 기존 판정(모의 허용)으로 돌아가야 합니다.
  const lastExpiry = new Map();
  for (const rule of rules) lastExpiry.set(rule.sourceIp, Math.max(lastExpiry.get(rule.sourceIp) ?? 0, Date.parse(rule.expiresAt)));
  for (const [sourceIp, expiry] of lastExpiry) {
    if (applyDenyOverlay({ base: MOCK_BASE, rules, sourceIp, at: new Date(expiry + 1000) }).decision === 'deny') totals.expiredDenied += 1;
  }
  const sharedAddresses = [...lastExpiry.keys()].filter(ip => new Set(rules.filter(r => r.sourceIp === ip).map(r => r.moduleKey)).size > 1);
  return { schema: 'aleph.xdr.replay.v1', base: 'mock_allow', rules: rules.length, sharedAddresses, ...totals, byModule };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const inputs = MODULES.map(module => ({
      module,
      alerts: JSON.parse(readFileSync(join(root, 'xdr', 'fixtures', `${module.MODULE_KEY}.json`), 'utf8')).alerts,
    }));
    const result = await replay(inputs);
    mkdirSync(join(root, 'xdr'), { recursive: true });
    writeFileSync(join(root, 'xdr', 'replay-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    for (const [key, m] of Object.entries(result.byModule)) {
      console.log(`  ${key}: attackDenied ${m.attackDenied}/${m.attackTotal}, normalDenied ${m.normalDenied}, ambiguousDenied ${m.ambiguousDenied}`);
    }
    console.log(`모의 overlay: attackDenied ${result.attackDenied}, normalDenied ${result.normalDenied}, ambiguousDenied ${result.ambiguousDenied}, expiredDenied ${result.expiredDenied} (두 모듈이 겹친 주소 ${result.sharedAddresses.length}개)`);
    if (result.normalDenied || result.ambiguousDenied || result.expiredDenied || result.attackDenied !== result.attackTotal) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
