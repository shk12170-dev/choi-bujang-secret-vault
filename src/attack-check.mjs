// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (config.step === 2) return runStep2Checks(config);
  if (config.step === 3) return runStep3Checks(config);
  if (config.step === 4) return runStep4Checks(config);
  if (config.step === 5) return runStep5Checks(config);
  if (config.step === 6) return runStep6Checks(config);
  if (config.step === 7) return runStep7Checks(config);
  if (config.step === 8) return runStep8Checks(config);
  if (config.step === 9) return runStep9Checks(config);
  if (config.step >= 12) return runStep12Checks(config);
  if (config.step >= 11) return runStep11Checks(config);
  if (config.step >= 10) return runStep10Checks(config);
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

// 5단계: 4단계 점검에 더해, 화면에 공개 키가 없는지, 원본 자료 경로를 키 없이 불러도 메모가 없는지,
// 서버 로그인 함수가 빈 요청을 거부하는지 직접 보낸 요청으로 점검합니다.
// 공개 키는 서버 환경변수에만 있어 이 점검에서는 쓰지 않으며, 공개 키(anon)로 직접 부르는 시험은 심판과 README의 수동 확인이 맡습니다.
async function runStep5Checks(config) {
  const previous = await runStep4Checks(config);
  const app = deployedApp(config);
  const html = await (await fetch(app, { redirect: 'error', signal: AbortSignal.timeout(10000) })).text();
  const keyInBrowser = /sb_publishable_|sb_secret_|service_role|supabase-js|createClient|supabase\.co/u.test(html);

  let originalStatus = 'URL 없음';
  let originalLeak = false;
  try {
    const original = new URL(config.originalApiUrl);
    if (original.protocol !== 'https:' || original.search || original.hash) throw new Error('invalid');
    const response = await fetch(original, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    originalStatus = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      originalLeak = (Array.isArray(data) && data.length > 0) || typeof data?.title === 'string';
    } catch {
      // JSON이 아니면 메모가 없는 것으로 봅니다.
    }
  } catch {
    originalStatus = 'originalApiUrl을 확인할 수 없음';
  }

  const emptyLogin = await fetch(new URL('/api/auth/login', app), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  let loginError = false;
  try {
    loginError = typeof (await emptyLogin.json())?.error === 'string';
  } catch {
    // JSON이 아닌 응답은 오류 문구가 없는 것으로 기록합니다.
  }
  let publishedRoutes = null;
  let publishedOriginal = '읽을 수 없음';
  try {
    const aleph = await (await fetch(new URL('/aleph.json', app), { redirect: 'error', signal: AbortSignal.timeout(10000) })).json();
    publishedRoutes = Array.isArray(aleph?.allowedRoutes) ? aleph.allowedRoutes.length : 0;
    publishedOriginal = typeof aleph?.originalApiUrl === 'string' && aleph.originalApiUrl.startsWith('https://')
      && aleph.originalApiUrl === config.originalApiUrl ? '있음(설정과 같은 HTTPS 주소)' : '없거나 설정과 다름';
  } catch {
    // 읽을 수 없으면 건수를 알 수 없음으로 기록합니다.
  }
  return [
    ...previous,
    { attackId: 'aleph_json_allowed_routes', expected: '/aleph.json의 allowedRoutes에 허용 경로가 하나 이상 적혀 있음',
      observed: `비로그인 /aleph.json의 allowedRoutes ${publishedRoutes ?? '읽을 수 없음'}개` },
    { attackId: 'aleph_json_original_api_url', expected: '/aleph.json에 https로 시작하는 originalApiUrl이 있음',
      observed: `비로그인 /aleph.json의 originalApiUrl ${publishedOriginal}` },
    { attackId: 'browser_has_no_supabase_key', expected: '첫 화면 코드에 Supabase 공개 키·주소·SDK가 없음',
      observed: keyInBrowser ? '첫 화면 코드에서 Supabase 키 또는 SDK 이름이 발견됨' : '첫 화면 코드에 Supabase 공개 키·주소·SDK 이름이 없음' },
    { attackId: 'original_api_keyless_read', expected: '원본 자료 경로를 키 없이 직접 불러도 메모가 없음',
      observed: `키 없는 직접 GET ${originalStatus}, 메모 ${originalLeak ? '노출됨' : '없음'}` },
    { attackId: 'auth_proxy_empty_login', expected: '서버 로그인 함수가 빈 요청을 4xx와 JSON 오류 문구로 거부함',
      observed: `빈 POST /api/auth/login HTTP ${emptyLogin.status}, 오류 문구 ${loginError ? '있음' : '없음'}` },
  ];
}

// 6단계: 5단계 점검에 더해, 판정기의 기기 등록 규칙을 가상 요청으로 직접 호출해 점검합니다.
// 이 부분은 배포 주소가 아니라 이 저장소의 src/decider.mjs를 부르는 로컬 연습이며 심판 판정이 아닙니다.
// 반 엔진이 실제 기기·인증서를 확인하는 경로와 미등록 기기 공격은 심판이 시험합니다.
async function runStep6Checks(config) {
  const previous = await runStep5Checks(config);
  const { randomUUID } = await import('node:crypto');
  const { fixtureRequests } = await import('../scripts/fixture-7.mjs');
  const { decide, RULE_IDS } = await import('./decider.mjs');
  const { normal } = fixtureRequests();
  const withoutDevice = (({ deviceRegistered: _removed, ...rest }) => ({ ...rest, requestId: randomUUID() }))(normal);

  const describe = async request => {
    const out = await decide(request);
    const shapeOk = out && typeof out === 'object' && out.schema === 'aleph.decision.v1' && out.requestId === request.requestId
      && Object.keys(out).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema'
      && Array.isArray(out.ruleIds) && out.ruleIds.length > 0 && out.ruleIds.every(id => RULE_IDS.includes(id));
    return `decision=${out?.decision} reasonCode=${out?.reasonCode} 규칙=${(out?.ruleIds ?? []).join(',')} (응답 형식 ${shapeOk ? '맞음' : '틀림'})`;
  };

  return [
    ...previous,
    { attackId: 'decider_registered_device_read', expected: '등록 기기의 정상 읽기 요청이 allow',
      observed: `로컬 가상 요청 deviceRegistered=true: ${await describe({ ...normal, requestId: randomUUID() })}` },
    { attackId: 'decider_unregistered_device', expected: '미등록 기기의 가상 요청이 deny와 이유 코드 device_not_registered',
      observed: `로컬 가상 요청 deviceRegistered=false: ${await describe({ ...normal, requestId: randomUUID(), deviceRegistered: false })}` },
    { attackId: 'decider_device_value_missing', expected: '기기 등록 값이 없는 요청이 deny와 이유 코드 device_not_registered',
      observed: `로컬 가상 요청 deviceRegistered 없음: ${await describe(withoutDevice)}` },
  ];
}

// 7단계: 6단계 점검에 더해, 판정기의 추가 확인 규칙을 가상 사건으로 직접 호출해 점검합니다(점검 상한 20개 안에서 2개).
// 이 부분도 배포 주소가 아니라 이 저장소의 src/decider.mjs를 부르는 로컬 연습이며 심판 판정이 아닙니다.
// 엔진이 새 로그인 시각을 검증해 실제 자료를 막는 경로는 이 저장소에서 시험하지 않아 미실행입니다.
async function runStep7Checks(config) {
  const previous = await runStep6Checks(config);
  const { randomUUID } = await import('node:crypto');
  const { fixtureRequests } = await import('../scripts/fixture-7.mjs');
  const { decide, RULE_IDS } = await import('./decider.mjs');
  const { normal, suspicious } = fixtureRequests();

  const describe = async request => {
    const out = await decide(request);
    const shapeOk = out && typeof out === 'object' && out.schema === 'aleph.decision.v1' && out.requestId === request.requestId
      && Object.keys(out).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema'
      && Array.isArray(out.ruleIds) && out.ruleIds.length > 0 && out.ruleIds.every(id => RULE_IDS.includes(id));
    return `decision=${out?.decision} reasonCode=${out?.reasonCode} (응답 형식 ${shapeOk ? '맞음' : '틀림'})`;
  };
  const fresh = patch => ({ ...suspicious, requestId: randomUUID(), ...patch });

  return [
    ...previous,
    { attackId: 'decider_step_up_complex_event', expected: '평소와 다른 시각·처음 보는 네트워크·읽기 급증이 겹친 가상 사건은 step_up, 다시 확인한 뒤에는 allow',
      observed: `복합 사건: ${await describe(fresh({}))} / 다시 확인(stepUp 검증됨): ${await describe(fresh({ stepUp: { verified: true, authAgeSeconds: 60 } }))}` },
    { attackId: 'decider_forged_or_region_only_not_blocked', expected: '지역만 다른 사건과 출처가 위조된 사건은 추가 확인·거부로 승격되지 않고 allow',
      observed: `지역만 다름: ${await describe(fresh({ signals: { source: 'judge_fixture', region: 'foreign', network: 'usual', hour: 14 }, recentEvents: [] }))} / 위조 출처(client_header): ${await describe(fresh({ signals: { source: 'client_header', region: 'foreign', network: 'unusual', hour: 3 } }))} / 정상 사건: ${await describe({ ...normal, requestId: randomUUID() })}` },
  ];
}

// 8단계: 7단계 점검을 이어받되 점검 상한(20개) 안에서 중복을 합치고, 구역 규칙(판정기 가상 요청)과
// 공지 쓰기·강사 관리 경로의 비로그인 직접 요청(배포 주소)을 더합니다.
// 판정기 부분은 이 저장소의 src/decider.mjs를 부르는 로컬 연습이며 심판 판정이 아닙니다.
// 로그인한 학생의 공지 수정 거부와 허용 목록에 있는 강사의 정상 수정은 로그인 정보가 필요해 이 점검에 넣지 못했고
// test/api-zones.test.mjs의 가상 사용자 시험으로만 확인했습니다(실제 접속은 미검증).
async function runStep8Checks(config) {
  const previous = await runStep7Checks(config);
  const { randomUUID } = await import('node:crypto');
  const { fixtureRequests } = await import('../scripts/fixture-7.mjs');
  const { decide, RULE_IDS } = await import('./decider.mjs');
  const app = deployedApp(config);
  const { normal } = fixtureRequests();

  // 이전 단계 점검 가운데 다른 점검이 같은 내용을 확인하는 것은 줄입니다(상한 20개).
  const dropped = new Set([
    'browser_has_no_server_key', // browser_has_no_supabase_key가 같은 화면 코드를 더 넓게 검사
    'anonymous_note_update_by_id', 'anonymous_note_delete_by_id', // anonymous_note_read_by_id와 같은 경로·거부 방식
    'decider_registered_device_read', 'decider_unregistered_device', 'decider_device_value_missing', // 아래 하나로 합침
  ]);
  const kept = previous.filter(item => !dropped.has(item.attackId));

  const judge = request => decide(request).then(out => {
    const shapeOk = out && out.schema === 'aleph.decision.v1' && out.requestId === request.requestId
      && Object.keys(out).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema'
      && Array.isArray(out.ruleIds) && out.ruleIds.length > 0 && out.ruleIds.every(id => RULE_IDS.includes(id));
    return `${out?.decision}${shapeOk ? '' : '(형식 틀림)'}`;
  });
  const req = (service, method, path, route, patch = {}) => ({
    ...normal, requestId: randomUUID(), service, method, path, route, queryLength: 0, ...patch,
  });
  const id = randomUUID();
  const memo = (method = 'GET') => req('notes', method, `/api/notes/${id}`, `${method} /api/notes/:id`);
  const noticeItem = method => req('notices', method, `/api/notices/${id}`, `${method} /api/notices/:id`);

  const httpProbe = async (method, path) => {
    const response = await fetch(new URL(path, app), {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', 'X-Role': 'instructor' },
      ...(method === 'GET' ? {} : { body: JSON.stringify({ title: 'check', role: 'instructor' }) }),
    });
    let hasMessage = false;
    let leaked = false;
    try {
      const data = await response.clone().json();
      hasMessage = typeof data?.error === 'string';
      leaked = typeof data?.title === 'string' || typeof data?.body === 'string' || Array.isArray(data);
    } catch {
      // JSON이 아닌 응답은 오류 문구가 없는 것으로 기록합니다.
    }
    const type = response.headers.get('content-type') ?? '';
    const denied = (response.status === 401 || response.status === 403) && type.includes('application/json') && hasMessage && !leaked;
    return `HTTP ${response.status}, ${type.includes('application/json') ? 'JSON' : 'JSON 아님'}, 오류 문구 ${hasMessage ? '있음' : '없음'}, 자료 ${leaked ? '노출됨' : '없음'} (${denied ? '거부됨' : '거부되지 않음'})`;
  };

  const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const noticeWrites = [];
  for (const method of writeMethods) noticeWrites.push(`${method} ${await judge(noticeItem(method))}`);

  return [
    ...kept,
    { attackId: 'decider_device_rules', expected: '등록 기기의 정상 읽기는 allow, 미등록 기기·기기 값 없음은 deny',
      observed: `로컬 가상 요청 등록 ${await judge(memo())} / 미등록 ${await judge({ ...memo(), deviceRegistered: false })} / 값 없음 ${await judge((({ deviceRegistered: _r, ...rest }) => ({ ...rest, requestId: randomUUID() }))(memo()))}` },
    { attackId: 'decider_zone_memo_item_read', expected: '자기 메모 한 건 읽기(ID 하나를 고르는 경로)는 allow, ID 형식은 좁히지 않음',
      observed: `로컬 가상 요청 /api/notes/:id ${await judge(memo())} / 연습 요청 모양 ${await judge({ ...normal, requestId: randomUUID() })} / UUID가 아닌 ID ${await judge(req('notes', 'GET', '/api/notes/note-1', 'GET /api/notes/:id'))}` },
    { attackId: 'decider_zone_memo_list_and_write', expected: 'ID 없는 메모 전체 목록과 메모 쓰기는 deny',
      observed: `로컬 가상 요청 목록 ${await judge(req('notes', 'GET', '/api/notes', 'GET /api/notes'))} / 한 건 수정 ${await judge(memo('PUT'))} / 기능 이름이 :id 자리 ${await judge(req('notes', 'GET', '/api/notes/export', 'GET /api/notes/:id'))}` },
    { attackId: 'decider_zone_notice_and_instructor', expected: '반 공지는 읽기만 allow, 쓰기는 누구에게나 deny, 강사 자료는 모두 deny',
      observed: `로컬 가상 요청 공지 읽기 ${await judge(noticeItem('GET'))} / 공지 쓰기 ${noticeWrites.join(', ')} / 강사 자료 ${await judge(req('instructor', 'GET', '/api/instructor/materials', 'GET /api/instructor/materials'))}` },
    { attackId: 'anonymous_notice_write_by_id', expected: '로그인 없는 공지 수정이 401 또는 403과 JSON 오류 문구로 거부됨(role 위조 포함)',
      observed: `비로그인 PUT /api/notices/:id ${await httpProbe('PUT', `/api/notices/${id}`)}` },
    { attackId: 'anonymous_admin_notice_write', expected: '로그인 없는 강사 관리 경로 수정이 401 또는 403과 JSON 오류 문구로 거부됨(role 위조 포함)',
      observed: `비로그인 PUT /api/admin/notices/:id ${await httpProbe('PUT', `/api/admin/notices/${id}`)}` },
  ];
}

// 9단계: 8단계 점검을 이어받되 점검 상한(20개) 안에서 겹치는 2개를 줄이고, 탐지 규칙의 가상 사건 점검 2개를 더합니다.
// 탐지 부분은 이 저장소의 src/detect.mjs를 부르는 로컬 연습이며 심판 판정이 아닙니다.
// 실제 회수와 회수까지 걸린 시간은 이 저장소에서 측정하지 않았고 심판이 가상 사건으로 확인합니다.
async function runStep9Checks(config) {
  const previous = await runStep8Checks(config);
  const { detect } = await import('./detect.mjs');
  const dropped = new Set([
    'aleph_json_open', // aleph_json_allowed_routes·aleph_json_original_api_url이 같은 /aleph.json을 읽어 확인
    'anonymous_note_create', // anonymous_notice_write_by_id·anonymous_admin_notice_write가 같은 방식의 쓰기 거부를 확인
  ]);
  const kept = previous.filter(item => !dropped.has(item.attackId));

  const start = Date.UTC(2026, 9, 1, 0, 0, 0);
  const reads = (count, extra = {}, { owner = 'learner_fixture', offsetMs = 0, intervalMs = 2000 } = {}) => Array.from({ length: count }, (_, index) => ({
    at: new Date(start + offsetMs + index * intervalMs).toISOString(), method: 'GET', identity: { sub: owner }, ...extra,
  }));
  const deviceA = 'a1b2c3d4e5f60718';
  const deviceB = 'f0e1d2c3b4a59687';
  const shape = result => (result.action === 'propose_revocation'
    ? `${result.action}(이유 ${result.reasonCode}, 사용자 있음, 기기 ${result.deviceId ? '한 개로 한정' : '한정 없음'})`
    : result.action);

  const complex = detect(reads(130, { deviceId: deviceA, network: 'unusual' }));
  const practiceShape = detect(reads(121));
  const mixed = detect([
    ...reads(40, { deviceId: deviceB, network: 'usual' }, { intervalMs: 10000 }),
    ...reads(130, { deviceId: deviceA, network: 'unusual' }, { offsetMs: 5000 }),
  ].sort((a, b) => a.at.localeCompare(b.at)));
  const normal = [
    ['평소 네트워크 200건', detect(reads(200, { deviceId: deviceA, network: 'usual' }))],
    ['처음 보는 네트워크 30건', detect(reads(30, { deviceId: deviceA, network: 'unusual' }))],
    ['정확히 120건', detect(reads(120, { deviceId: deviceA, network: 'unusual' }))],
    ['지역만 다름', detect(reads(30, { deviceId: deviceA, region: 'foreign' }))],
    ['기기 둘이 같은 건수', detect([...reads(70, { deviceId: deviceA, network: 'unusual' }), ...reads(70, { deviceId: deviceB, network: 'unusual' }, { offsetMs: 1000 })].sort((a, b) => a.at.localeCompare(b.at)))],
  ];
  return [
    ...kept,
    { attackId: 'detect_complex_burst_proposal', expected: '처음 보는 네트워크와 다량 조회가 함께 있는 가상 사건만 대상과 이유 코드가 있는 회수 제안, 기기는 한 개로 한정',
      observed: `로컬 가상 사건 복합 130건: ${shape(complex)} / 연습 계약 모양 121건: ${shape(practiceShape)} / 정상 기기가 섞인 사건: ${shape(mixed)}${mixed.deviceId === deviceA ? '(의심 기기만 지목)' : '(기기 지목 확인 필요)'}` },
    { attackId: 'detect_normal_events_kept', expected: '정상 사건(평소 네트워크의 다량 조회·적은 조회·정확히 120건·지역만 다름·기기를 정할 수 없음)은 회수 제안 없이 observe',
      observed: `로컬 가상 사건 ${normal.map(([name, result]) => `${name} ${shape(result)}`).join(' / ')}` },
  ];
}

// 10단계: 9단계 점검을 이어받되 상한(20개) 안에서 겹치는 2개를 줄이고, 복구 점검 2개를 더합니다.
//   정책 사본 점검은 이 저장소의 src/policy-restore.mjs를 부르는 로컬 시험이며, 메모 복원 경로 점검은 배포된 주소로 보낸
//   비로그인 요청 한 번입니다. 로그인한 계정의 실제 복원과 복구 뒤 1~9단계 재실행은 여기서 하지 않았고 미실행입니다.
async function runStep10Checks(config) {
  const previous = await runStep9Checks(config);
  const { previewRestore, createSnapshot } = await import('./policy-restore.mjs');
  const { readCurrentPolicy, readSnapshotFile } = await import('../scripts/policy-snapshot-lib.mjs');
  const dropped = new Set([
    'home_nosniff_header', // 첫 화면 헤더는 1단계 이후 바뀐 적 없고 aleph_json 점검이 같은 배포를 읽음
    'anonymous_note_read_by_id', // anonymous_list_read·forged_token_list_read가 같은 로그인 거부를 확인
  ]);
  const kept = previous.filter(item => !dropped.has(item.attackId));

  const current = await readCurrentPolicy();
  const snapshot = await readSnapshotFile();
  const shown = previewRestore(snapshot, current);
  const tampered = snapshot && typeof snapshot === 'object'
    ? previewRestore({ ...snapshot, policy: { ...snapshot.policy, ruleIds: [...(snapshot.policy?.ruleIds ?? []), 'x.allow_all'] } }, current)
    : null;
  const missing = previewRestore(null, current);
  const policyObserved = shown.ok
    ? `로컬 정책 사본 ${shown.version}(커밋 ${shown.commit.slice(0, 12)}): 변경 범위 ${shown.unchanged ? '없음' : `${shown.changes.length}곳`}, applied=${shown.applied} / 변조된 사본 ${tampered?.ok ? '통과됨(문제)' : `중단(${tampered?.reason})`} / 사본 없음 ${missing.ok ? '통과됨(문제)' : `중단(${missing.reason})`}`
    : `로컬 정책 사본을 검증하지 못함(${shown.reason})`;

  const app = config.publicAppUrl;
  let route = '미실행(publicAppUrl 없음)';
  if (typeof app === 'string' && app.startsWith('https://')) {
    const response = await fetch(new URL('/api/notes/restore', app), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID() }),
    });
    let hasMessage = false;
    try { hasMessage = typeof (await response.clone().json())?.error === 'string'; } catch { /* JSON이 아니면 문구 없음 */ }
    const type = response.headers.get('content-type') ?? '';
    const denied = (response.status === 401 || response.status === 403) && type.includes('application/json') && hasMessage;
    route = `비로그인 POST /api/notes/restore HTTP ${response.status}, ${type.includes('application/json') ? 'JSON' : 'JSON 아님'}, 오류 문구 ${hasMessage ? '있음' : '없음'} (${denied ? '거부됨' : '거부되지 않음'})`;
  }
  return [
    ...kept,
    { attackId: 'policy_snapshot_diff_preview', expected: '검증한 정책 사본이 있으면 복원할 버전과 변경 범위가 실행 전에 보이고, 사본이 없거나 변조되면 중단함',
      observed: policyObserved },
    { attackId: 'anonymous_note_restore', expected: '로그인 없는 메모 복원 요청이 401 또는 403과 JSON 오류 문구로 거부됨',
      observed: route },
  ];
}

// 11단계: 10단계 점검을 이어받되 상한(20개) 안에서 겹치는 3개를 줄이고, 기기 승인 점검 3개를 더합니다.
//   기기 관문 점검은 이 저장소의 src/device-approval.mjs를 가상 DB로 부르는 로컬 시험입니다.
//   배포 점검은 비로그인 요청과 공개 manifest 한 번씩입니다. 로그인한 계정의 실제 승인 흐름(요청→운영자 승인→자료 열림)은
//   여기서 하지 않았고 미실행입니다.
async function runStep11Checks(config) {
  const previous = await runStep10Checks(config);
  const { deviceGate, deviceKeyOf } = await import('./device-approval.mjs');
  const dropped = new Set([
    'anonymous_admin_notice_write', // anonymous_notice_write_by_id가 같은 비로그인 쓰기 거부를 확인
    'decider_zone_memo_item_read', // decider_device_rules가 같은 등록 기기의 메모 읽기 allow를 확인
    'policy_snapshot_diff_preview', // 10단계에서 확인했고 11단계에서 정책을 바꾸지 않음
  ]);
  const kept = previous.filter(item => !dropped.has(item.attackId));

  // 가상 DB: 승인 기록 한 줄(사용자 A, 기기 핸들 하나)만 둡니다.
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const cookie = { 'user-agent': 'AttackCheck/1.0 device-a' };
  const rows = [{ owner_id: owner, device_hash: deviceKeyOf(cookie), status: 'pending' }];
  const db = { from: () => {
    const filters = [];
    const api = {
      select() { return api; },
      eq(key, value) { filters.push([key, value]); return api; },
      maybeSingle: async () => ({ data: rows.find(row => filters.every(([key, value]) => row[key] === value)) ?? null, error: null }),
    };
    return api;
  } };
  const student = userId => ({ kind: 'student', userId });
  const describe = async (login, header) => {
    const gate = await deviceGate(db, login, header);
    return `${gate.status}=${gate.allowed ? '통과' : '차단'}`;
  };
  const beforeApproval = await describe(student(owner), cookie);
  const noCookie = await describe(student(owner), {});
  rows[0].status = 'denied';
  const denied = await describe(student(owner), cookie);
  rows[0].status = 'approved'; // 운영자가 DB에서 바꾼 것을 흉내 냅니다
  const approved = await describe(student(owner), cookie);
  const otherUser = await describe(student(other), cookie);
  const otherDevice = await describe(student(owner), { 'user-agent': 'AttackCheck/1.0 device-b' });
  const judgeIdentity = await describe({ kind: 'judge', userId: crypto.randomUUID(), runId: crypto.randomUUID(), identity: 'a' }, undefined);

  const app = config.publicAppUrl;
  const probe = async (method, path) => {
    const response = await fetch(new URL(path, app), {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }),
    });
    let hasMessage = false;
    try { hasMessage = typeof (await response.clone().json())?.error === 'string'; } catch { /* JSON이 아님 */ }
    const type = response.headers.get('content-type') ?? '';
    const denied401 = (response.status === 401 || response.status === 403) && type.includes('application/json') && hasMessage;
    return `HTTP ${response.status}, ${type.includes('application/json') ? 'JSON' : 'JSON 아님'}, 오류 문구 ${hasMessage ? '있음' : '없음'} (${denied401 ? '거부됨' : '거부되지 않음'})`;
  };
  let deviceProbe = '미실행(publicAppUrl 없음)';
  let manifestProbe = '미실행(publicAppUrl 없음)';
  if (typeof app === 'string' && app.startsWith('https://')) {
    deviceProbe = `비로그인 GET /api/device/status ${await probe('GET', '/api/device/status')} / 비로그인 POST /api/device/request ${await probe('POST', '/api/device/request')}`;
    const response = await fetch(new URL('/manifest.webmanifest', app), { redirect: 'error', signal: AbortSignal.timeout(10000) });
    let manifest = null;
    try { manifest = await response.json(); } catch { /* JSON이 아님 */ }
    const page = await (await fetch(app, { redirect: 'error', signal: AbortSignal.timeout(10000) })).text();
    manifestProbe = `HTTP ${response.status}, 이름 ${typeof manifest?.name === 'string' ? '있음' : '없음'}, display=${manifest?.display ?? '없음'}, 첫 화면 manifest 연결 ${page.includes('rel="manifest"') ? '있음' : '없음'}, 기기 승인 표시 ${page.includes('id="device-approval"') ? '있음' : '없음'}`;
  }
  return [
    ...kept,
    { attackId: 'device_gate_local', expected: '승인 전·거부·기기 구분 불가·다른 사용자·다른 기기는 자료 관문에서 차단되고 승인된 (사용자, 기기)만 통과하며 심판 시험 신원은 대상이 아님',
      observed: `로컬 가상 DB 대기 ${beforeApproval} / 기기 구분 불가 ${noCookie} / 거부 ${denied} / 승인 ${approved} / 다른 사용자 ${otherUser} / 다른 기기 ${otherDevice} / 심판 신원 ${judgeIdentity}` },
    { attackId: 'anonymous_device_endpoints', expected: '로그인 없는 기기 승인 상태·요청이 401 또는 403과 JSON 오류 문구로 거부됨',
      observed: deviceProbe },
    { attackId: 'public_manifest_and_status_panel', expected: '공개 manifest에 앱 이름·display가 있고 첫 화면이 이를 연결하며 기기 승인 표시를 가짐',
      observed: manifestProbe },
  ];
}

// 12단계: 11단계 점검을 이어받되 상한(20개) 안에서 겹치는 2개를 줄이고, 탈환 작전실 점검 2개를 더합니다.
//   작전실 요약 점검은 이 저장소의 src/ops-summary.mjs를 가상 DB로 실행하는 로컬 시험이며, 배포 점검은 비로그인 요청 한 번입니다.
//   로그인한 계정의 실제 작전실 화면과 1~11단계 전체 재실행(npm run ops:verify)은 여기서 하지 않았고 미실행입니다.
//   심판의 41종 공격 시험은 이 저장소가 실행하지 않았습니다.
async function runStep12Checks(config) {
  const previous = await runStep11Checks(config);
  const { buildOpsSummary } = await import('./ops-summary.mjs');
  const dropped = new Set([
    'aleph_json_allowed_routes', // aleph_json_original_api_url이 같은 /aleph.json을 읽어 확인
    'public_manifest_and_status_panel', // 11단계에서 확인했고 12단계에서 바뀌지 않음
  ]);
  const kept = previous.filter(item => !dropped.has(item.attackId));

  const owner = crypto.randomUUID();
  const db = { from: () => {
    const api = {
      select() { return api; },
      eq() { return api; },
      then: resolve => resolve({ data: [], error: null }),
    };
    return api;
  } };
  const summary = await buildOpsSummary({ login: { kind: 'student', userId: owner }, db });
  const probes = [...summary.decider.probes, ...summary.detection.probes];
  const matched = probes.filter(probe => probe.matches).length;
  const body = JSON.stringify(summary);
  const localObserved = `로컬 가상 DB 요약: 판정기·탐지 ${matched}/${probes.length} 일치, 회수 ${summary.revocation.source}, 41종 시험 ${summary.notRun.some(item => item.id === 'attack_41') ? '미실행 표시' : '표시 없음(문제)'}, 메모 본문·전체 식별자 ${/"title"|"body"/u.test(body) ? '포함됨(문제)' : '없음'}`;

  const app = config.publicAppUrl;
  let deployed = '미실행(publicAppUrl 없음)';
  if (typeof app === 'string' && app.startsWith('https://')) {
    const response = await fetch(new URL('/api/ops', app), { redirect: 'error', signal: AbortSignal.timeout(10000) });
    let hasMessage = false;
    try { hasMessage = typeof (await response.clone().json())?.error === 'string'; } catch { /* JSON이 아님 */ }
    const type = response.headers.get('content-type') ?? '';
    const denied = (response.status === 401 || response.status === 403) && type.includes('application/json') && hasMessage;
    deployed = `비로그인 GET /api/ops HTTP ${response.status}, ${type.includes('application/json') ? 'JSON' : 'JSON 아님'}, 오류 문구 ${hasMessage ? '있음' : '없음'} (${denied ? '거부됨' : '거부되지 않음'})`;
  }
  return [
    ...kept,
    { attackId: 'ops_summary_local', expected: '작전실 요약이 판정기·탐지를 실제로 실행한 결과를 담고 회수·41종 시험은 미실행으로 표시하며 메모 본문을 담지 않음',
      observed: localObserved },
    { attackId: 'anonymous_ops_summary', expected: '로그인 없는 작전실 요약 요청이 401 또는 403과 JSON 오류 문구로 거부됨',
      observed: deployed },
  ];
}
