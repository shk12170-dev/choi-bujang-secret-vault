import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('manifest는 앱 이름·시작 주소·표시 방식·아이콘을 갖고 비밀값이나 외부 주소가 없다', async () => {
  const text = await read('public/manifest.webmanifest');
  const manifest = JSON.parse(text);
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length > 0 && manifest.name.length <= 45);
  assert.ok(manifest.short_name.length > 0 && manifest.short_name.length <= 12);
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/[A-Za-z0-9._-]+$/u);
    await access(new URL(`../public${icon.src}`, import.meta.url));
  }
  assert.doesNotMatch(text, /https?:|supabase|token|secret|key/iu);
});

test('설치 표시만으로 기기 확인이 끝났다고 쓰지 않는다', async () => {
  const manifest = await read('public/manifest.webmanifest');
  const html = await read('public/index.html');
  assert.match(manifest, /기기 승인을 뜻하지 않습니다/u);
  assert.match(html, /id="device-approval">확인 전</u);
  assert.match(html, /설치했거나 설치 화면으로 열었다는 표시만으로는 이 기기가 확인되었다고 볼 수 없습니다/u);
  // 설치 표시 값이 승인 상태 표시를 바꾸는 코드가 없다: 승인 표시는 서버 응답(deviceState)으로만 바뀐다.
  const shell = html.slice(html.lastIndexOf('<script>'));
  assert.doesNotMatch(shell, /device-approval|deviceState|renderDevice/u);
  assert.match(html, /deviceState = \['unrequested', 'pending', 'approved', 'denied'\]\.includes\(data\?\.status\) \? data\.status : 'error'/u);
});

test('화면은 manifest를 연결하고 오프라인 안내를 갖되 서비스 워커·기기 키·토큰 저장을 하지 않는다', async () => {
  const html = await read('public/index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/u);
  assert.match(html, /id="offline-notice"/u);
  assert.match(html, /오프라인에서 메모를 저장해 두지 않으므로/u);
  assert.doesNotMatch(html, /serviceWorker|caches\.|CacheStorage|indexedDB|localStorage/u);
  // 기존 세션 저장 방식(탭의 sessionStorage, 비밀번호 저장 없음)은 그대로다.
  assert.match(html, /sessionStorage\.setItem\(SESSION_KEY/u);
  assert.doesNotMatch(html, /sessionStorage\.setItem\([^)]*password/iu);
  // 11단계 코드가 새 저장 공간을 쓰지 않는다.
  const shell = html.slice(html.lastIndexOf('<script>'));
  assert.doesNotMatch(shell, /Storage|document\.cookie|fetch\(/u);
});

test('vercel.json은 manifest의 형식 헤더를 더하고 기존 nosniff 헤더를 유지한다', async () => {
  const config = JSON.parse(await read('vercel.json'));
  const all = config.headers.find(item => item.source === '/(.*)');
  assert.ok(all.headers.some(header => header.key === 'X-Content-Type-Options' && header.value === 'nosniff'));
  const manifest = config.headers.find(item => item.source === '/manifest.webmanifest');
  assert.ok(manifest.headers.some(header => header.key === 'Content-Type' && header.value === 'application/manifest+json'));
});

test('공개 자료에는 메모가 없고 화면 코드에 Supabase 키·주소가 없다', async () => {
  const data = JSON.parse(await read('public/data.json'));
  assert.deepEqual(data.notes, []);
  const html = await read('public/index.html');
  assert.doesNotMatch(html, /supabase\.co|@supabase|sb_publishable_|sb_secret_|createClient|eyJ[A-Za-z0-9_-]{15,}\./u);
});
