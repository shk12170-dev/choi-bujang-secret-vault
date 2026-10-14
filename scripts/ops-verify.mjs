// npm run ops:verify — 배포된 주소에 1~12단계의 정상·금지 요청을 실제로 보내 결과표를 만듭니다.
//   로그인이 필요한 요청은 환경변수 ALEPH_TOKEN_A(·ALEPH_B_MEMO_ID·ALEPH_USER_AGENT)를 넣었을 때만 보냅니다. 값은 출력하지 않습니다.
//   결과는 artifacts/ops-report.json·ops-report.md에 남습니다(git에 올리지 않음).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildCases, runCases, summarize, toMarkdown } from '../src/ops-report.mjs';

const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url), 'utf8'));
const baseUrl = config.publicAppUrl;
if (typeof baseUrl !== 'string' || !baseUrl.startsWith('https://')) {
  console.log('aleph.config.json의 publicAppUrl이 없어 실행하지 않았습니다.');
  process.exit(1);
}
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const forgedToken = `${part({ alg: 'ES256', typ: 'JWT' })}.${part({ sub: '00000000-0000-4000-8000-000000000000', role: 'authenticated' })}.${'A'.repeat(86)}`;

const cases = buildCases(config, { foreignMemoId: process.env.ALEPH_B_MEMO_ID });
const results = await runCases(cases, { baseUrl, env: process.env, forgedToken });

let commit = null;
try {
  const identity = await (await fetch(new URL('/aleph.json', baseUrl), { signal: AbortSignal.timeout(10000) })).json();
  commit = typeof identity.commit === 'string' ? identity.commit.slice(0, 12) : null;
} catch { /* 배포 커밋을 읽지 못하면 알 수 없음으로 둡니다 */ }

const generatedAt = new Date().toISOString();
const report = { generatedAt, baseUrl, commit, summary: summarize(results), results };
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/ops-report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL('../artifacts/ops-report.md', import.meta.url), toMarkdown(results, { commit, baseUrl, generatedAt }));

const sum = report.summary;
console.log(`전체 ${sum.total}건 · 통과 ${sum.passed} · 실패 ${sum.failed} · 오류 ${sum.error} · 미실행 ${sum.not_run}`);
console.log(`금지 요청 거부 ${sum.forbiddenRejected}건 · 정상 요청 허용 ${sum.normalAllowed}건 · 배포 커밋 ${commit ?? '알 수 없음'}`);
for (const item of results.filter(entry => entry.status === 'failed' || entry.status === 'error')) {
  console.log(`  ${LABEL(item.status)} ${item.stage}단계 ${item.method} ${item.path} → ${item.httpStatus ?? item.reason}`);
}
console.log('41종 공격 시험은 미실행입니다(통과로 세지 않음). 보고서: artifacts/ops-report.md');
if (sum.failed > 0 || sum.error > 0) process.exitCode = 1;

function LABEL(status) { return status === 'failed' ? '실패' : '오류'; }
