// XDR 공통 읽기 모듈: Wazuh 경보에서 시각·출발 주소·계정·규칙 수준·설명만 뽑습니다(확인용).
// 원본 경보는 고치지 않고, 비밀값처럼 보이는 문자열은 [가림]으로 바꿉니다. 각 모듈의 decide.mjs는 이 파일을 부르지 않습니다.
import { readFileSync } from 'node:fs';

const MASK = '[가림]';
const SECRET_LIKE = new RegExp([
  '(?:password|passwd|pwd|token|secret|apikey|api_key|authorization|bearer)\\s*[:=]\\s*\\S+',
  'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{6,}',
  'sb_(?:secret|publishable)_\\S+',
  '\\b[A-Fa-f0-9]{32,}\\b',
  '-----BEGIN[^\\n]*',
].join('|'), 'giu');

const mask = value => (typeof value === 'string' ? value.replace(SECRET_LIKE, MASK) : value);
const text = value => (typeof value === 'string' && value.trim() ? mask(value.trim()) : '-');

export function readAlerts(fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || !Array.isArray(fixture.alerts)) {
    throw new Error('경보 묶음 형식이 아닙니다.');
  }
  return fixture.alerts.map(alert => ({
    id: text(alert?.id),
    at: text(alert?.timestamp),
    srcip: text(alert?.data?.srcip),
    account: text(alert?.data?.srcuser ?? alert?.data?.dstuser),
    level: Number.isInteger(alert?.rule?.level) ? alert.rule.level : null,
    description: text(alert?.rule?.description),
  }));
}

export const formatRow = row =>
  [row.id, row.at, row.srcip, row.account, `수준 ${row.level ?? '-'}`, row.description].join(' | ');

// 모듈별 read-alerts.mjs를 직접 실행했을 때 쓰는 공통 출력입니다.
export function printAlerts(fixturePath) {
  const rows = readAlerts(fixturePath);
  const total = JSON.parse(readFileSync(fixturePath, 'utf8')).alerts.length;
  for (const row of rows) console.log(formatRow(row));
  console.log(`경보 ${total}건 / 뽑은 줄 ${rows.length}줄 / ${total === rows.length ? '건수 일치' : '건수 불일치'}`);
  return total === rows.length;
}
