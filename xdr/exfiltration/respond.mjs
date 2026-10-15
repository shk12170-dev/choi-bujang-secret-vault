// 제작 4: 자료 반출 decide 결과 가운데 차단 후보만 만료 시각(경보 시각 + 15분)·근거 경보 번호가 있는
// 추가 거부 후보로 만들어(xdr/deny-rules.json, 다른 모듈 규칙 보존) 그 **목적지**를 막을 대상으로 만들고,
// 알림을 xdr/alerts.log에 한 줄씩 쌓습니다. 정상 이벤트가 쓴 목적지(자료실 주소 등)는 규칙으로 만들지 않습니다.
// 로그에는 계정·비밀값을 넣지 않습니다. decide.mjs는 판단만 돌려주고 파일을 쓰지 않습니다.
// 공통 구현과 판정기 연결 범위는 xdr/ztna-overlay.mjs에 있습니다. 운영 판정기(src/decider.mjs)와 기존 규칙은 고치지 않습니다.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TTL_MINUTES, respondWith } from '../ztna-overlay.mjs';
import { decide } from './decide.mjs';

export { activeDenyRules, applyDenyOverlay, blockableAddress, isDeniedAddress, isDeniedDestination } from '../ztna-overlay.mjs';
export const MODULE_KEY = 'exfiltration';
export const TARGET = 'destination';
export const respond = (alerts, options) => respondWith(MODULE_KEY, decide, alerts, { ...options, target: TARGET });

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
    console.log(`목적지 거부 후보 ${result.rules.length}개(만료 ${TTL_MINUTES}분), 건너뜀 ${result.skipped.length}건, 알림 로그 ${result.logLinesAdded}줄 추가`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
