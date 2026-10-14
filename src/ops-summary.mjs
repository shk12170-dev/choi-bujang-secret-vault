// 12단계 제작 1: 탈환 작전실의 요약. 서버가 요청을 받은 그 순간에 실제로 실행해 얻은 결과만 담습니다.
//
// 구분
//   source 'live_api'    이 요청을 처리하면서 서버가 판정기·탐지·표를 직접 실행하거나 읽어 얻은 값
//   source 'unavailable' 읽으려 했지만 읽지 못한 값(표가 없거나 DB 오류). 값을 만들어 채우지 않습니다.
//   source 'not_run'     이 저장소가 실행한 적이 없는 것(예: 실제 회수 시스템과의 연결, 심판의 41종 시험)
// 메모 제목·본문은 읽지도 담지도 않습니다. 식별자는 앞 8자리까지만 보여 서버 기록과 대조할 수 있게 합니다.
import { createHash, randomUUID } from 'node:crypto';
import config from '../aleph.config.json' with { type: 'json' };
import policySnapshot from '../backup/policy-snapshot.json' with { type: 'json' };
import { RULE_IDS, decide } from './decider.mjs';
import { DETECTION_POLICY, detect } from './detect.mjs';
import { RESOURCE_KINDS } from './resources.mjs';
import { buildPolicy, previewRestore } from './policy-restore.mjs';

const mask = value => (typeof value === 'string' && value.length >= 8 ? `${value.slice(0, 8)}…` : null);
const count = (rows, key, value) => rows.filter(row => row[key] === value).length;

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

async function deciderProbes() {
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

function detectionProbes() {
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

// db 조회는 사용자 본인 행만 읽고 개수와 앞 8자리 식별자만 돌려줍니다.
async function readOwn(db, table, columns, userId) {
  try {
    const { data, error } = await db.from(table).select(columns).eq('owner_id', userId);
    if (error) return { source: 'unavailable', rows: [] };
    return { source: 'live_api', rows: Array.isArray(data) ? data : [] };
  } catch {
    return { source: 'unavailable', rows: [] };
  }
}

export async function buildOpsSummary({ login, db, now = new Date(), commit = null }) {
  const currentPolicy = buildPolicy({
    step: config.step, ruleIds: RULE_IDS, allowedRoutes: config.allowedRoutes ?? [],
    resourceKinds: RESOURCE_KINDS, detection: DETECTION_POLICY,
  });
  const preview = previewRestore(policySnapshot, currentPolicy);

  const devices = await readOwn(db, 'device_approvals', 'id, status', login.userId);
  const backups = await readOwn(db, 'note_backups', 'id', login.userId);
  const audit = await readOwn(db, 'note_restore_audit', 'seq, restored_at', login.userId);
  const lastRestore = audit.rows.map(row => row.restored_at).filter(Boolean).sort().at(-1) ?? null;

  const decider = await deciderProbes();
  const detection = detectionProbes();
  return {
    generatedAt: now.toISOString(),
    commit: typeof commit === 'string' ? commit.slice(0, 12) : null,
    step: config.step,
    decider: {
      source: 'live_api',
      ruleIds: [...RULE_IDS],
      probes: decider,
      allMatch: decider.every(probe => probe.matches),
    },
    detection: {
      source: 'live_api',
      rule: { ...DETECTION_POLICY },
      probes: detection,
      allMatch: detection.every(probe => probe.matches),
    },
    revocation: {
      // 이 저장소는 회수를 제안만 하고 회수 시스템을 호출하지 않습니다. 실제 회수와 시간은 심판이 확인합니다.
      source: 'not_run',
      note: '실제 회수와 회수까지 걸린 시간은 심판이 확인합니다. 이 화면은 회수가 일어났다고 표시하지 않습니다.',
      devices: {
        source: devices.source,
        approved: count(devices.rows, 'status', 'approved'),
        pending: count(devices.rows, 'status', 'pending'),
        denied: count(devices.rows, 'status', 'denied'),
        ids: devices.rows.map(row => mask(row.id)).filter(Boolean),
      },
    },
    recovery: {
      snapshot: preview.ok
        ? {
          source: 'live_api', verified: true, version: preview.version, commit: preview.commit.slice(0, 12),
          digest: `${preview.digest.slice(0, 12)}…`, unchanged: preview.unchanged, changes: preview.changes.length,
        }
        : { source: 'live_api', verified: false, reason: preview.reason },
      backups: { source: backups.source, count: backups.rows.length, ids: backups.rows.map(row => mask(row.id)).filter(Boolean) },
      restoreAudit: { source: audit.source, count: audit.rows.length, lastRestoreAt: lastRestore },
    },
    notRun: [
      { id: 'attack_41', note: '심판의 41종 공격 시험은 이 저장소가 실행하지 않았습니다. 통과로 표시하지 않습니다.' },
    ],
  };
}
