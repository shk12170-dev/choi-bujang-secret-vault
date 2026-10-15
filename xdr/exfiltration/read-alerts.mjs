// 제작 1: 자료 반출 경보에서 시각·출발 주소·계정·규칙 수준·설명만 뽑는 확인용 읽기 모듈입니다.
// 공통 구현은 xdr/read-alerts.mjs에 있고(비밀값처럼 보이는 문자열은 [가림]), decide.mjs는 이 파일을 부르지 않습니다.
// 원본 경보는 고치지 않습니다.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRow, printAlerts, readAlerts } from '../read-alerts.mjs';

export { formatRow, readAlerts };

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    if (!printAlerts(process.argv[2] ?? join(root, 'xdr', 'fixtures', 'exfiltration.json'))) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '읽기 오류');
    process.exitCode = 1;
  }
}
