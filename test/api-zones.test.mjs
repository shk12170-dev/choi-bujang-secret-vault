import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import { collectionRoute, memoRoute } from '../src/memo-routes.mjs';
import { adminNoticeRoute, instructorIds, isInstructor, noticeRoute } from '../src/notice-routes.mjs';

const A = { kind: 'student', userId: randomUUID() };
const B = { kind: 'student', userId: randomUUID() };
const T = { kind: 'student', userId: randomUUID() }; // 강사 허용 목록에 넣을 사용자
const J = { kind: 'judge', userId: randomUUID(), runId: randomUUID(), identity: 'a' };

// 표 이름별로 행을 두는 가상 DB. 서버 코드가 쓰는 조회·추가·수정·삭제 방식만 흉내 냅니다.
function fakeDb(tables) {
  const data = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
  let counter = 0;
  const from = name => {
    const rows = data[name];
    const state = { mode: 'select', filters: [], patch: null, row: null, sort: null };
    const matched = () => rows.filter(r => state.filters.every(([k, v]) => r[k] === v));
    const run = () => {
      if (state.mode === 'insert') {
        const row = { id: state.row.id ?? `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, ...state.row };
        rows.push(row);
        return [row];
      }
      let found = matched();
      if (state.mode === 'update') found.forEach(r => Object.assign(r, state.patch));
      if (state.mode === 'delete') found.forEach(r => rows.splice(rows.indexOf(r), 1));
      if (state.sort) found = [...found].sort((x, y) => String(x[state.sort]).localeCompare(String(y[state.sort])));
      return found;
    };
    const api = {
      select() { return api; },
      eq(k, v) { state.filters.push([k, v]); return api; },
      order(column) { state.sort = column; return api; },
      insert(row) { state.mode = 'insert'; state.row = row; return api; },
      update(patch) { state.mode = 'update'; state.patch = patch; return api; },
      delete() { state.mode = 'delete'; return api; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0], error: null }),
      then: resolve => resolve({ data: run(), error: null }),
    };
    return api;
  };
  return { from, data };
}

const call = (route, request, login, db) => new Promise(resolve => {
  const headers = {};
  const response = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    status: code => ({ json: body => resolve({ code, body, headers }) }),
  };
  Promise.resolve(route({ headers: {}, query: {}, ...request }, response, { login, db })).catch(error => resolve({ code: 500, body: String(error) }));
});

const A_MEMO = randomUUID();
const B_MEMO = randomUUID();
const NOTICE = randomUUID();
const seed = () => fakeDb({
  user_notes: [
    { id: A_MEMO, owner_id: A.userId, title: 'A의 메모 제목', body: 'A만 아는 본문', created_at: 1 },
    { id: B_MEMO, owner_id: B.userId, title: 'B의 메모 제목', body: 'B만 아는 본문', created_at: 2 },
  ],
  class_notices: [{ id: NOTICE, title: '반 공지', body: '공지 본문', updated_by: null, updated_at: '2026-01-01' }],
});

// 거부 로그를 모읍니다.
const warnings = [];
const realWarn = console.warn;
const realEnv = process.env.INSTRUCTOR_USER_IDS;
beforeEach(() => {
  warnings.length = 0;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  delete process.env.INSTRUCTOR_USER_IDS;
});
afterEach(() => {
  console.warn = realWarn;
  if (realEnv === undefined) delete process.env.INSTRUCTOR_USER_IDS;
  else process.env.INSTRUCTOR_USER_IDS = realEnv;
});

const memoOf = (db, id) => db.data.user_notes.find(r => r.id === id);

test('메뉴를 우회한 직접 요청: B가 A의 메모를 읽거나 목록으로 받아도 A의 자료가 나오지 않는다', async () => {
  const db = seed();
  const read = await call(memoRoute, { method: 'GET', query: { id: A_MEMO } }, B, db);
  assert.equal(read.code, 404);
  assert.ok(!JSON.stringify(read.body).includes('A만 아는'));
  const list = await call(collectionRoute, { method: 'GET' }, B, db);
  assert.equal(list.code, 200);
  assert.deepEqual(list.body.map(m => m.id), [B_MEMO]);
  assert.ok(!JSON.stringify(list.body).includes('A만 아는'));
  // 본인 정상 요청은 유지된다.
  const own = await call(memoRoute, { method: 'GET', query: { id: A_MEMO } }, A, db);
  assert.deepEqual([own.code, own.body.title], [200, 'A의 메모 제목']);
  const ownList = await call(collectionRoute, { method: 'GET' }, A, db);
  assert.deepEqual(ownList.body.map(m => m.id), [A_MEMO]);
});

test('B가 A의 메모를 고치거나 지우려 해도 거부되고 A의 메모는 그대로다(요청 본문의 role·소유자 포함)', async () => {
  const db = seed();
  const before = JSON.stringify(memoOf(db, A_MEMO));
  const attempts = [
    { method: 'PUT', query: { id: A_MEMO }, body: { title: '탈취', body: '탈취' } },
    { method: 'PUT', query: { id: A_MEMO }, body: { title: '탈취', role: 'instructor', isInstructor: true, userId: A.userId } },
    { method: 'PUT', query: { id: A_MEMO }, body: { title: '탈취', owner_id: B.userId } },
    { method: 'PUT', query: { id: A_MEMO, role: 'instructor' }, headers: { 'x-role': 'instructor' }, body: { title: '탈취' } },
    { method: 'DELETE', query: { id: A_MEMO }, headers: { 'x-role': 'instructor' } },
  ];
  for (const request of attempts) {
    const result = await call(memoRoute, request, B, db);
    assert.ok([403, 404].includes(result.code), `${request.method} → ${result.code}`);
    assert.ok(!JSON.stringify(result.body).includes('A만 아는'));
  }
  assert.equal(JSON.stringify(memoOf(db, A_MEMO)), before);
  // 본인의 정상 수정은 되고, 본문의 role은 무시되며 소유자는 바뀌지 않는다.
  const own = await call(memoRoute, { method: 'PUT', query: { id: A_MEMO }, body: { title: '새 제목', body: '새 본문', role: 'instructor' } }, A, db);
  assert.deepEqual([own.code, own.body.title], [200, '새 제목']);
  assert.equal(memoOf(db, A_MEMO).owner_id, A.userId);
});

test('거부 사유는 서버 로그에 짧게 남고 사용자 ID·본문은 기록되지 않는다', async () => {
  const db = seed();
  await call(memoRoute, { method: 'GET', query: { id: A_MEMO } }, B, db);
  await call(memoRoute, { method: 'DELETE', query: { id: A_MEMO } }, B, db);
  await call(memoRoute, { method: 'GET', query: { id: randomUUID() } }, B, db);
  await call(memoRoute, { method: 'PUT', query: { id: A_MEMO }, body: { title: 'x', owner_id: A.userId } }, B, db);
  assert.ok(warnings.some(line => /resource=student\.memo\.item action=read reason=not_owner/u.test(line)));
  assert.ok(warnings.some(line => /action=delete reason=not_owner/u.test(line)));
  assert.ok(warnings.some(line => /reason=not_found/u.test(line)));
  for (const line of warnings) {
    assert.ok(line.length < 120, line);
    for (const secret of [A.userId, B.userId, A_MEMO, 'A만 아는', 'A의 메모']) assert.ok(!line.includes(secret), line);
  }
  // 응답은 없는 메모와 구별되지 않는다.
  const other = await call(memoRoute, { method: 'GET', query: { id: A_MEMO } }, B, db);
  const missing = await call(memoRoute, { method: 'GET', query: { id: randomUUID() } }, B, db);
  assert.deepEqual(other.body, missing.body);
});

test('반 공지: 로그인한 학생은 읽기만 되고 쓰기는 직접 요청해도 거부되며 공지는 바뀌지 않는다', async () => {
  const db = seed();
  const list = await call(noticeRoute, { method: 'GET' }, A, db);
  assert.deepEqual([list.code, list.body.length], [200, 1]);
  const item = await call(noticeRoute, { method: 'GET', query: { id: NOTICE } }, B, db);
  assert.deepEqual([item.code, item.body.title], [200, '반 공지']);
  const before = JSON.stringify(db.data.class_notices);
  for (const request of [
    { method: 'PUT', query: { id: NOTICE }, body: { title: '위조', body: '위조' } },
    { method: 'PUT', query: { id: NOTICE }, body: { title: '위조', role: 'instructor', isInstructor: true } },
    { method: 'PATCH', query: { id: NOTICE, role: 'instructor' }, headers: { 'x-role': 'instructor' }, body: { title: '위조' } },
    { method: 'DELETE', query: { id: NOTICE } },
    { method: 'POST', body: { title: '새 공지', role: 'instructor' } },
  ]) {
    const result = await call(noticeRoute, request, A, db);
    assert.equal(result.code, 403, `${request.method}`);
    assert.equal(result.body.reason, 'notice_write_not_allowed_here');
  }
  assert.equal(JSON.stringify(db.data.class_notices), before);
  assert.ok(warnings.some(line => /resource=instructor\.notice\.(list|item) action=PUT reason=notice_write_not_allowed_here/u.test(line)));
});

test('강사 관리 경로: 허용 목록이 비어 있으면 role을 위조해도 모두 거부되고 공지는 바뀌지 않는다', async () => {
  const db = seed();
  const before = JSON.stringify(db.data.class_notices);
  for (const request of [
    { method: 'PUT', query: { id: NOTICE }, body: { title: '위조', role: 'instructor' } },
    { method: 'PUT', query: { id: NOTICE, role: 'instructor' }, headers: { 'x-role': 'instructor', 'x-instructor': 'true' }, body: { title: '위조', instructor: true } },
    { method: 'POST', body: { title: '새 공지', role: 'instructor', isInstructor: true } },
  ]) {
    const result = await call(adminNoticeRoute, request, A, db);
    assert.equal(result.code, 403);
    assert.equal(result.body.reason, 'instructor_list_not_configured');
  }
  assert.equal(JSON.stringify(db.data.class_notices), before);
});

test('강사 관리 경로: 서버 허용 목록에 있는 검증된 학생 로그인만 수정·추가할 수 있다', async () => {
  const db = seed();
  process.env.INSTRUCTOR_USER_IDS = ` ${T.userId.toUpperCase()}, not-a-uuid, ${randomUUID()} `;
  assert.equal(instructorIds().size, 2); // 형식이 틀린 항목은 무시, 대소문자는 구별하지 않음
  // 허용 목록에 없는 학생은 role을 위조해도 거부된다.
  const student = await call(adminNoticeRoute, { method: 'PUT', query: { id: NOTICE }, body: { title: '위조', role: 'instructor' } }, A, db);
  assert.deepEqual([student.code, student.body.reason], [403, 'instructor_required']);
  // 같은 사용자 ID라도 심판 신원(kind judge)은 강사가 아니다.
  const judge = await call(adminNoticeRoute, { method: 'PUT', query: { id: NOTICE }, body: { title: '위조' } }, { ...J, userId: T.userId }, db);
  assert.equal(judge.code, 403);
  assert.equal(db.data.class_notices[0].title, '반 공지');
  // 허용 목록의 강사는 수정과 추가가 된다.
  const edit = await call(adminNoticeRoute, { method: 'PUT', query: { id: NOTICE }, body: { title: '수정된 공지', body: '새 본문' } }, T, db);
  assert.deepEqual([edit.code, edit.body.title], [200, '수정된 공지']);
  assert.equal(db.data.class_notices[0].updated_by, T.userId);
  const create = await call(adminNoticeRoute, { method: 'POST', body: { title: '새 공지', body: '내용' } }, T, db);
  assert.equal(create.code, 201);
  assert.equal(db.data.class_notices.length, 2);
  // 학생용 공지 경로로는 강사도 쓰기가 되지 않는다(관리 경로로만 가능).
  const viaStudentRoute = await call(noticeRoute, { method: 'PUT', query: { id: NOTICE }, body: { title: '다시' } }, T, db);
  assert.equal(viaStudentRoute.code, 403);
  // 입력 검사
  assert.equal((await call(adminNoticeRoute, { method: 'PUT', query: { id: 'export' }, body: { title: 'x' } }, T, db)).code, 404);
  assert.equal((await call(adminNoticeRoute, { method: 'PUT', query: { id: randomUUID() }, body: { title: 'x' } }, T, db)).code, 404);
  assert.equal((await call(adminNoticeRoute, { method: 'PUT', query: { id: NOTICE }, body: { title: '' } }, T, db)).code, 400);
  assert.equal((await call(adminNoticeRoute, { method: 'POST', body: { body: '제목 없음' } }, T, db)).code, 400);
});

test('isInstructor는 로그인 검증 결과와 서버 목록만 본다', () => {
  const ids = new Set([T.userId]);
  assert.equal(isInstructor(T, ids), true);
  assert.equal(isInstructor({ ...T, role: 'student' }, ids), true); // 객체에 붙은 role은 보지 않는다
  assert.equal(isInstructor({ kind: 'student', userId: A.userId, role: 'instructor' }, ids), false);
  assert.equal(isInstructor({ kind: 'judge', userId: T.userId }, ids), false);
  assert.equal(isInstructor(null, ids), false);
  assert.equal(isInstructor({ kind: 'student', userId: 7 }, ids), false);
  assert.equal(isInstructor(T, new Set()), false);
});

test('로그인 없는 직접 요청과 위조 토큰은 모든 공지·관리 경로에서 401이다', async () => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.co';
  process.env.SUPABASE_SECRET_KEY = ['sb', 'secret', 'LOCAL', 'TEST', 'ONLY', '000'].join('_');
  const handlers = [
    ['../api/notices.js', ['GET', 'POST', 'PUT', 'DELETE'], {}],
    ['../api/notices/[id].js', ['GET', 'PUT', 'PATCH', 'DELETE'], { id: NOTICE }],
    ['../api/admin/notices.js', ['POST'], {}],
    ['../api/admin/notices/[id].js', ['PUT'], { id: NOTICE }],
  ];
  const forged = `Bearer ${['aaa', 'bbb', 'ccc'].join('.')}`;
  for (const [file, methods, query] of handlers) {
    const { default: handler } = await import(file);
    for (const method of methods) {
      for (const headers of [{}, { authorization: forged, 'x-role': 'instructor' }]) {
        const result = await call((req, res) => handler(req, res), { method, query, headers, body: { title: 'x', role: 'instructor' }, url: '/api/x' }, null, null);
        assert.equal(result.code, 401, `${file} ${method}`);
        assert.equal(result.body.error, 'LOGIN_REQUIRED');
      }
    }
  }
});
