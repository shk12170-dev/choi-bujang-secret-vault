import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import { collectionRoute } from '../src/memo-routes.mjs';
import { contentHash, restoreRoute } from '../src/note-restore.mjs';

const A = { kind: 'student', userId: randomUUID() };
const B = { kind: 'judge', userId: randomUUID(), runId: randomUUID(), identity: 'b' };

// 표 이름별로 행을 두는 가상 DB(조회·추가·수정·삭제 방식만 흉내 냅니다).
function fakeDb(tables) {
  const data = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
  const from = name => {
    const rows = data[name];
    const state = { mode: 'select', filters: [], patch: null, row: null };
    const run = () => {
      if (state.mode === 'insert') {
        if (state.row.id !== undefined && rows.some(r => r.id === state.row.id)) return { error: { code: '23505' } };
        rows.push({ ...state.row });
        return { rows: [state.row] };
      }
      const found = rows.filter(r => state.filters.every(([k, v]) => r[k] === v));
      if (state.mode === 'update') found.forEach(r => Object.assign(r, state.patch));
      if (state.mode === 'delete') found.forEach(r => rows.splice(rows.indexOf(r), 1));
      return { rows: found };
    };
    const api = {
      select() { return api; },
      eq(k, v) { state.filters.push([k, v]); return api; },
      order() { return api; },
      insert(row) { state.mode = 'insert'; state.row = row; return api; },
      update(patch) { state.mode = 'update'; state.patch = patch; return api; },
      delete() { state.mode = 'delete'; return api; },
      maybeSingle: async () => { const r = run(); return r.error ? { data: null, error: r.error } : { data: r.rows[0] ?? null, error: null }; },
      single: async () => { const r = run(); return r.error ? { data: null, error: r.error } : { data: r.rows[0], error: null }; },
      then: resolve => { const r = run(); resolve(r.error ? { data: null, error: r.error } : { data: r.rows, error: null }); },
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
  Promise.resolve(route({ headers: {}, query: {}, method: 'POST', ...request }, response, { login, db })).catch(error => resolve({ code: 500, body: String(error) }));
});

const B_MEMO = randomUUID();
const B_OTHER = randomUUID();
const A_MEMO = randomUUID();
const ORIGINAL = { title: 'B의 가상 메모', body: '시험용 가상 본문' };
const copy = (id, owner, memo) => ({ id, owner_id: owner, ...memo, content_sha256: contentHash(memo) });
const seed = () => fakeDb({
  // 침해 뒤 상태: B의 메모는 변조, B의 다른 메모는 그대로, A의 메모도 그대로
  user_notes: [
    { id: B_MEMO, owner_id: B.userId, title: '변조됨', body: '해커가 바꾼 본문' },
    { id: B_OTHER, owner_id: B.userId, title: 'B의 다른 메모', body: '다른 본문' },
    { id: A_MEMO, owner_id: A.userId, title: 'A의 메모', body: 'A의 본문' },
  ],
  note_backups: [
    copy(B_MEMO, B.userId, ORIGINAL),
    copy(A_MEMO, A.userId, { title: 'A의 메모', body: 'A의 본문' }),
  ],
  note_restore_audit: [{ note_id: randomUUID(), owner_id: randomUUID(), content_sha256: 'x', action: 'updated', outcome: 'earlier' }],
});

const warnings = [];
const realWarn = console.warn;
const realError = console.error;
beforeEach(() => { warnings.length = 0; console.warn = (...a) => { warnings.push(a.join(' ')); }; console.error = () => {}; });
afterEach(() => { console.warn = realWarn; console.error = realError; });

const row = (db, id) => db.data.user_notes.find(r => r.id === id);

test('복구 대상 한 건의 ID·소유자·내용 해시가 사본과 같아진다', async () => {
  const db = seed();
  const result = await call(restoreRoute, { body: { id: B_MEMO } }, B, db);
  assert.equal(result.code, 200);
  assert.deepEqual(Object.keys(result.body).sort(), ['action', 'auditRecorded', 'contentSha256', 'id', 'restored']);
  assert.equal(result.body.action, 'updated');
  const restored = row(db, B_MEMO);
  const backup = db.data.note_backups.find(r => r.id === B_MEMO);
  assert.equal(restored.id, backup.id);
  assert.equal(restored.owner_id, backup.owner_id);
  assert.equal(contentHash(restored), backup.content_sha256);
  assert.equal(result.body.contentSha256, backup.content_sha256);
  // 응답에는 메모 본문이 없다.
  assert.ok(!JSON.stringify(result.body).includes(ORIGINAL.body));
});

test('다른 메모는 그대로이고 감사 기록은 보존되며 한 줄이 덧붙는다', async () => {
  const db = seed();
  const beforeOther = JSON.stringify([row(db, B_OTHER), row(db, A_MEMO)]);
  const earlierAudit = JSON.stringify(db.data.note_restore_audit[0]);
  await call(restoreRoute, { body: { id: B_MEMO } }, B, db);
  assert.equal(JSON.stringify([row(db, B_OTHER), row(db, A_MEMO)]), beforeOther);
  assert.equal(db.data.note_restore_audit.length, 2);
  assert.equal(JSON.stringify(db.data.note_restore_audit[0]), earlierAudit); // 기존 기록은 그대로
  const added = db.data.note_restore_audit[1];
  assert.deepEqual(Object.keys(added).sort(), ['action', 'content_sha256', 'note_id', 'outcome', 'owner_id']);
  assert.ok(!JSON.stringify(added).includes(ORIGINAL.body) && !JSON.stringify(added).includes(ORIGINAL.title));
  assert.equal(db.data.note_backups.length, 2); // 사본도 그대로
});

test('삭제된 메모는 사본의 ID·소유자·내용으로 다시 만든다', async () => {
  const db = seed();
  db.data.user_notes.splice(db.data.user_notes.findIndex(r => r.id === B_MEMO), 1);
  const result = await call(restoreRoute, { body: { id: B_MEMO } }, B, db);
  assert.equal(result.code, 200);
  assert.equal(result.body.action, 'recreated');
  const made = row(db, B_MEMO);
  assert.deepEqual([made.id, made.owner_id, made.title, made.body], [B_MEMO, B.userId, ORIGINAL.title, ORIGINAL.body]);
});

test('다른 사용자의 사본·없는 사본은 같은 404이고 아무것도 바뀌지 않는다', async () => {
  const db = seed();
  const before = JSON.stringify(db.data);
  const crossed = await call(restoreRoute, { body: { id: B_MEMO } }, A, db); // A가 B의 사본을 지정
  const missing = await call(restoreRoute, { body: { id: randomUUID() } }, B, db);
  assert.deepEqual([crossed.code, crossed.body], [404, { error: 'NOT_FOUND' }]);
  assert.deepEqual([missing.code, missing.body], [404, { error: 'NOT_FOUND' }]);
  assert.equal(JSON.stringify(db.data), before);
  assert.ok(warnings.some(line => line.includes('reason=not_owner')));
});

test('본문에 소유자·내용·다른 이름을 넣으면 거부하고 ID 형식도 검사한다', async () => {
  const db = seed();
  const before = JSON.stringify(db.data);
  for (const body of [
    { id: B_MEMO, owner_id: A.userId }, { id: B_MEMO, userId: A.userId }, { id: B_MEMO, title: '덮어쓰기' },
    { id: B_MEMO, ids: [B_OTHER] }, { id: [B_MEMO, B_OTHER] }, { id: 'not-a-uuid' }, {}, 'text',
  ]) {
    const result = await call(restoreRoute, { body }, B, db);
    assert.equal(result.code, 400, JSON.stringify(body));
  }
  assert.equal(JSON.stringify(db.data), before);
});

test('사본의 내용 해시가 맞지 않으면 복원하지 않는다', async () => {
  const db = seed();
  db.data.note_backups.find(r => r.id === B_MEMO).body = '사본이 손상됨';
  const before = JSON.stringify(row(db, B_MEMO));
  const result = await call(restoreRoute, { body: { id: B_MEMO } }, B, db);
  assert.deepEqual([result.code, result.body.error], [409, 'BACKUP_VERIFICATION_FAILED']);
  assert.equal(JSON.stringify(row(db, B_MEMO)), before);
  assert.equal(db.data.note_restore_audit.length, 1);
});

test('현재 메모의 소유자가 사본과 다르면 덮어쓰지 않는다', async () => {
  const db = seed();
  row(db, B_MEMO).owner_id = A.userId;
  const before = JSON.stringify(row(db, B_MEMO));
  const result = await call(restoreRoute, { body: { id: B_MEMO } }, B, db);
  assert.deepEqual([result.code, result.body.error], [409, 'OWNER_MISMATCH']);
  assert.equal(JSON.stringify(row(db, B_MEMO)), before);
});

test('해시 계산은 제목·본문의 경계를 구별한다', () => {
  assert.notEqual(contentHash({ title: 'ab', body: 'c' }), contentHash({ title: 'a', body: 'bc' }));
  assert.notEqual(contentHash({ title: 'a\n1', body: 'x' }), contentHash({ title: 'a', body: '1\nx' }));
  assert.match(contentHash({ title: '한글', body: '' }), /^[0-9a-f]{64}$/u);
});

test('복원 뒤에도 4단계 소유자 규칙이 그대로다: B의 복원된 메모는 A의 목록에 없고 A의 정상 요청은 유지된다', async () => {
  const db = seed();
  await call(restoreRoute, { body: { id: B_MEMO } }, B, db);
  const listA = await call(collectionRoute, { method: 'GET' }, A, db);
  assert.equal(listA.code, 200);
  assert.deepEqual(listA.body.map(item => item.id), [A_MEMO]);
});

test('경로 파일과 설정: POST만 받는 api/notes/restore.js, 코드에 삭제·감사 수정이 없다', async () => {
  const handler = await readFile(new URL('../api/notes/restore.js', import.meta.url), 'utf8');
  assert.match(handler, /requireLogin\(request, response, \['POST'\]\)/u);
  const source = await readFile(new URL('../src/note-restore.mjs', import.meta.url), 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\.delete\(\)/u);
  assert.doesNotMatch(code, /from\('note_restore_audit'\)\.(update|delete)/u);
  assert.doesNotMatch(code, /from\('note_backups'\)\.(insert|update|delete)/u);
});
