import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import { DEVICE_COOKIE, cookieFor, deviceGate, deviceRoute, deviceStatus, hashHandle, newHandle, readHandle } from '../src/device-approval.mjs';

const S1 = { kind: 'student', userId: randomUUID() };
const S2 = { kind: 'student', userId: randomUUID() };
const JUDGE = { kind: 'judge', userId: randomUUID(), runId: randomUUID(), identity: 'a' };

// 표 이름별로 행을 두는 가상 DB. (owner_id, device_hash)가 같으면 중복 오류(23505)를 냅니다.
function fakeDb(rows = []) {
  const data = { device_approvals: rows.map(row => ({ ...row })) };
  const from = name => {
    const table = data[name];
    const state = { mode: 'select', filters: [], row: null };
    const run = () => {
      if (state.mode === 'insert') {
        if (table.some(r => r.owner_id === state.row.owner_id && r.device_hash === state.row.device_hash)) return { error: { code: '23505' } };
        const row = { id: randomUUID(), ...state.row };
        table.push(row);
        return { rows: [row] };
      }
      return { rows: table.filter(r => state.filters.every(([k, v]) => r[k] === v)) };
    };
    const api = {
      select() { return api; },
      eq(k, v) { state.filters.push([k, v]); return api; },
      insert(row) { state.mode = 'insert'; state.row = row; return api; },
      maybeSingle: async () => { const r = run(); return r.error ? { data: null, error: r.error } : { data: r.rows[0] ?? null, error: null }; },
      single: async () => { const r = run(); return r.error ? { data: null, error: r.error } : { data: r.rows[0], error: null }; },
      then: resolve => { const r = run(); resolve(r.error ? { data: null, error: r.error } : { data: r.rows, error: null }); },
    };
    return api;
  };
  return { from, data };
}

const call = (request, login, db) => new Promise(resolve => {
  const headers = {};
  const response = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    status: code => ({ json: body => resolve({ code, body, headers }) }),
  };
  Promise.resolve(deviceRoute({ headers: {}, query: {}, ...request }, response, { login, db })).catch(error => resolve({ code: 500, body: String(error), headers }));
});

const realWarn = console.warn;
const realError = console.error;
beforeEach(() => { console.warn = () => {}; console.error = () => {}; });
afterEach(() => { console.warn = realWarn; console.error = realError; });

const cookieOf = result => /bb_device=([^;]+)/u.exec(result.headers['set-cookie'])[1];

test('승인 요청은 대기 기록만 만들고 기기 핸들은 쿠키로만 보내며 응답 본문과 DB에 원문이 없다', async () => {
  const db = fakeDb();
  const result = await call({ method: 'POST', query: { action: 'request' }, body: { status: 'approved', owner_id: S2.userId } }, S1, db);
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, { status: 'pending' });
  // 본문의 status·owner_id는 읽지 않는다.
  assert.equal(db.data.device_approvals.length, 1);
  const row = db.data.device_approvals[0];
  assert.equal(row.owner_id, S1.userId);
  assert.equal(row.status, 'pending');
  // 쿠키: HttpOnly·Secure·SameSite=Strict, 핸들 원문은 응답 본문·DB 어디에도 없다.
  const setCookie = result.headers['set-cookie'];
  assert.match(setCookie, /^bb_device=[A-Za-z0-9_-]{43};/u);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api']) assert.ok(setCookie.includes(attribute), attribute);
  const handle = cookieOf(result);
  assert.equal(row.device_hash, hashHandle(handle));
  assert.ok(!JSON.stringify(result.body).includes(handle));
  assert.ok(!JSON.stringify(db.data).includes(handle));
});

test('요청만으로는 승인되지 않고, 같은 기기가 다시 요청해도 상태가 바뀌거나 새 기록이 생기지 않는다', async () => {
  const db = fakeDb();
  const first = await call({ method: 'POST', query: { action: 'request' } }, S1, db);
  const cookie = `${DEVICE_COOKIE}=${cookieOf(first)}`;
  const again = await call({ method: 'POST', query: { action: 'request' }, headers: { cookie } }, S1, db);
  assert.deepEqual(again.body, { status: 'pending' });
  assert.equal(again.headers['set-cookie'], undefined); // 이미 있는 기기에는 쿠키를 다시 만들지 않는다
  assert.equal(db.data.device_approvals.length, 1);
  const status = await call({ method: 'GET', query: { action: 'status' }, headers: { cookie } }, S1, db);
  assert.deepEqual(status.body, { status: 'pending' });
  // 거부된 기록은 요청이 덮어쓰지 못한다.
  db.data.device_approvals[0].status = 'denied';
  const denied = await call({ method: 'POST', query: { action: 'request' }, headers: { cookie } }, S1, db);
  assert.deepEqual(denied.body, { status: 'denied' });
  assert.equal(db.data.device_approvals[0].status, 'denied');
});

test('승인은 (사용자, 기기) 쌍에만 묶인다: 운영자가 승인한 기록만 관문을 통과한다', async () => {
  const db = fakeDb();
  const handle = newHandle();
  const cookie = `${DEVICE_COOKIE}=${handle}`;
  db.data.device_approvals.push({ id: randomUUID(), owner_id: S1.userId, device_hash: hashHandle(handle), status: 'pending' });
  assert.deepEqual(await deviceGate(db, S1, cookie), { allowed: false, status: 'pending' });
  db.data.device_approvals[0].status = 'approved'; // 운영자가 DB에서 바꾼 것
  assert.deepEqual(await deviceGate(db, S1, cookie), { allowed: true, status: 'approved' });
  // 같은 쿠키라도 다른 사용자는 통과하지 못한다.
  assert.deepEqual(await deviceGate(db, S2, cookie), { allowed: false, status: 'unrequested' });
  // 쿠키가 없거나 형식이 틀리면 요청 전으로 본다.
  assert.deepEqual(await deviceGate(db, S1, undefined), { allowed: false, status: 'unrequested' });
  assert.deepEqual(await deviceGate(db, S1, `${DEVICE_COOKIE}=short`), { allowed: false, status: 'unrequested' });
  assert.deepEqual(await deviceGate(db, S1, `${DEVICE_COOKIE}=${newHandle()}`), { allowed: false, status: 'unrequested' });
});

test('거부된 기기와 알 수 없는 상태 값은 통과하지 못한다', async () => {
  const db = fakeDb();
  const handle = newHandle();
  const cookie = `${DEVICE_COOKIE}=${handle}`;
  db.data.device_approvals.push({ id: randomUUID(), owner_id: S1.userId, device_hash: hashHandle(handle), status: 'denied' });
  assert.equal((await deviceGate(db, S1, cookie)).allowed, false);
  db.data.device_approvals[0].status = 'APPROVED'; // 형식이 다른 값은 승인으로 읽지 않는다
  assert.deepEqual(await deviceGate(db, S1, cookie), { allowed: false, status: 'denied' });
});

test('DB 오류는 열어 주지 않는다(확인하지 못함)', async () => {
  const failing = { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: { code: 'x' } }) }) };
  assert.deepEqual(await deviceGate(failing, S1, `${DEVICE_COOKIE}=${newHandle()}`), { allowed: false, status: 'error' });
  assert.equal(await deviceStatus(failing, S1.userId, newHandle()), 'error');
});

test('심판 시험 신원은 기기 관문의 대상이 아니고 승인 요청은 학생만 할 수 있다', async () => {
  const db = fakeDb();
  assert.deepEqual(await deviceGate(db, JUDGE, undefined), { allowed: true, status: 'not_applicable' });
  const request = await call({ method: 'POST', query: { action: 'request' } }, JUDGE, db);
  assert.deepEqual([request.code, request.body.error], [403, 'STUDENT_ONLY']);
  assert.equal(db.data.device_approvals.length, 0);
  const status = await call({ method: 'GET', query: { action: 'status' } }, JUDGE, db);
  assert.deepEqual(status.body, { status: 'not_applicable' });
});

test('대기 요청은 사용자당 5건까지만 만든다', async () => {
  const db = fakeDb();
  for (let i = 0; i < 5; i += 1) {
    const result = await call({ method: 'POST', query: { action: 'request' } }, S1, db); // 쿠키 없이 새 기기로 반복
    assert.equal(result.code, 200);
  }
  const sixth = await call({ method: 'POST', query: { action: 'request' } }, S1, db);
  assert.deepEqual([sixth.code, sixth.body.error], [429, 'TOO_MANY_PENDING_REQUESTS']);
  assert.equal(db.data.device_approvals.length, 5);
  // 다른 사용자의 요청은 영향이 없다.
  assert.equal((await call({ method: 'POST', query: { action: 'request' } }, S2, db)).code, 200);
});

test('메서드·동작이 맞지 않으면 거부한다', async () => {
  const db = fakeDb();
  assert.equal((await call({ method: 'GET', query: { action: 'request' } }, S1, db)).code, 405);
  assert.equal((await call({ method: 'POST', query: { action: 'status' } }, S1, db)).code, 405);
  assert.equal((await call({ method: 'POST', query: { action: 'approve' } }, S1, db)).code, 404);
  assert.equal(db.data.device_approvals.length, 0);
});

test('쿠키 읽기는 형식이 맞는 핸들만 받는다', () => {
  const handle = newHandle();
  assert.equal(readHandle(`a=1; ${DEVICE_COOKIE}=${handle}; b=2`), handle);
  assert.equal(readHandle(`${DEVICE_COOKIE}=${handle}x`), null);
  assert.equal(readHandle(`${DEVICE_COOKIE}=`), null);
  assert.equal(readHandle('x'.repeat(5000)), null);
  assert.match(cookieFor(handle), /HttpOnly/u);
});

test('앱의 어떤 코드도 상태를 approved로 쓰지 않고, 보호 자료 경로는 모두 관문을 지난다', async () => {
  const source = await readFile(new URL('../src/device-approval.mjs', import.meta.url), 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  // 표에 쓰는 동작은 insert(대기 기록) 하나뿐이다. (createHash의 .update는 DB 쓰기가 아니다.)
  assert.doesNotMatch(code, /status:\s*'approved'|\.from\([^)]*\)\s*\.(update|upsert|delete)\(/u);
  assert.doesNotMatch(code, /\.(upsert|delete)\(/u);
  assert.equal([...code.matchAll(/\.insert\(/gu)].length, 1);
  const api = await readFile(new URL('../src/memo-api.mjs', import.meta.url), 'utf8');
  assert.match(api, /deviceGate\(database, login, request\.headers\?\.cookie\)/u);
  // 관문을 끄는 경로(deviceGate: false)는 기기 승인 요청 경로 하나뿐이다.
  const offenders = [];
  const walk = async dir => {
    for (const entry of await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if ((await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).includes('deviceGate: false')) offenders.push(path);
    }
  };
  await walk('api');
  assert.deepEqual(offenders, ['api/device/[action].js']);
});

test('화면은 승인 전에 자료를 부르지 않고 기기 키·토큰을 브라우저 저장소에 넣지 않는다', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /if \(deviceState !== 'approved'\) return showMessage\('이 기기가 승인되기 전에는 자료를 표시하지 않습니다\.'\)/u);
  assert.match(html, /editor\.hidden = !\(signedIn && deviceState === 'approved'\)/u);
  assert.doesNotMatch(html, /bb_device|localStorage|indexedDB|document\.cookie/u);
  // 승인 요청 버튼은 요청만 보내고 승인 상태를 직접 바꾸지 않는다.
  const click = html.slice(html.indexOf("$('device-request').addEventListener"), html.indexOf("$('device-refresh').addEventListener"));
  assert.doesNotMatch(click, /deviceState\s*=/u);
  assert.match(click, /await refreshDevice\(\)/u);
});
