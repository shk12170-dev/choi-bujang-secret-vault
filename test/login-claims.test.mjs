import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT, generateKeyPair } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import { memoRoute } from '../src/memo-routes.mjs';
import { createLoginVerifier } from '../src/verify-login.mjs';

// 심판 서버의 키 대신 이 시험에서 만든 키를 검증기에 넣어, 실제 검증 코드가 토큰 조건을 어떻게 판단하는지 확인합니다.
// 심판 환경 자체는 재현할 수 없고, 심판 토큰의 서명·대상·역할 조건과 다른 서비스용 학생 토큰의 거부를 시험합니다.
const { privateKey, publicKey } = await generateKeyPair('ES256');
const { privateKey: otherPrivate } = await generateKeyPair('ES256');
const app = new URL(config.publicAppUrl);
const now = Math.floor(Date.now() / 1000);
const uuid = () => crypto.randomUUID();

const judgeClaims = (patch = {}) => ({
  iss: config.judgeIssuer, aud: app.hostname, sub: uuid(), aleph_run: uuid(),
  aleph_role: 'judge', aleph_identity: 'a', ...patch,
});
const signJudge = (claims, { key = privateKey, iat = now, exp = now + 600 } = {}) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'judge-test' }).setIssuedAt(iat).setExpirationTime(exp).sign(key);

// 학생 토큰은 Supabase가 서명 검증을 맡으므로, 검증된 claims를 돌려주는 가짜 클라이언트로 서버 쪽 조건만 시험합니다.
const studentClaims = new Map();
const supabaseClient = { auth: { getClaims: async token => ({ data: { claims: studentClaims.get(token) }, error: studentClaims.has(token) ? null : new Error('invalid') }) } };
const studentToken = async claims => {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setIssuer(claims.iss).sign(otherPrivate);
  studentClaims.set(token, claims);
  return token;
};
const base = userId => ({ iss: config.identityProvider.issuer, aud: config.identityProvider.audience, role: 'authenticated', sub: userId, exp: now + 600 });

const verify = createLoginVerifier({ config, judgeKeySet: async () => publicKey, supabaseClient });
const header = token => `Bearer ${token}`;

test('정상 심판 토큰은 judge 신원으로 통과하고 사용자 ID는 토큰의 sub다', async () => {
  const claims = judgeClaims();
  const login = await verify(header(await signJudge(claims)));
  assert.equal(login?.kind, 'judge');
  assert.equal(login.userId, claims.sub);
});

test('심판 토큰의 서명·대상·역할·신원·수명 조건이 하나라도 틀리면 거부된다', async () => {
  const bad = {
    '다른 키로 서명': await signJudge(judgeClaims(), { key: otherPrivate }),
    '다른 대상(aud)': await signJudge(judgeClaims({ aud: 'other-app.vercel.app' })),
    '심판 역할이 아님': await signJudge(judgeClaims({ aleph_role: 'student' })),
    '신원이 a/b가 아님': await signJudge(judgeClaims({ aleph_identity: 'c' })),
    '만료': await signJudge(judgeClaims(), { iat: now - 2000, exp: now - 1000 }),
    '수명이 15분 초과': await signJudge(judgeClaims(), { exp: now + 3600 }),
    'sub가 UUID가 아님': await signJudge(judgeClaims({ sub: 'judge' })),
  };
  for (const [name, token] of Object.entries(bad)) assert.equal(await verify(header(token)), null, name);
});

test('학생 토큰은 발급자·대상·역할·만료가 맞을 때만 통과한다(다른 서비스용 토큰 거부)', async () => {
  const id = uuid();
  const ok = await verify(header(await studentToken(base(id))));
  assert.deepEqual({ kind: ok?.kind, userId: ok?.userId }, { kind: 'student', userId: id });
  const bad = {
    '다른 서비스용(aud)': base(id), '비로그인 역할(anon)': base(id), '만료': base(id), 'sub가 UUID가 아님': base(id),
  };
  bad['다른 서비스용(aud)'].aud = 'another-service';
  bad['비로그인 역할(anon)'].role = 'anon';
  bad['만료'].exp = now - 10;
  bad['sub가 UUID가 아님'].sub = 'not-a-uuid';
  for (const [name, claims] of Object.entries(bad)) assert.equal(await verify(header(await studentToken(claims))), null, name);
  // 발급자가 둘 중 어느 쪽도 아닌 토큰
  const stranger = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256' }).setIssuer('https://evil.example/auth/v1').sign(otherPrivate);
  assert.equal(await verify(header(stranger)), null);
});

test('검증된 심판 신원과 학생은 서로의 메모를 읽거나 고칠 수 없다', async () => {
  const student = await verify(header(await studentToken(base(uuid()))));
  const judge = await verify(header(await signJudge(judgeClaims())));
  assert.ok(student && judge);
  const rows = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', owner_id: student.userId, title: '학생', body: '학생 본문' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_id: judge.userId, title: '심판', body: '심판 본문' },
  ];
  const db = { from: () => {
    const f = [];
    const api = {
      select: () => api, eq: (k, v) => { f.push([k, v]); return api; }, update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows.find(r => f.every(([k, v]) => r[k] === v)) ?? null, error: null }),
    };
    return api;
  } };
  const call = (request, login) => new Promise(resolve => memoRoute(request, { status: code => ({ json: body => resolve({ code, body }) }) }, { login, db }));
  const get = (id, login) => call({ method: 'GET', query: { id } }, login);
  assert.equal((await get(rows[0].id, judge)).code, 404);
  assert.equal((await get(rows[1].id, student)).code, 404);
  assert.equal((await get(rows[1].id, judge)).code, 200);
  assert.equal((await call({ method: 'PUT', query: { id: rows[0].id }, body: { title: 'x' } }, judge)).code, 404);
  assert.equal((await call({ method: 'DELETE', query: { id: rows[0].id } }, judge)).code, 404);
});
