import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { RESOURCE_IDS, RESOURCE_KINDS, resolveResource, resourceOfRequest } from '../src/resources.mjs';

const id = randomUUID();

test('메모와 강사 공지는 서로 다른 자원 ID·구역을 가진다', () => {
  const memo = resolveResource('GET', '/api/notes');
  const notice = resolveResource('GET', '/api/notices');
  assert.equal(memo.resourceId, 'student.memo.list');
  assert.equal(notice.resourceId, 'instructor.notice.list');
  assert.notEqual(memo.resourceId, notice.resourceId);
  assert.notEqual(memo.zone, notice.zone);
  const memoItem = resolveResource('PUT', `/api/notes/${id}`);
  const noticeItem = resolveResource('PUT', `/api/notices/${id}`);
  assert.deepEqual([memoItem.resourceId, memoItem.action, memoItem.owner], ['student.memo.item', 'update', 'self']);
  assert.deepEqual([noticeItem.resourceId, noticeItem.action, noticeItem.owner], ['instructor.notice.item', 'update', 'instructor']);
  assert.equal(memoItem.itemId, id);
  assert.deepEqual([...RESOURCE_IDS].sort(), [
    'instructor.notice.admin.item', 'instructor.notice.admin.list', 'instructor.notice.item', 'instructor.notice.list',
    'student.memo.item', 'student.memo.list',
  ]);
  assert.deepEqual(Object.keys(RESOURCE_KINDS).sort(), ['instructor.notice', 'instructor.notice.admin', 'student.memo']);
  // 강사의 공지 수정은 학생용 공지 경로와 다른 갈래의 관리 경로이며, 수정(PUT)·추가(POST)만 인식한다.
  const adminEdit = resolveResource('PUT', `/api/admin/notices/${id}`);
  assert.deepEqual([adminEdit.resourceId, adminEdit.action, adminEdit.owner], ['instructor.notice.admin.item', 'update', 'instructor']);
  assert.equal(resolveResource('POST', '/api/admin/notices').resourceId, 'instructor.notice.admin.list');
  for (const [method, path] of [['GET', '/api/admin/notices'], ['DELETE', `/api/admin/notices/${id}`], ['GET', `/api/admin/notices/${id}`], ['PUT', '/api/admin/notices'], ['GET', '/api/admin']]) {
    assert.equal(resolveResource(method, path), null, `${method} ${path}`);
  }
  // :id와 같은 깊이에 기능 경로가 없다: 학생용 공지의 한 건 자리에 admin이 올 수 없다.
  assert.equal(resolveResource('GET', '/api/notices/admin'), null);
});

test('요청마다 동작이 정해진다(목록은 읽기·추가, 한 건은 읽기·수정·삭제)', () => {
  const expected = [
    ['GET', '/api/notes', 'read'], ['POST', '/api/notes', 'create'],
    ['GET', `/api/notes/${id}`, 'read'], ['PUT', `/api/notes/${id}`, 'update'], ['DELETE', `/api/notes/${id}`, 'delete'],
    ['GET', '/api/notices', 'read'], ['POST', '/api/notices', 'create'],
    ['GET', `/api/notices/${id}`, 'read'], ['PUT', `/api/notices/${id}`, 'update'], ['DELETE', `/api/notices/${id}`, 'delete'],
  ];
  for (const [method, path, action] of expected) assert.equal(resolveResource(method, path)?.action, action, `${method} ${path}`);
});

test('허용표에 없는 메서드·경로는 자원이 아니다(null)', () => {
  const bad = [
    ['PATCH', `/api/notes/${id}`], ['PUT', '/api/notes'], ['DELETE', '/api/notes'], ['POST', `/api/notes/${id}`],
    ['GET', '/api/admin'], ['GET', '/api/notes/export'], ['GET', '/api/notes/all'], ['GET', '/api/notices/admin'],
    ['GET', '/api/notes/123'], ['GET', `/api/notes/${id}/extra`], ['GET', '/api/my'], ['GET', '/notes/demo'],
    ['GET', '/'], ['GET', ''], ['GET', null], [null, '/api/notes'], [7, '/api/notes'],
  ];
  for (const [method, path] of bad) assert.equal(resolveResource(method, path), null, `${method} ${path}`);
});

test('경로 우회(쿼리·인코딩·점 조각·슬래시·대소문자)는 모호하다고 보고 자원으로 인정하지 않는다', () => {
  for (const path of [
    '/api/notes?scope=all', '/api/notes#x', '/api/notes/', '/api//notes', '/api/./notes', '/api/notes/../notices',
    `/api/notes/${id}/`, '/api/%6eotes', '/api/notes%2Fall', '/api\\notes', '/API/notes', '/api/Notes',
    '/api/notes\u0000', '/api/notes\n', `/api/notes/${id}‮`, `/api/notes/${'a'.repeat(300)}`,
  ]) assert.equal(resolveResource('GET', path), null, JSON.stringify(path));
});

test('요청 객체에서는 경로로만 자원을 정하고 쿼리가 있었다는 사실만 표시한다', () => {
  const withQuery = resourceOfRequest({ method: 'GET', url: `/api/notes/${id}?role=instructor&owner_id=x` });
  assert.equal(withQuery.resourceId, 'student.memo.item');
  assert.equal(withQuery.hasQuery, true);
  assert.equal(resourceOfRequest({ method: 'GET', url: '/api/notes' }).hasQuery, false);
  // 쿼리로 다른 자원을 고를 수 없다.
  assert.equal(resourceOfRequest({ method: 'GET', url: '/api/notes?path=/api/notices' }).resourceId, 'student.memo.list');
  assert.equal(resourceOfRequest({ method: 'GET', url: '/api/unknown?x=1' }), null);
  assert.equal(resourceOfRequest({ method: 'GET' }), null);
  assert.equal(resourceOfRequest(null), null);
});

test('API 공통 도우미가 요청마다 자원 ID를 머리글과 컨텍스트로 남긴다', async () => {
  process.env.SUPABASE_URL = 'https://example-project.supabase.co';
  process.env.SUPABASE_SECRET_KEY = ['sb', 'secret', 'LOCAL', 'TEST', 'ONLY', '000'].join('_');
  const { requireLogin } = await import('../src/memo-api.mjs');
  const headers = {};
  const response = {
    setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
    status: code => ({ json: body => ({ code, body }) }),
  };
  // 로그인이 없으면 401이고 자원 ID도 노출하지 않는다.
  const denied = await requireLogin({ method: 'GET', url: '/api/notes', headers: {} }, response, ['GET']);
  assert.equal(denied, null);
  assert.equal(headers['x-resource-id'], undefined);
});
