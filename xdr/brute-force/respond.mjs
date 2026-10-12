// 제작 4: decide 결과 가운데 차단 후보만 만료 시각·근거 경보 번호가 있는 추가 거부 규칙으로 만들고,
// 알림은 xdr/alerts.log에 한 줄씩 쌓습니다. decide.mjs는 판단만 돌려주고 파일을 쓰지 않습니다.
//
// 판정기 연결 범위: 이 저장소의 src/decider.mjs(시작 틀, 모든 요청 거부)와 그 요청 계약
// (docs/DECIDER_REQUEST.md)에는 검증된 출발 IP가 없습니다. 그래서 운영 판정기에는 연결하지 않고
// 기존 규칙도 고치지 않습니다. applyDenyOverlay()는 "기존 판정 결과 위에 거부만 덧씌우고, 맞는 규칙이
// 없으면 기존 판정에 그대로 위임"하는 부품이며, 지금은 scripts/xdr-replay.mjs의 모의 재생에서만 씁니다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';

export const MODULE_KEY = 'brute-force';
const RULES_SCHEMA = 'aleph.xdr.deny-rules.v1';
const BLOCK_AT = 0.85;
const TTL_MINUTES = 15;
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
const sourceIpOf = alert => (typeof alert?.data?.srcip === 'string' ? alert.data.srcip : '');

// 어느 모듈의 규칙이든 해당 시각에 유효한(issuedAt ≤ at < expiresAt) 거부 규칙이 있는지 봅니다.
export function activeDenyRules(rules, sourceIp, at) {
  const now = at instanceof Date ? at.getTime() : timeOf(at);
  if (now === null) return [];
  return (Array.isArray(rules) ? rules : []).filter(rule => rule?.action === 'deny'
    && rule.sourceIp === sourceIp && timeOf(rule.issuedAt) !== null && timeOf(rule.expiresAt) !== null
    && timeOf(rule.issuedAt) <= now && now < timeOf(rule.expiresAt));
}

export const isDeniedAddress = (rules, sourceIp, at) => activeDenyRules(rules, sourceIp, at).length > 0;

// 기존 판정 결과(base)는 그대로 두고, 유효한 거부 규칙이 있을 때만 거부를 덧씌웁니다.
export function applyDenyOverlay({ base, rules, sourceIp, at }) {
  const matched = blockableAddress(sourceIp) ? activeDenyRules(rules, sourceIp, at) : [];
  if (!matched.length) return base;
  return {
    ...base,
    decision: 'deny',
    reasonCode: 'xdr_deny_overlay',
    ruleIds: [...new Set(matched.map(rule => `xdr.${rule.moduleKey}.${rule.evidenceAlertId}`))],
  };
}

// 차단 후보 → 추가 거부 규칙. block이고 확신도 0.85 이상이며 시각·출발 주소·근거가 유효할 때만 만듭니다.
export function buildDenyRules(decisions) {
  const normalAddresses = new Set(decisions.filter(d => d.out.action === 'record').map(d => sourceIpOf(d.alert)).filter(Boolean));
  const rules = [];
  const skipped = [];
  for (const { alert, out } of decisions) {
    if (out.action !== 'block' || out.confidence < BLOCK_AT) continue;
    const sourceIp = sourceIpOf(alert);
    const issued = timeOf(alert?.timestamp);
    const alertId = typeof alert?.id === 'string' && alert.id ? alert.id : null;
    if (!alertId) { skipped.push({ alertId: '-', reason: '근거 경보 번호 없음' }); continue; }
    if (issued === null) { skipped.push({ alertId, reason: '경보 시각 없음' }); continue; }
    if (!blockableAddress(sourceIp)) { skipped.push({ alertId, reason: '막을 수 없는 주소 형식' }); continue; }
    if (normalAddresses.has(sourceIp)) { skipped.push({ alertId, reason: '같은 주소에 정상 이벤트가 있음' }); continue; }
    rules.push({
      sourceIp,
      action: 'deny',
      confidence: out.confidence,
      evidenceAlertId: alertId,
      issuedAt: new Date(issued).toISOString(),
      expiresAt: new Date(issued + TTL_MINUTES * 60 * 1000).toISOString(),
      moduleKey: MODULE_KEY,
      reason: out.reason.split(':')[0].slice(0, 120),
    });
  }
  return { rules, skipped };
}

// 이 모듈의 규칙만 새로 바꾸고 다른 모듈의 규칙은 그대로 보존합니다.
function writeRules(rulesPath, rules) {
  let others = [];
  if (existsSync(rulesPath)) {
    try {
      const saved = JSON.parse(readFileSync(rulesPath, 'utf8'));
      if (saved?.schema === RULES_SCHEMA && Array.isArray(saved.rules)) others = saved.rules.filter(rule => rule?.moduleKey !== MODULE_KEY);
    } catch { /* 읽을 수 없는 이전 파일은 이 모듈 규칙으로 새로 씁니다 */ }
  }
  const all = [...others, ...rules];
  mkdirSync(dirname(rulesPath), { recursive: true });
  writeFileSync(rulesPath, `${JSON.stringify({ schema: RULES_SCHEMA, rules: all }, null, 2)}\n`, 'utf8');
  return all;
}

// 알림 로그: block·alert만, 계정·원문 URL·비밀값 없이 `시각 | 모듈 | 행동 | 경보 번호 | 주소 | 확신도 | 패턴` 한 줄씩.
function appendAlerts(logPath, decisions) {
  const lines = decisions.filter(d => d.out.action !== 'record').map(({ alert, out }) => ({
    key: `${MODULE_KEY}|${alert.id}|${out.action}`,
    text: [alert.timestamp, MODULE_KEY, out.action, alert.id, sourceIpOf(alert) || '-', out.confidence.toFixed(2), out.reason.split(':')[0]].join(' | '),
  }));
  const known = new Set(existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split(String.fromCharCode(10)).map(line => line.trim()).filter(Boolean).map(line => {
      const parts = line.split(' | ');
      return `${parts[1]}|${parts[3]}|${parts[2]}`;
    })
    : []);
  const fresh = lines.filter(line => !known.has(line.key));
  if (fresh.length) {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${fresh.map(line => line.text).join(String.fromCharCode(10))}${String.fromCharCode(10)}`, 'utf8');
  }
  return fresh.length;
}

export async function respond(alerts, { rulesPath, logPath } = {}) {
  const decisions = [];
  for (const alert of alerts) decisions.push({ alert, out: await decide(alert) });
  const { rules, skipped } = buildDenyRules(decisions);
  const allRules = rulesPath ? writeRules(rulesPath, rules) : rules;
  const logLinesAdded = logPath ? appendAlerts(logPath, decisions) : 0;
  const counts = { block: 0, alert: 0, record: 0 };
  for (const { out } of decisions) counts[out.action] += 1;
  return { counts, decisions, rules, allRules, skipped, logLinesAdded };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    const fixture = JSON.parse(readFileSync(join(root, 'xdr', 'fixtures', `${MODULE_KEY}.json`), 'utf8'));
    const result = await respond(fixture.alerts, {
      rulesPath: join(root, 'xdr', 'deny-rules.json'),
      logPath: join(root, 'xdr', 'alerts.log'),
    });
    console.log(`block ${result.counts.block} · alert ${result.counts.alert} · record ${result.counts.record}`);
    console.log(`추가 거부 후보 ${result.rules.length}개(만료 ${TTL_MINUTES}분), 건너뜀 ${result.skipped.length}건, 알림 로그 ${result.logLinesAdded}줄 추가`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
