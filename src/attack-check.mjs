// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (config.step === 2) return runStep2Checks(config);
  if (config.step !== 1) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}

// 2단계: 메모를 공개 정적 파일에서 빼고 서버 API로 옮긴 뒤의 비로그인 점검.
// 메모 본문은 기록하지 않고 건수와 HTTP 상태만 남깁니다.
async function runStep2Checks(config) {
  const app = deployedApp(config);
  const get = path => fetch(new URL(path, app), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  const countNotes = async response => {
    if (!response.ok) return null;
    try {
      const data = await response.json();
      return Array.isArray(data?.notes) ? data.notes.length : null;
    } catch {
      return null;
    }
  };

  const staticData = await get('/data.json');
  const staticCount = await countNotes(staticData);
  const api = await get('/api/notes');
  const apiCount = await countNotes(api);
  const home = await get('/');
  const nosniff = home.headers.get('x-content-type-options')?.toLowerCase() === 'nosniff';

  return [
    { attackId: 'anonymous_static_note_read', expected: '공개 정적 /data.json에서 가상 메모 0건 또는 404',
      observed: `비로그인 /data.json HTTP ${staticData.status}, 메모 ${staticCount ?? '읽을 수 없음'}건` },
    { attackId: 'anonymous_api_note_read', expected: '3단계 전이라 /api/notes는 아직 비로그인으로 열림(남은 약점)',
      observed: `비로그인 /api/notes HTTP ${api.status}, 메모 ${apiCount ?? '읽을 수 없음'}건` },
    { attackId: 'home_nosniff_header', expected: '첫 화면 응답에 X-Content-Type-Options: nosniff',
      observed: nosniff ? '첫 화면 응답에 nosniff 헤더 있음' : `첫 화면 응답에 nosniff 헤더 없음 (HTTP ${home.status})` },
  ];
}

function deployedApp(config) {
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  return app;
}
