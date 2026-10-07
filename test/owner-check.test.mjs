import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectionRoute, memoRoute } from '../src/memo-routes.mjs';

const A = { kind: 'student', userId: '11111111-1111-4111-8111-111111111111' };
const B = { kind: 'student', userId: '22222222-2222-4222-8222-222222222222' };
const J = { kind: 'judge', userId: '33333333-3333-4333-8333-333333333333', runId: 'x', identity: 'a' };

// user_notes 테이블 대신 쓰는 메모리 DB. 서버 코드가 쓰는 조회·추가·수정·삭제 방식만 흉내 냅니다.
function fakeDb(seed) {
  const rows = seed.map(row => ({ ...row }));
  let counter = 100;
  const pick = (row, cols) => Object.fromEntries(cols.split(',').map(c => c.trim()).map(c => [c, row[c]]));
  const from = () => {
    const state = { mode: 'select', cols: '*', filters: [], patch: null, row: null };
    const match = () => rows.filter(r => state.filters.every(([k, v]) => r[k] === v));
    const run = (limit) => {
      if (state.mode === 'select') {
        const found = match();
        return { data: found.map(r => pick(r, state.cols)), error: null, found };
      }
      if (state.mode === 'update') {
        const found = match();
        found.forEach(r => Object.assign(r, state.patch));
        return { data: found.map(r => pick(r, state.cols)), error: null };
      }
      if (state.mode === 'delete') {
        const found = match();
        found.forEach(r => rows.splice(rows.indexOf(r), 1));
        return { data: found.map(r => pick(r, state.cols)), error: null };
      }
      const row = { id: state.row.id ?? `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, ...state.row };
      rows.push(row);
      return { data: [pick(row, state.cols)], error: null };
    };
    const api = {
      select(cols) { state.cols = cols; return api; },
      eq(k, v) { state.filters.push([k, v]); return api; },
      order() { return api; },
      insert(row) { state.mode = 'insert'; state.row = row; return api; },
      update(patch) { state.mode = 'update'; state.patch = patch; return api; },
      delete() { state.mode = 'delete'; return api; },
      maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
      single: async () => { const r = run(); return { data: r.data[0], error: null }; },
      then: (resolve) => resolve(run()),
    };
    return api;
  };
  return { from, rows };
}

const A_MEMO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_MEMO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const seed = () => [
  { id: A_MEMO, owner_id: A.userId, title: 'A의 메모', body: 'A 본문', created_at: 1 },
  { id: B_MEMO, owner_id: B.userId, title: 'B의 메모', body: 'B 본문', created_at: 2 },
];

async function call(route, request, login, db) {
  return new Promise(resolve => {
    const response = { setHeader() {}, status: code => ({ json: body => resolve({ status: code, body }) }) };
    route({ headers: {}, ...request }, response, { login, db });
  });
}
const one = (method, id, login, db, body) => call(memoRoute, { method, query: { id }, body }, login, db);

test('본인 메모는 읽고 고치고 지울 수 있다', async () => {
  const db = fakeDb(seed());
  assert.deepEqual((await one('GET', A_MEMO, A, db)).body, { id: A_MEMO, title: 'A의 메모', body: 'A 본문' });
  const put = await one('PUT', A_MEMO, A, db, { title: '새 제목', body: '새 본문' });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { id: A_MEMO, title: '새 제목', body: '새 본문' });
  assert.equal((await one('DELETE', A_MEMO, A, db)).status, 200);
  assert.equal((await one('GET', A_MEMO, A, db)).status, 404);
});

test('B는 A의 메모를 읽을 수 없다(없는 메모와 같은 404)', async () => {
  const db = fakeDb(seed());
  const stolen = await one('GET', A_MEMO, B, db);
  const missing = await one('GET', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', B, db);
  assert.equal(stolen.status, 404);
  assert.deepEqual(stolen.body, missing.body);
  assert.ok(!JSON.stringify(stolen.body).includes('A 본문'));
});

test('B는 A의 메모를 고치거나 지울 수 없고 메모는 그대로 남는다', async () => {
  const db = fakeDb(seed());
  assert.equal((await one('PUT', A_MEMO, B, db, { title: '탈취', body: '탈취' })).status, 404);
  assert.equal((await one('DELETE', A_MEMO, B, db)).status, 404);
  const row = db.rows.find(r => r.id === A_MEMO);
  assert.equal(row.title, 'A의 메모');
  assert.equal(row.owner_id, A.userId);
});

test('소유자를 바꾸려는 수정은 거부되고 owner_id는 그대로다', async () => {
  const db = fakeDb(seed());
  for (const key of ['owner_id', 'ownerId', 'userId']) {
    const attempt = await one('PUT', A_MEMO, A, db, { title: '제목', [key]: B.userId });
    assert.equal(attempt.status, 403, key);
  }
  assert.equal(db.rows.find(r => r.id === A_MEMO).owner_id, A.userId);
  // 본인 ID를 그대로 적은 것은 소유자 변경이 아니므로 무시하고 수정만 한다.
  assert.equal((await one('PUT', A_MEMO, A, db, { title: '제목', owner_id: A.userId })).status, 200);
});

test('심판 신원도 학생 메모를 읽거나 고치지 못한다', async () => {
  const db = fakeDb(seed());
  assert.equal((await one('GET', A_MEMO, J, db)).status, 404);
  assert.equal((await one('PUT', A_MEMO, J, db, { title: 'x' })).status, 404);
});

test('목록은 본인 메모만, 추가는 본문의 owner_id를 무시하고 확인된 ID로 저장한다', async () => {
  const db = fakeDb(seed());
  const mine = await call(collectionRoute, { method: 'GET' }, A, db);
  assert.deepEqual(mine.body.map(m => m.id), [A_MEMO]);
  const created = await call(collectionRoute, { method: 'POST', body: { title: '새 메모', body: '내용', owner_id: A.userId } }, B, db);
  assert.equal(created.status, 201);
  const row = db.rows.find(r => r.id === created.body.id);
  assert.equal(row.owner_id, B.userId);
  assert.deepEqual((await call(collectionRoute, { method: 'GET' }, B, db)).body.map(m => m.id).sort(), [B_MEMO, created.body.id].sort());
  assert.equal((await one('GET', created.body.id, A, db)).status, 404);
});
