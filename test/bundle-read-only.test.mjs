import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// 12단계 판정: 제출 묶음은 격리 환경에서 읽기 요청(GET·HEAD)만 보낼 수 있다.
test('npm run bundle의 점검은 12단계 이상에서 쓰기 요청을 보내지 않고 쓰기 점검은 not_run으로 남긴다', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  assert.ok(config.step >= 12);
  const realFetch = globalThis.fetch;
  const realResponse = globalThis.Response;
  const methods = [];
  // 격리 환경에는 Response·Headers 같은 전역이 없을 수 있다. 응답은 읽는 항목만 가진 일반 객체로 흉내 낸다.
  const body = { error: 'LOGIN_REQUIRED', allowedRoutes: ['GET /api/notes/:id'], originalApiUrl: config.originalApiUrl, notes: [] };
  const plain = {
    ok: false, status: 401, headers: { get: () => 'application/json' },
    json: async () => body, text: async () => JSON.stringify(body), clone: () => plain,
  };
  globalThis.fetch = async (_input, init = {}) => {
    methods.push(String(init.method ?? 'GET').toUpperCase());
    return plain;
  };
  delete globalThis.Response;
  try {
    const { runAttackChecks } = await import('../src/attack-check.mjs');
    const attempts = await runAttackChecks(config);
    assert.ok(attempts.length >= 1 && attempts.length <= 20);
    assert.ok(methods.length > 0);
    assert.deepEqual([...new Set(methods)].filter(method => method !== 'GET' && method !== 'HEAD'), []);
    const notRun = attempts.filter(item => item.observed === 'not_run').map(item => item.attackId).sort();
    assert.deepEqual(notRun, ['anonymous_note_restore', 'anonymous_notice_write_by_id', 'auth_proxy_empty_login']);
    for (const item of attempts) assert.deepEqual(Object.keys(item).sort(), ['attackId', 'expected', 'observed']);
    assert.equal(globalThis.fetch !== realFetch, true); // 시험용 대체가 그대로여야 점검이 원래 fetch를 되돌려 놓은 것
  } finally {
    globalThis.fetch = realFetch;
    globalThis.Response = realResponse;
  }
});

test('번들 점검 코드는 격리 환경이 허용하지 않는 가져오기를 쓰지 않는다', async () => {
  const check = await readFile(new URL('../src/attack-check.mjs', import.meta.url), 'utf8');
  const probes = await readFile(new URL('../src/ops-probes.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(probes, /node:fs|child_process|\.json'/u);
  assert.doesNotMatch(check, /globalThis\.crypto|[^.\w]crypto\.randomUUID/u);
});
