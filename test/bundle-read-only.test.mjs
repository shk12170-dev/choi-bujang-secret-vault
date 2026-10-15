import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// 12단계 판정: 제출 묶음은 격리 환경에서 읽기 요청(GET·HEAD)만, 24건 이하로, Buffer·Response 전역 없이 실행돼야 한다.
test('npm run bundle의 점검은 12단계 이상에서 GET만 24건 이하로 보내고 Buffer·Response 없이 실행된다', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  assert.ok(config.step >= 12);
  const realFetch = globalThis.fetch;
  const realResponse = globalThis.Response;
  const realBuffer = globalThis.Buffer;
  const sent = [];
  const plain = status => ({
    status, headers: { get: () => 'application/json' },
    json: async () => ({ notes: [], allowedRoutes: ['GET /api/notes/:id'], originalApiUrl: config.originalApiUrl, jsonReady: true }),
  });
  globalThis.fetch = async (url, init = {}) => {
    sent.push(String(init.method ?? 'GET').toUpperCase());
    const path = new URL(url).pathname;
    return plain(['/data.json', '/aleph.json', '/api/checks'].includes(path) && !String(url).includes('view=ops') ? 200 : 401);
  };
  delete globalThis.Response;
  // 점검이 실행되는 동안 Buffer 전역이 없는 환경을 흉내 낸다(시험 도구는 미리 읽어 둔 모듈만 쓴다).
  const { runAttackChecks } = await import('../src/attack-check.mjs');
  globalThis.Buffer = undefined;
  try {
    const attempts = await runAttackChecks(config);
    assert.ok(attempts.length >= 1 && attempts.length <= 20);
    assert.ok(sent.length > 0 && sent.length <= 24);
    assert.deepEqual([...new Set(sent)].filter(method => method !== 'GET' && method !== 'HEAD'), []);
    const notRun = attempts.filter(item => item.observed === 'not_run').map(item => item.attackId).sort();
    assert.deepEqual(notRun, ['s10-restore-unauth', 's11-notice-write']);
    for (const item of attempts) assert.deepEqual(Object.keys(item).sort(), ['attackId', 'expected', 'observed']);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.Response = realResponse;
    globalThis.Buffer = realBuffer;
  }
});
