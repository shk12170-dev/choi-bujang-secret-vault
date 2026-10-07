// 3단계: 서버가 요청 토큰을 직접 검사합니다. 브라우저가 보낸 userId·role은 믿지 않습니다.
// SUPABASE_SECRET_KEY는 서버 전용입니다. 응답·로그·브라우저 파일에 넣지 마세요.
// 로그인은 신원 확인일 뿐입니다. 로그인한 사람은 아직 모든 가상 메모를 읽습니다(4단계에서 소유자 검사).
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

const SAMPLE_MARKER = 'SAMPLE_NOTE_1';
let verifyLogin;

function loginVerifier(secretKey) {
  verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: secretKey });
  return verifyLogin;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('notes: missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });
  }

  let login;
  try {
    login = await loginVerifier(secretKey)(request.headers?.authorization);
  } catch {
    console.error('notes: login verifier unavailable');
    return response.status(500).json({ error: 'LOGIN_CHECK_UNAVAILABLE' });
  }
  if (!login) {
    // 토큰이 없거나, 위조·만료·다른 서비스용이면 자료 없이 거부합니다.
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'LOGIN_REQUIRED', message: '로그인한 사용자만 자료를 볼 수 있습니다.' });
  }

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase
    .from('notes')
    .select('title, content')
    .eq('sample_marker', SAMPLE_MARKER)
    .order('id', { ascending: true });

  if (error) {
    // 오류 코드만 남기고 키·요청 내용은 기록하지 않습니다.
    console.error('notes: query failed', error.code || 'unknown');
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
  return response.status(200).json({ sampleMarker: SAMPLE_MARKER, notes: data });
}
