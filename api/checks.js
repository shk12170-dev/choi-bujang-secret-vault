// GET /api/checks — 12단계 점검 결과와 작전실 요약.
//   (인자 없음)      제출 묶음과 같은 함수(src/checks-core.mjs)로 실행한 점검 목록과 수치. 로그인 없이 읽을 수 있고 비밀값·메모 본문이 없습니다.
//   ?case=<이름>     서버가 판정기·탐지·정책 사본을 가상 입력으로 실행한 규칙 점검 하나
//   ?view=ops        탈환 작전실 요약(로그인과 기기 승인이 필요)
import config from '../aleph.config.json' with { type: 'json' };
import { CASE_IDS, evaluateCase } from '../src/check-cases.mjs';
import { classify, runChecks, summarize } from '../src/checks-core.mjs';
import { requireLogin } from '../src/memo-api.mjs';
import { buildOpsSummary } from '../src/ops-summary.mjs';

let cached = null; // 같은 서버 인스턴스에서 20초 동안 재사용해 자기 호출이 반복되지 않게 합니다.
const CACHE_MS = 20000;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const query = request.query ?? {};

  if (query.view === 'ops') {
    const context = await requireLogin(request, response, ['GET']);
    if (!context) return undefined;
    const summary = await buildOpsSummary({
      login: context.login, db: context.db, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    });
    return response.status(200).json(summary);
  }

  if (typeof query.case === 'string') {
    if (!CASE_IDS.includes(query.case)) return response.status(404).json({ error: 'NOT_FOUND' });
    return response.status(200).json(await evaluateCase(query.case));
  }

  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) {
    const baseUrl = config.publicAppUrl;
    const { attempts, requestsSent } = await runChecks({ baseUrl, originalApiUrl: config.originalApiUrl });
    cached = { at: now, checkedAt: new Date(now).toISOString(), attempts, requestsSent };
  }
  const sum = summarize(cached.attempts);
  return response.status(200).json({
    checkedAt: cached.checkedAt,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 12) || null,
    step: config.step,
    total: sum.total,
    blocked: sum.blocked,
    failed: sum.failed,
    notRun: sum.notRun,
    requestsSent: cached.requestsSent,
    attempts: cached.attempts.map(item => ({ ...item, result: classify(item) })),
    note: '41종 공격 전체는 심판이 보내며 이 저장소에서는 실행하지 않았습니다. 표에 없는 공격을 통과로 적지 않습니다.',
  });
}
