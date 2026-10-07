import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import { authRoute } from '../src/auth-proxy.mjs';

const realFetch = globalThis.fetch;
const realEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY };
const calls = [];

beforeEach(() => {
  calls.length = 0;
  process.env.SUPABASE_URL = 'https://example-project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TEST_ONLY_VALUE';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.SUPABASE_URL = realEnv.url;
  process.env.SUPABASE_PUBLISHABLE_KEY = realEnv.key;
  if (realEnv.url === undefined) delete process.env.SUPABASE_URL;
  if (realEnv.key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
});

const fakeUpstream = (status, body) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
};
const call = (request) => new Promise(resolve => {
  const headers = {};
  authRoute({ headers: {}, ...request }, {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    status: code => ({ json: body => resolve({ code, body, headers }) }),
  });
});

test('로그인 성공은 필요한 값만 돌려주고 공개 키는 서버에서만 쓴다', async () => {
  fakeUpstream(200, { access_token: 'a.b.c', refresh_token: 'r', expires_at: 1900000000, token_type: 'bearer', user: { email: 'a@test.invalid', id: 'secret-id', app_metadata: { x: 1 } } });
  const out = await call({ method: 'POST', query: { action: 'login' }, body: { email: 'a@test.invalid', password: 'pw' } });
  assert.equal(out.code, 200);
  assert.deepEqual(Object.keys(out.body).sort(), ['access_token', 'email', 'expires_at', 'refresh_token']);
  assert.equal(calls[0].url, 'https://example-project.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(calls[0].init.headers.apikey, 'sb_publishable_TEST_ONLY_VALUE');
  assert.equal(out.headers['cache-control'], 'no-store');
  assert.ok(!JSON.stringify(out.body).includes('sb_publishable_'));
});

test('로그인 실패는 401과 오류 코드만, 비밀번호는 응답에 없다', async () => {
  fakeUpstream(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  const out = await call({ method: 'POST', query: { action: 'login' }, body: { email: 'a@test.invalid', password: 'secret-pw-123' } });
  assert.equal(out.code, 401);
  assert.deepEqual(out.body, { error: 'invalid_credentials' });
  assert.ok(!JSON.stringify(out).includes('secret-pw-123'));
});

test('잘못된 입력·메서드·경로·설정 누락은 Supabase를 부르지 않고 거부한다', async () => {
  fakeUpstream(200, {});
  assert.equal((await call({ method: 'POST', query: { action: 'login' }, body: { email: '', password: 'x' } })).code, 400);
  assert.equal((await call({ method: 'POST', query: { action: 'login' }, body: { email: 'a@b.c', password: 'x'.repeat(201) } })).code, 400);
  assert.equal((await call({ method: 'POST', query: { action: 'login' }, body: [] })).code, 400);
  assert.equal((await call({ method: 'GET', query: { action: 'login' } })).code, 405);
  assert.equal((await call({ method: 'POST', query: { action: 'admin' } })).code, 404);
  assert.equal(calls.length, 0);
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  assert.equal((await call({ method: 'POST', query: { action: 'login' }, body: { email: 'a@b.c', password: 'x' } })).code, 500);
  assert.equal(calls.length, 0);
});

test('토큰 갱신과 로그아웃', async () => {
  fakeUpstream(200, { access_token: 'n.e.w', refresh_token: 'r2', expires_at: 1900000100, user: { email: 'a@test.invalid' } });
  const refreshed = await call({ method: 'POST', query: { action: 'refresh' }, body: { refresh_token: 'r' } });
  assert.equal(refreshed.code, 200);
  assert.equal(calls[0].url, 'https://example-project.supabase.co/auth/v1/token?grant_type=refresh_token');

  calls.length = 0;
  fakeUpstream(204, {});
  const token = 'aaa.bbb.ccc';
  const out = await call({ method: 'POST', query: { action: 'logout' }, headers: { authorization: `Bearer ${token}` } });
  assert.equal(out.code, 200);
  assert.equal(calls[0].url, 'https://example-project.supabase.co/auth/v1/logout?scope=local');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  // 토큰이 없거나 형식이 틀려도 브라우저는 로그아웃 상태가 되며 Supabase를 부르지 않는다.
  calls.length = 0;
  assert.equal((await call({ method: 'POST', query: { action: 'logout' } })).code, 200);
  assert.equal(calls.length, 0);
});

test('Supabase 장애는 502로 알리고 상세를 새지 않는다', async () => {
  fakeUpstream(503, { msg: 'internal detail' });
  const out = await call({ method: 'POST', query: { action: 'login' }, body: { email: 'a@b.c', password: 'x' } });
  assert.equal(out.code, 502);
  assert.deepEqual(out.body, { error: 'AUTH_UNAVAILABLE' });
  globalThis.fetch = async () => { throw new Error('network'); };
  assert.equal((await call({ method: 'POST', query: { action: 'login' }, body: { email: 'a@b.c', password: 'x' } })).code, 502);
});

test('화면 코드에는 Supabase 공개 키·주소·SDK가 없고 서버 함수만 부른다', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /sb_publishable_|sb_secret_|service_role|supabase\.co|supabase-js|createClient|\/rest\/v1/u);
  assert.doesNotMatch(html, /eyJ[A-Za-z0-9_-]{12,}\./u);
  assert.match(html, /\/api\/auth\//u);
  assert.match(html, /\/api\/notes/u);
});
