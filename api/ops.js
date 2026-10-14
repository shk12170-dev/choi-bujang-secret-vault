// GET /api/ops — 12단계 탈환 작전실 요약. 로그인과 기기 승인을 지난 요청에만 답합니다.
import { requireLogin } from '../src/memo-api.mjs';
import { buildOpsSummary } from '../src/ops-summary.mjs';

export default async function handler(request, response) {
  const context = await requireLogin(request, response, ['GET']);
  if (!context) return undefined;
  const summary = await buildOpsSummary({
    login: context.login, db: context.db, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
  return response.status(200).json(summary);
}
