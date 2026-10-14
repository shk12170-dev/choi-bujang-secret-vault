import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { RULE_IDS, classifyZone, decide } from '../src/decider.mjs';
import config from '../aleph.config.json' with { type: 'json' };

const { normal, suspicious } = fixtureRequests();
const UUID = randomUUID();

// 판정기 요청 하나를 만듭니다. route는 method와 path로 맞추며, 일부러 어긋나게 줄 때는 patch로 덮어씁니다.
function req({ service, method = 'GET', path, route, ...patch }) {
  const shape = route ?? `${method} ${path.replace(/\/[^/]+$/u, '/:id')}`;
  return { ...normal, requestId: randomUUID(), service, method, path, route: shape, queryLength: 0, ...patch };
}
const memoItem = (method = 'GET', id = UUID, prefix = '/api') => req({ service: 'notes', method, path: `${prefix}/notes/${id}`, route: `${method} ${prefix}/notes/:id` });
const memoList = (method = 'GET', prefix = '/api') => req({ service: 'notes', method, path: `${prefix}/notes`, route: `${method} ${prefix}/notes` });
const notice = (method = 'GET', id = null, prefix = '/api') => req({
  service: 'notices', method, path: id ? `${prefix}/notices/${id}` : `${prefix}/notices`, route: `${method} ${prefix}/notices${id ? '/:id' : ''}`,
});
const instructor = (method = 'GET', tail = 'materials/week1', prefix = '/api') => req({
  service: 'instructor', method, path: `${prefix}/instructor/${tail}`, route: `${method} ${prefix}/instructor/${tail}`,
});

function assertValid(request, response) {
  assert.equal(Object.keys(response).sort().join(','), 'decision,reasonCode,requestId,ruleIds,schema');
  assert.equal(response.requestId, request.requestId);
  assert.ok(['allow', 'deny', 'step_up'].includes(response.decision));
  assert.match(response.reasonCode, /^[a-z][a-z0-9_]{0,63}$/u);
  assert.ok(response.ruleIds.length > 0 && response.ruleIds.every(id => RULE_IDS.includes(id)));
}
const decision = async request => {
  const response = await decide(request);
  assertValid(request, response);
  return response;
};

test('자기 메모 읽기(ID 하나를 고르는 경로)는 허용된다 — /api 경로와 연습 요청 모양 모두', async () => {
  for (const request of [memoItem('GET'), memoItem('GET', 'demo', ''), { ...normal, requestId: randomUUID() }]) {
    const response = await decision(request);
    assert.equal(response.decision, 'allow');
    assert.deepEqual(response.ruleIds, ['zone_access']);
  }
});

test('메모 ID의 형식은 좁히지 않는다: UUID가 아닌 ID도 읽기는 허용된다', async () => {
  for (const id of ['demo', 'note-1', '12345', 'A_b-9', 'x'.repeat(60)]) {
    assert.equal((await decision(memoItem('GET', id))).decision, 'allow', id);
  }
});

test('ID 없는 메모 전체 목록 경로는 거부된다', async () => {
  for (const request of [memoList('GET'), memoList('GET', ''), memoList('POST'), memoList('DELETE')]) {
    const response = await decision(request);
    assert.equal(response.decision, 'deny', request.route);
    assert.deepEqual(response.ruleIds, ['zone_access']);
  }
  assert.equal(classifyZone(memoList('GET')).why, 'memo_list_denied');
});

test('메모의 쓰기는 판정기에서 거부된다(주인 비교 증거가 없어서, 주인 확인은 API가 한다)', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await decision(memoItem(method))).decision, 'deny', method);
  }
});

test('반 공지는 읽기(GET)만 허용되고 쓰기는 누구에게나 거부된다', async () => {
  assert.equal((await decision(notice('GET'))).decision, 'allow');
  assert.equal((await decision(notice('GET', 'week1'))).decision, 'allow');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const request of [notice(method), notice(method, 'week1')]) {
      const response = await decision(request);
      assert.equal(response.decision, 'deny', request.route);
      assert.equal(classifyZone(request).why, 'notice_write_denied');
    }
  }
  // 요청에 역할처럼 보이는 값을 붙여도 거부는 바뀌지 않는다(판정기는 역할을 읽지 않는다).
  const forged = { ...notice('PUT', 'week1'), role: 'instructor', instructor: true, identity: { role: 'instructor' } };
  assert.equal((await decision(forged)).decision, 'deny');
});

test('강사 자료는 판정기에서 모두 거부된다(읽기 포함)', async () => {
  for (const request of [
    instructor('GET'), instructor('GET', 'materials'), instructor('PUT'), instructor('POST', 'grades'),
    instructor('GET', 'materials/week1', ''), req({ service: 'instructor', path: '/api/instructor', route: 'GET /api/instructor' }),
  ]) {
    const response = await decision(request);
    assert.equal(response.decision, 'deny', request.route);
  }
});

test('알 수 없는 서비스·경로·동작은 거부된다', async () => {
  const unknown = [
    req({ service: 'admin', path: '/api/admin', route: 'GET /api/admin' }),
    req({ service: 'notes', path: '/api/other/123', route: 'GET /api/other/:id' }),
    req({ service: 'notes', path: '/', route: 'GET /' }),
    req({ service: 'notes', path: '/api', route: 'GET /api' }),
    req({ service: 'files', path: '/api/files/1', route: 'GET /api/files/:id' }),
    req({ service: 'notes', path: `/api/notes/${UUID}/comments`, route: 'GET /api/notes/:id/comments' }),
    memoItem('OPTIONS'), memoItem('HEAD'), memoItem('TRACE'), memoItem('get'),
  ];
  for (const request of unknown) assert.equal((await decision(request)).decision, 'deny', `${request.method} ${request.path}`);
});

test('route와 path가 다르거나 service가 경로와 다르면 거부된다', async () => {
  const mismatched = [
    req({ service: 'notes', path: `/api/notes/${UUID}`, route: 'GET /api/notices/:id' }), // route가 다른 자원
    req({ service: 'notes', path: `/api/notes/${UUID}`, route: 'GET /api/notes' }), // 한 건인데 목록 모양
    req({ service: 'notes', path: `/api/notes/${UUID}`, route: 'PUT /api/notes/:id' }), // 메서드가 다름
    req({ service: 'notes', path: `/api/notes/${UUID}`, route: 'GET /notes/:id' }), // 접두어가 다름
    { ...memoItem('GET'), route: undefined },
    { ...memoItem('GET'), service: 'notices' }, // service가 다른 자원
    { ...memoItem('GET'), service: 'instructor' },
    { ...memoItem('GET'), service: undefined },
    req({ service: 'notes', path: '/api/admin/all', route: 'GET /api/notes/:id' }), // 연습 요청처럼 route만 정상으로 꾸밈
  ];
  for (const request of mismatched) assert.equal((await decision(request)).decision, 'deny', `${request.service} ${request.path} ${request.route}`);
});

test('쿼리로 기능을 고를 수 없다: 쿼리 길이가 0이 아니거나 경로에 쿼리·인코딩이 섞이면 거부된다', async () => {
  for (const request of [
    { ...memoItem('GET'), queryLength: 12 },
    { ...memoItem('GET'), queryLength: 1 },
    { ...memoItem('GET'), queryLength: undefined },
    { ...memoItem('GET'), queryLength: '0' },
    req({ service: 'notes', path: `/api/notes/${UUID}?export=all`, route: 'GET /api/notes/:id' }),
    req({ service: 'notes', path: `/api/notes/${UUID}#x`, route: 'GET /api/notes/:id' }),
    req({ service: 'notes', path: '/api/notes/%65xport', route: 'GET /api/notes/:id' }),
    req({ service: 'notes', path: `/api/notes\\${UUID}`, route: 'GET /api/notes/:id' }),
  ]) assert.equal((await decision(request)).decision, 'deny', request.path);
});

test(':id 자리에는 기능 이름이 올 수 없다(export·all·admin 등)', async () => {
  for (const word of ['export', 'all', 'admin', 'list', 'search', 'bulk', 'my', 'me', 'EXPORT', 'Admin', 'import', 'backup']) {
    const response = await decision(memoItem('GET', word));
    assert.equal(response.decision, 'deny', word);
    assert.equal(classifyZone(memoItem('GET', word)).why, 'path_shape_unknown');
  }
  // 점 조각·중복 슬래시·끝 슬래시 우회도 거부
  for (const path of ['/api/notes/..', '/api/notes/.', '/api//notes/1', '/api/notes/1/', '/api/../api/notes/1', '/api/notes//1']) {
    assert.equal((await decision(req({ service: 'notes', path, route: 'GET /api/notes/:id' }))).decision, 'deny', path);
  }
});

test('이전 규칙은 유지된다: 미등록 기기는 먼저 device_not_registered, 복합 이상 사건은 step_up', async () => {
  const unregistered = await decision({ ...memoItem('GET'), deviceRegistered: false });
  assert.deepEqual([unregistered.decision, unregistered.reasonCode, unregistered.ruleIds], ['deny', 'device_not_registered', ['device_registered']]);
  // 미등록 기기의 공지 쓰기도 기기 규칙이 먼저 거부한다.
  const unregisteredWrite = await decision({ ...notice('PUT', 'week1'), deviceRegistered: false });
  assert.equal(unregisteredWrite.reasonCode, 'device_not_registered');
  // 복합 이상 사건은 구역 규칙을 통과한 읽기에서만 추가 확인이 된다.
  const complex = await decision({ ...suspicious, requestId: randomUUID() });
  assert.deepEqual([complex.decision, complex.reasonCode, complex.ruleIds], ['step_up', 'step_up_required', ['step_up_required']]);
  const complexOnList = await decision({ ...suspicious, requestId: randomUUID(), path: '/api/notes', route: 'GET /api/notes' });
  assert.equal(complexOnList.decision, 'deny'); // 거부할 요청은 추가 확인 이전에 거부된다
  const verified = await decision({ ...suspicious, requestId: randomUUID(), stepUp: { verified: true, authAgeSeconds: 60 } });
  assert.equal(verified.decision, 'allow');
});

test('판정기 응답은 항상 형식이 맞고 이상한 요청도 오류 없이 거부된다', async () => {
  for (const bad of [null, undefined, {}, 'x', 7, [], { deviceRegistered: true }, { deviceRegistered: true, method: 'GET', path: 7, route: {}, service: [] }]) {
    const response = await decide(bad);
    assert.equal(response.decision, 'deny');
    assert.ok(response.ruleIds.every(id => RULE_IDS.includes(id)));
  }
});

test('aleph.config.json의 allowedRoutes는 판정기가 읽기로 허용하는 경로만, 메서드를 붙여 적는다', async () => {
  const routes = config.allowedRoutes;
  assert.ok(routes.length >= 1);
  assert.deepEqual([...routes].sort(), ['GET /api/notes/:id', 'GET /api/notices', 'GET /api/notices/:id']);
  for (const route of routes) {
    assert.match(route, /^[A-Z]+ \/api\/[a-z]+(\/:id)?$/u);
    // 이 경로 모양으로 만든 요청은 실제로 판정기가 허용한다.
    const [method, shape] = route.split(' ');
    const path = shape.replace(':id', 'sample-1');
    const request = req({ service: shape.split('/')[2], method, path, route });
    assert.equal((await decision(request)).decision, 'allow', route);
  }
  // 반대로 허용하지 않는 경로(메모 목록, 쓰기)는 목록에 없다.
  for (const forbidden of ['GET /api/notes', 'POST /api/notes', 'PUT /api/notes/:id', 'DELETE /api/notes/:id', 'PUT /api/notices/:id']) {
    assert.ok(!routes.includes(forbidden), forbidden);
  }
});
