// 2단계: 가상 메모를 Supabase notes 테이블에서 서버 쪽으로만 읽습니다.
// SUPABASE_SECRET_KEY는 서버 전용입니다. 응답·로그·브라우저 파일에 넣지 마세요.
// 아직 로그인 확인이 없어 이 주소는 누구나 부를 수 있습니다(3단계에서 막습니다).
import { createClient } from '@supabase/supabase-js';

const SAMPLE_MARKER = 'SAMPLE_NOTE_1';

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
