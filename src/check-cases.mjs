// 12단계: GET /api/checks?case=<이름> 이 서버에서 실제로 실행하는 규칙 점검.
// 판정기·탐지·정책 사본을 가상 입력으로 실행한 결과이며 심판의 실제 요청 결과가 아닙니다.
// 응답의 engineEnforced는 제공 엔진(ALEPH SDP 엔진)이 실제로 집행했는지로, 이 저장소에서 확인하지 않았으므로 not_run입니다.
import config from '../aleph.config.json' with { type: 'json' };
import policySnapshot from '../backup/policy-snapshot.json' with { type: 'json' };
import { RULE_IDS } from './decider.mjs';
import { DETECTION_POLICY } from './detect.mjs';
import { deciderProbes, detectionProbes } from './ops-probes.mjs';
import { buildPolicy, previewRestore } from './policy-restore.mjs';
import { RESOURCE_KINDS } from './resources.mjs';

const DECIDER_CASES = {
  'device-registered': 'registered_memo_read',
  'device-unregistered': 'unregistered_device',
  'step-up': 'compound_anomaly',
  'zone-list': 'memo_list',
  'zone-write': 'memo_write',
};
const DETECT_CASES = { 'detect-compound': 'compound_130_reads', 'detect-normal': 'normal_30_reads' };
export const CASE_IDS = Object.freeze([...Object.keys(DECIDER_CASES), ...Object.keys(DETECT_CASES), 'policy-verified']);

const frame = { fixtureType: 'fixed_fixture', engine: 'ALEPH SDP 엔진', engineEnforced: 'not_run' };

export async function evaluateCase(id) {
  if (id in DECIDER_CASES) {
    const probe = (await deciderProbes()).find(item => item.id === DECIDER_CASES[id]);
    return { case: id, caseId: id, source: '학생 판정기', ...frame, expected: probe.expected, actual: probe.actual, ready: probe.matches, jsonReady: probe.matches, ruleIds: [...RULE_IDS] };
  }
  if (id in DETECT_CASES) {
    const probe = detectionProbes().find(item => item.id === DETECT_CASES[id]);
    return { case: id, caseId: id, source: '학생 탐지 규칙', ...frame, expected: probe.expected, actual: probe.actual, ready: probe.matches, jsonReady: probe.matches };
  }
  if (id === 'policy-verified') {
    const current = buildPolicy({
      step: config.step, ruleIds: RULE_IDS, allowedRoutes: config.allowedRoutes ?? [],
      resourceKinds: RESOURCE_KINDS, detection: DETECTION_POLICY,
    });
    const preview = previewRestore(policySnapshot, current);
    const verified = preview.ok && preview.unchanged;
    return {
      case: id, caseId: id, source: '학생 정책 사본', ...frame, expected: 'verified_unchanged',
      actual: preview.ok ? (preview.unchanged ? 'verified_unchanged' : 'verified_changed') : preview.reason,
      ready: verified, jsonReady: verified, version: preview.ok ? preview.version : null,
    };
  }
  return null;
}
