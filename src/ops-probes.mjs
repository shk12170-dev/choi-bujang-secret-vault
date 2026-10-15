// 12단계: 작전실과 제출 묶음이 함께 쓰는 판정기·탐지 가상 요청 실행. 쓰는 모듈은 node:crypto와 이 저장소의 판정기·탐지뿐입니다.
import { createHash, randomUUID } from 'node:crypto';
import { RULE_IDS, decide } from './decider.mjs';
import { detect } from './detect.mjs';

// 판정기에 보내는 가상 요청(계약의 18개 이름). 실제 학생 값은 담지 않습니다.
function virtualRequest(patch = {}) {
  return {
    schema: 'aleph.decision.v1', requestId: randomUUID(), classId: 'class_ops', projectId: 'project_ops',
    subjectId: 'learner_ops', deviceId: 'a'.repeat(16), service: 'notes', method: 'GET',
    path: `/api/notes/${randomUUID()}`, route: 'GET /api/notes/:id', queryLength: 0,
    querySha256: createHash('sha256').update('').digest('hex'), at: new Date().toISOString(), policyRevision: 1,
    deviceRegistered: true, stepUp: { verified: false, authAgeSeconds: null },
    recentEvents: [], signals: { source: 'judge_fixture', region: 'local', network: 'usual', hour: 14 }, ...patch,
  };
}

export async function deciderProbes() {
  const cases = [
    { id: 'registered_memo_read', expected: 'allow', request: virtualRequest() },
    { id: 'unregistered_device', expected: 'deny', request: virtualRequest({ deviceRegistered: false }) },
    { id: 'memo_list', expected: 'deny', request: virtualRequest({ path: '/api/notes', route: 'GET /api/notes' }) },
    { id: 'memo_write', expected: 'deny', request: virtualRequest({ method: 'PUT', route: 'PUT /api/notes/:id' }) },
    {
      id: 'compound_anomaly', expected: 'step_up',
      request: virtualRequest({
        signals: { source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3 },
        recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }],
      }),
    },
  ];
  const probes = [];
  for (const item of cases) {
    let actual = null;
    let shapeOk = false;
    try {
      const out = await decide(item.request);
      actual = out?.decision ?? null;
      shapeOk = Boolean(out) && out.requestId === item.request.requestId
        && Object.keys(out).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema'
        && Array.isArray(out.ruleIds) && out.ruleIds.every(rule => RULE_IDS.includes(rule));
    } catch { actual = 'error'; }
    probes.push({ id: item.id, expected: item.expected, actual, shapeOk, matches: actual === item.expected && shapeOk, requestId: item.request.requestId });
  }
  return probes;
}

export function detectionProbes() {
  const start = Date.UTC(2026, 9, 1, 0, 0, 0);
  const reads = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
    at: new Date(start + i * 2000).toISOString(), method: 'GET', identity: { sub: 'learner_ops' }, ...extra,
  }));
  const cases = [
    { id: 'normal_30_reads', expected: 'observe', events: reads(30) },
    { id: 'usual_network_200_reads', expected: 'observe', events: reads(200, { network: 'usual' }) },
    { id: 'compound_130_reads', expected: 'propose_revocation', events: reads(130, { network: 'unusual', deviceId: 'b'.repeat(16) }) },
  ];
  return cases.map(item => {
    const result = detect(item.events);
    return { id: item.id, expected: item.expected, actual: result.action, matches: result.action === item.expected };
  });
}

