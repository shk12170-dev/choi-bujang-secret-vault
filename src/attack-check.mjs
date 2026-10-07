// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (config.step === 2) return runStep2Checks(config);
  if (config.step === 3) return runStep3Checks(config);
  if (config.step === 4) return runStep4Checks(config);
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

// 3단계: 로그인 없는 요청과 가짜 토큰이 서버에서 막히는지 직접 보낸 요청으로 점검합니다.
// 토큰·메모 본문은 기록하지 않고 상태 코드와 응답 형식만 남깁니다.
async function runStep3Checks(config) {
  const app = deployedApp(config);
  const send = (path, init = {}) => fetch(new URL(path, app), {
    redirect: 'error', signal: AbortSignal.timeout(10000), ...init,
  });
  const describe = async response => {
    const type = response.headers.get('content-type') ?? '';
    let hasMessage = false;
    let leaked = false;
    try {
      const data = await response.clone().json();
      hasMessage = typeof data?.error === 'string';
      leaked = Array.isArray(data) || Array.isArray(data?.notes);
    } catch {
      // JSON이 아닌 응답은 오류 문구가 없는 것으로 기록합니다.
    }
    return { status: response.status, json: type.includes('application/json'), hasMessage, leaked };
  };
  const rejected = d => (d.status === 401 || d.status === 403) && d.json && d.hasMessage && !d.leaked;
  const summary = d => `HTTP ${d.status}, ${d.json ? 'JSON' : 'JSON 아님'}, 오류 문구 ${d.hasMessage ? '있음' : '없음'}, 메모 ${d.leaked ? '노출됨' : '없음'}${rejected(d) ? ' (거부됨)' : ' (거부되지 않음)'}`;

  const list = await describe(await send('/api/notes'));
  const create = await describe(await send('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'check', body: 'check' }),
  }));
  // 서명이 없는 가짜 토큰을 실행할 때마다 만들어 보냅니다.
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const forged = `${part({ alg: 'ES256', typ: 'JWT' })}.${part({ sub: crypto.randomUUID(), role: 'authenticated' })}.${'A'.repeat(86)}`;
  const forgedList = await describe(await send('/api/notes', { headers: { Authorization: `Bearer ${forged}` } }));
  const staticData = await send('/data.json');
  let staticCount = null;
  if (staticData.ok) {
    try {
      const data = await staticData.json();
      staticCount = Array.isArray(data?.notes) ? data.notes.length : null;
    } catch {
      // 읽을 수 없는 응답은 건수를 알 수 없음으로 기록합니다.
    }
  }
  const aleph = await send('/aleph.json');
  const home = await send('/');
  const html = await home.text();
  const nosniff = home.headers.get('x-content-type-options')?.toLowerCase() === 'nosniff';
  const serverKeyInBrowser = /sb_secret_|service_role/u.test(html);

  return [
    { attackId: 'anonymous_list_read', expected: '로그인 없는 목록 요청이 401 또는 403과 JSON 오류 문구로 거부됨',
      observed: `비로그인 GET /api/notes ${summary(list)}` },
    { attackId: 'anonymous_note_create', expected: '인증 없는 메모 추가가 401 또는 403과 JSON 오류 문구로 거부됨',
      observed: `비로그인 POST /api/notes ${summary(create)}` },
    { attackId: 'forged_token_list_read', expected: '서명이 위조된 로그인 토큰이 401 또는 403과 JSON 오류 문구로 거부됨',
      observed: `위조 토큰 GET /api/notes ${summary(forgedList)}` },
    { attackId: 'anonymous_static_note_read', expected: '공개 정적 /data.json에서 메모 0건 또는 404',
      observed: `비로그인 /data.json HTTP ${staticData.status}, 메모 ${staticCount ?? '읽을 수 없음'}건` },
    { attackId: 'aleph_json_open', expected: '배포 주소의 /aleph.json이 열림',
      observed: `비로그인 /aleph.json HTTP ${aleph.status}` },
    { attackId: 'home_nosniff_header', expected: '첫 화면 응답에 X-Content-Type-Options: nosniff',
      observed: nosniff ? '첫 화면 응답에 nosniff 헤더 있음' : `첫 화면 응답에 nosniff 헤더 없음 (HTTP ${home.status})` },
    { attackId: 'browser_has_no_server_key', expected: '첫 화면 코드에 서버 전용 키가 없음',
      observed: serverKeyInBrowser ? '첫 화면 코드에서 서버 전용 키 이름이 발견됨' : '첫 화면 코드에 서버 전용 키 이름이 없음' },
  ];
}

// 4단계: 3단계 점검에 더해, 메모 번호만 알고 로그인 없이 읽기·수정·삭제를 시도합니다.
// 서로 다른 계정(A/B) 사이의 접근은 비밀번호가 필요해 여기서 보내지 않습니다(README의 직접 확인 절차 참고).
async function runStep4Checks(config) {
  const previous = await runStep3Checks(config);
  const app = deployedApp(config);
  // 실제로 있을 법한 형식의 임의 메모 번호를 실행할 때마다 새로 만듭니다.
  const id = crypto.randomUUID();
  const attempt = async (method, body) => {
    const response = await fetch(new URL(`/api/notes/${id}`, app), {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    let hasMessage = false;
    let leaked = false;
    try {
      const data = await response.clone().json();
      hasMessage = typeof data?.error === 'string';
      leaked = typeof data?.title === 'string' || typeof data?.body === 'string';
    } catch {
      // JSON이 아닌 응답은 오류 문구가 없는 것으로 기록합니다.
    }
    const type = response.headers.get('content-type') ?? '';
    const denied = (response.status === 401 || response.status === 403) && type.includes('application/json') && hasMessage && !leaked;
    return `HTTP ${response.status}, ${type.includes('application/json') ? 'JSON' : 'JSON 아님'}, 오류 문구 ${hasMessage ? '있음' : '없음'}, 메모 ${leaked ? '노출됨' : '없음'} (${denied ? '거부됨' : '거부되지 않음'})`;
  };
  return [
    ...previous,
    { attackId: 'anonymous_note_read_by_id', expected: '메모 번호만 아는 로그인 없는 조회가 401 또는 403과 JSON 오류 문구로 거부됨',
      observed: `비로그인 GET /api/notes/:id ${await attempt('GET')}` },
    { attackId: 'anonymous_note_update_by_id', expected: '메모 번호만 아는 로그인 없는 수정이 401 또는 403과 JSON 오류 문구로 거부됨',
      observed: `비로그인 PUT /api/notes/:id ${await attempt('PUT', { title: 'check', body: 'check' })}` },
    { attackId: 'anonymous_note_delete_by_id', expected: '메모 번호만 아는 로그인 없는 삭제가 401 또는 403과 JSON 오류 문구로 거부됨',
      observed: `비로그인 DELETE /api/notes/:id ${await attempt('DELETE')}` },
  ];
}
