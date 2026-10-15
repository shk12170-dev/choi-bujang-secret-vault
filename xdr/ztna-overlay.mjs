// XDR 공통 차단 연결: decide 결과 가운데 block만 만료 시각·근거 경보 번호가 있는 추가 거부 후보로 만들고,
// 알림을 xdr/alerts.log에 한 줄씩 쌓습니다. 각 모듈의 respond.mjs가 moduleKey를 넣어 씁니다.
// 기본은 경보의 출발 주소(sourceIp)를 막고, 자료 반출 모듈은 target: 'destination'으로 목적지(destinationIp)를 막습니다.
//
// 판정기 연결 범위: 이 저장소의 src/decider.mjs와 그 요청 계약(docs/DECIDER_REQUEST.md)에는 검증된 출발 IP나
// 목적지 주소가 없습니다. 그래서 운영 판정기에는 연결하지 않고 기존 규칙도 고치지 않습니다.
// applyDenyOverlay()는 "기존 판정 결과 위에 거부만 덧씌우고, 맞는 규칙이 없으면 기존 판정에 그대로 위임"하는
// 부품이며, 지금은 scripts/xdr-replay.mjs의 모의 재생에서만 씁니다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const RULES_SCHEMA = 'aleph.xdr.deny-rules.v1';
const BLOCK_AT = 0.85;
export const TTL_MINUTES = 15;
const NL = String.fromCharCode(10);
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u;

// 내부망·루프백·링크 로컬·멀티캐스트 주소는 정상 사용자일 수 있어 자동 규칙으로 막지 않습니다.
export function blockableAddress(value) {
  if (typeof value !== 'string' || !IPV4.test(value)) return false;
  const [a, b] = value.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

const timeOf = value => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};
export const sourceIpOf = alert => (typeof alert?.data?.srcip === 'string' ? alert.data.srcip : '');
export const destinationIpOf = alert => (typeof alert?.data?.dstip === 'string' ? alert.data.dstip : '');

// 어느 모듈의 규칙이든 해당 시각에 유효한(issuedAt ≤ at < expiresAt) 거부 규칙을 찾습니다.
// field는 규칙이 가리키는 주소 칸입니다(sourceIp 또는 destinationIp).
export function activeDenyRules(rules, address, at, field = 'sourceIp') {
  const now = at instanceof Date ? at.getTime() : timeOf(at);
  if (now === null) return [];
  return (Array.isArray(rules) ? rules : []).filter(rule => rule?.action === 'deny'
    && rule[field] === address && timeOf(rule.issuedAt) !== null && timeOf(rule.expiresAt) !== null
    && timeOf(rule.issuedAt) <= now && now < timeOf(rule.expiresAt));
}

export const isDeniedAddress = (rules, sourceIp, at) => activeDenyRules(rules, sourceIp, at, 'sourceIp').length > 0;
export const isDeniedDestination = (rules, destinationIp, at) => activeDenyRules(rules, destinationIp, at, 'destinationIp').length > 0;

// 기존 판정 결과(base)는 그대로 두고, 출발 주소나 목적지에 유효한 거부 규칙이 있을 때만 거부를 덧씌웁니다.
export function applyDenyOverlay({ base, rules, sourceIp, destinationIp, at }) {
  const matched = [
    ...(blockableAddress(sourceIp) ? activeDenyRules(rules, sourceIp, at, 'sourceIp') : []),
    ...(blockableAddress(destinationIp) ? activeDenyRules(rules, destinationIp, at, 'destinationIp') : []),
  ];
  if (!matched.length) return base;
  return {
    ...base,
    decision: 'deny',
    reasonCode: 'xdr_deny_overlay',
    ruleIds: [...new Set(matched.map(rule => `xdr.${rule.moduleKey}.${rule.evidenceAlertId}`))],
  };
}

// 차단 후보 → 추가 거부 규칙. block이고 확신도 0.85 이상이며 시각·주소·근거가 유효할 때만 만듭니다.
// 같은 모듈에서 같은 주소에 정상 이벤트(record)가 있으면 그 주소는 막지 않습니다.
// target이 'destination'이면 출발 주소 대신 목적지를 막고, 정상 이벤트가 쓴 목적지는 막지 않습니다.
export function buildDenyRules(moduleKey, decisions, { target = 'source' } = {}) {
  const toDestination = target === 'destination';
  const addressOf = toDestination ? destinationIpOf : sourceIpOf;
  const normalAddresses = new Set(decisions.filter(d => d.out.action === 'record').map(d => addressOf(d.alert)).filter(Boolean));
  const rules = [];
  const skipped = [];
  for (const { alert, out } of decisions) {
    if (out.action !== 'block' || out.confidence < BLOCK_AT) continue;
    const address = addressOf(alert);
    const issued = timeOf(alert?.timestamp);
    const alertId = typeof alert?.id === 'string' && alert.id ? alert.id : null;
    if (!alertId) { skipped.push({ alertId: '-', reason: '근거 경보 번호 없음' }); continue; }
    if (issued === null) { skipped.push({ alertId, reason: '경보 시각 없음' }); continue; }
    if (!blockableAddress(address)) { skipped.push({ alertId, reason: '막을 수 없는 주소 형식' }); continue; }
    if (normalAddresses.has(address)) { skipped.push({ alertId, reason: '같은 주소에 정상 이벤트가 있음' }); continue; }
    rules.push({
      ...(toDestination ? { destinationIp: address, direction: 'egress' } : { sourceIp: address }),
      action: 'deny',
      confidence: out.confidence,
      evidenceAlertId: alertId,
      issuedAt: new Date(issued).toISOString(),
      expiresAt: new Date(issued + TTL_MINUTES * 60 * 1000).toISOString(),
      moduleKey,
      reason: out.reason.split(':')[0].slice(0, 120),
    });
  }
  return { rules, skipped };
}

// 이 모듈의 규칙만 새로 바꾸고 다른 모듈의 규칙은 그대로 보존합니다.
export function writeRules(rulesPath, moduleKey, rules) {
  let others = [];
  if (existsSync(rulesPath)) {
    try {
      const saved = JSON.parse(readFileSync(rulesPath, 'utf8'));
      if (saved?.schema === RULES_SCHEMA && Array.isArray(saved.rules)) others = saved.rules.filter(rule => rule?.moduleKey !== moduleKey);
    } catch { /* 읽을 수 없는 이전 파일은 이 모듈 규칙으로 새로 씁니다 */ }
  }
  const all = [...others, ...rules];
  mkdirSync(dirname(rulesPath), { recursive: true });
  writeFileSync(rulesPath, `${JSON.stringify({ schema: RULES_SCHEMA, rules: all }, null, 2)}${NL}`, 'utf8');
  return all;
}

// 알림 로그: block·alert만, 계정·원문·비밀값 없이 `시각 | 모듈 | 행동 | 경보 번호 | 주소 | 확신도 | 패턴` 한 줄씩.
// 같은 모듈·경보·행동은 다시 쌓지 않습니다.
export function appendAlerts(logPath, moduleKey, decisions) {
  const lines = decisions.filter(d => d.out.action !== 'record').map(({ alert, out }) => ({
    key: `${moduleKey}|${alert.id}|${out.action}`,
    text: [alert.timestamp, moduleKey, out.action, alert.id, sourceIpOf(alert) || '-', out.confidence.toFixed(2), out.reason.split(':')[0]].join(' | '),
  }));
  const known = new Set(existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split(NL).map(line => line.trim()).filter(Boolean).map(line => {
      const parts = line.split(' | ');
      return `${parts[1]}|${parts[3]}|${parts[2]}`;
    })
    : []);
  const fresh = lines.filter(line => !known.has(line.key));
  if (fresh.length) {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${fresh.map(line => line.text).join(NL)}${NL}`, 'utf8');
  }
  return fresh.length;
}

// 모듈 하나의 경보를 판단하고 거부 후보·알림을 만듭니다.
export async function respondWith(moduleKey, decide, alerts, { rulesPath, logPath, target } = {}) {
  const decisions = [];
  for (const alert of alerts) decisions.push({ alert, out: await decide(alert) });
  const { rules, skipped } = buildDenyRules(moduleKey, decisions, { target });
  const allRules = rulesPath ? writeRules(rulesPath, moduleKey, rules) : rules;
  const logLinesAdded = logPath ? appendAlerts(logPath, moduleKey, decisions) : 0;
  const counts = { block: 0, alert: 0, record: 0 };
  for (const { out } of decisions) counts[out.action] += 1;
  return { counts, decisions, rules, allRules, skipped, logLinesAdded };
}
