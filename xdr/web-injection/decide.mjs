// 제작 3: 웹 주입 경보 판단 모듈. 다른 파일·패키지를 불러오지 않고, 파일·네트워크·시계를 쓰지 않고,
// 받은 경보 하나만 보고 혼자 계산해 { action, confidence, reason }을 돌려줍니다. 경보 원본은 고치지 않습니다.
// 패턴은 xdr/web-injection/patterns.json(근거: MITRE ATT&CK T1190)과 같은 내용을 옮겨 적은 상수입니다.
// 차단(block)은 주입 구조 근거 + 같은 주소의 반복 집계 + 경보 수준을 함께 만족할 때만 내립니다.
// select·script·SQL 같은 단어 하나, 수준, 태그, 주소, 경보 번호·순서만으로는 막지 않습니다.
// 요청 주소는 길이를 제한하고 최대 두 번 디코딩해 문자열로만 검사하며, 어떤 구문도 실행하지 않습니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'sql-injection',
    name: '요청 인자 안의 SQL 구문',
    technique: 'T1190',
  }),
  Object.freeze({
    id: 'script-injection',
    name: '요청 인자 안의 스크립트 태그',
    technique: 'T1190',
  }),
  Object.freeze({
    id: 'path-traversal',
    name: '경로 거슬러 올라가기(../) 반복',
    technique: 'T1190',
  }),
  Object.freeze({
    id: 'command-injection',
    name: '요청 인자 안의 명령 구분자',
    technique: 'T1190',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
// 학습용 기준값입니다. MITRE가 정한 보편 임계값이 아닙니다.
const MIN_REPEATS = 5;
const STRONG_LEVEL = 10;
const SENSOR_NOTABLE_LEVEL = 5;
const MAX_URL_LENGTH = 2048;

const byId = Object.freeze(Object.fromEntries(PATTERNS.map(pattern => [pattern.id, pattern])));

// 센서 설명에서 주입 구조를 말하는 표현(부정문은 제외)
const DESCRIPTION_STRUCTURE = Object.freeze({
  'sql-injection': /(SQL|데이터베이스\s*조회)[^.]*(구문|표기|표식|이어\s*붙)|(구문|표기|표식)[^.]*SQL/iu,
  'script-injection': /스크립트\s*(삽입|표식|태그)/u,
  'path-traversal': /경로[^.]*(거슬러|이탈)/u,
  'command-injection': /명령\s*(구분자|주입)/u,
});

// 요청 주소 안의 주입 구조(디코딩한 문자열을 검사만 함). doc-* 는 공식 가상 경보의 문서용 표기입니다.
const URL_STRUCTURE = Object.freeze({
  'sql-injection': /\bunion\b[\s\S]{0,30}\bselect\b|'\s*(or|and)\s+['\d]|\bor\s+\d+\s*=\s*\d+|;\s*(drop|delete|insert|update)\s|\/\*|\bsleep\s*\(|doc-sql|doc-mixed/u,
  'script-injection': /<\s*\/?\s*script\b|\bon(error|load|click|mouseover)\s*=|javascript:|doc-script|doc-mixed/u,
  'path-traversal': /(\.\.[\\/]){2,}|doc-up-repeat/u,
  'command-injection': /(;|\|\||&&|\$\(|`)\s*(cat|ls|id|whoami|rm|curl|wget|sh|bash|nc|ping)\b|doc-cmd/u,
});

function decodeUrl(value) {
  let text = typeof value === 'string' ? value.slice(0, MAX_URL_LENGTH) : '';
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(text.replace(/\+/gu, ' '));
      if (next === text) break;
      text = next;
    } catch {
      break;
    }
  }
  return text.toLowerCase();
}

function readSignals(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const level = Number.isInteger(alert?.rule?.level) ? alert.rule.level : 0;
  let repeats = Number.parseInt(String(data.count ?? ''), 10);
  if (!Number.isFinite(repeats) || repeats < 0) {
    const match = /(\d+)\s*(번|회|건)/u.exec(description);
    repeats = match ? Number.parseInt(match[1], 10) : 0;
  }
  // "…표식은 아닙니다", "…없습니다"처럼 부정하는 문장은 구조 근거로 쓰지 않습니다.
  const positive = description.split('.').filter(sentence => !/아닙니다|없습니다/u.test(sentence)).join('.');
  const url = decodeUrl(data.url);
  const structures = PATTERNS.map(pattern => ({
    id: pattern.id,
    fromDescription: DESCRIPTION_STRUCTURE[pattern.id].test(positive),
    fromUrl: URL_STRUCTURE[pattern.id].test(url),
  })).filter(item => item.fromDescription || item.fromUrl);
  return { level, repeats, structures };
}

function actionFor(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return { action: 'record', confidence: 0, reason: '경보 형식이 아니라 기록만 남김' };
  }
  const { level, repeats, structures } = readSignals(alert);
  const evidence = `반복 ${repeats}번, 수준 ${level}`;

  if (structures.length) {
    // 근거가 여럿이면 설명과 요청 주소 양쪽에서 확인된 패턴을 앞에 둡니다. 같으면 상수 순서를 따릅니다.
    const best = [...structures].sort((a, b) => Number(b.fromDescription && b.fromUrl) - Number(a.fromDescription && a.fromUrl))[0];
    const pattern = byId[best.id];
    const names = structures.map(item => item.id).join('+');
    let confidence;
    if (repeats >= MIN_REPEATS && level >= STRONG_LEVEL) {
      confidence = 0.9 + (repeats >= 10 ? 0.04 : 0) + (repeats >= 15 ? 0.02 : 0) + (structures.length > 1 ? 0.01 : 0);
    } else {
      // 구조는 있으나 반복이 적거나 수준이 낮으면 알림만 남깁니다.
      confidence = repeats >= 2 ? 0.7 : 0.6;
    }
    confidence = Math.round(Math.min(0.97, confidence) * 100) / 100;
    return { action: actionFor(confidence), confidence, reason: `${pattern.name} [${names}, ${pattern.technique}]: ${evidence}` };
  }

  // 주입 구조는 보이지 않지만 센서가 눈여겨볼 수준으로 남긴 웹 경보는 애매한 사례로 알림만 남깁니다.
  if (level >= SENSOR_NOTABLE_LEVEL) {
    return { action: 'alert', confidence: 0.55, reason: `주입 구조·반복 근거가 약한 웹 경보라 알림만 남김: ${evidence}` };
  }
  return { action: 'record', confidence: 0.1, reason: `주입 패턴과 맞지 않아 기록만 남김: ${evidence}` };
}
