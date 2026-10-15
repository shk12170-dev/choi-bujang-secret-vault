// npm run checks:table — artifacts/submission.json의 실제 점검 행으로 사례별 표(마크다운)를 만듭니다.
//   --write-readme 를 붙이면 README.md 아래쪽에 「사례별 실측 표」를 덧붙입니다. 이미 있는 표(과거 측정 기록)는 바꾸지 않습니다.
import { readFileSync, appendFileSync } from 'node:fs';

const submission = JSON.parse(readFileSync(new URL('../artifacts/submission.json', import.meta.url), 'utf8'));
const when = new Date().toISOString();
const rows = submission.attackAttempts;
const stageOf = id => (/^s(\d+)-/u.exec(id) ?? [])[1] ?? '-';
const result = observed => (observed === 'not_run' ? 'not_run' : /^HTTP (401|403)$/u.test(observed) || /; (jsonReady|notesEmpty)=true$/u.test(observed) ? 'blocked' : 'failed');
const count = value => rows.filter(row => result(row.observed) === value).length;
const lines = [
  '',
  `### 사례별 실측 표 (측정 커밋 \`${submission.commit.slice(0, 12)}\`, 측정 시각 ${when})`,
  '',
  `총 ${rows.length}건 · blocked ${count('blocked')} · failed ${count('failed')} · not_run ${count('not_run')}. 아래 행은 \`npm run bundle\`이 만든 \`artifacts/submission.json\`의 \`attackAttempts\`를 그대로 옮긴 것입니다. 이후 문서 커밋이 생겨도 이 표의 측정 커밋은 바꾸지 않습니다.`,
  '',
  '| 단계 | 점검 ID | 기대 조건 | 관측 | 결과 |',
  '|---|---|---|---|---|',
  ...rows.map(row => `| ${stageOf(row.attackId)} | ${row.attackId} | ${row.expected} | ${row.observed} | ${result(row.observed)} |`),
  '',
];
const text = `${lines.join('\n')}\n`;
if (process.argv.includes('--write-readme')) {
  appendFileSync(new URL('../README.md', import.meta.url), text);
  console.log(`README.md에 측정 커밋 ${submission.commit.slice(0, 12)}의 표를 덧붙였습니다.`);
} else {
  process.stdout.write(text);
}
