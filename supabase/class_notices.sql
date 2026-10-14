-- 8단계 제작 3: 반 공지 테이블. 서버 함수만 서버 전용 키로 읽고 씁니다.
-- Supabase 대시보드 > SQL Editor에 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- 공지 본문은 학습용 가상 문장만 쓰세요. 실제 개인정보·비밀값은 넣지 마세요.
-- 이 테이블에는 소유자 칸이 없습니다. 강사 허용 목록(서버 환경변수)으로만 수정되고, 학생은 읽기만 합니다.

create table if not exists public.class_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 5000),
  -- 마지막으로 고친 강사의 사용자 ID(서버가 검증한 값). auth.users 외래키는 걸지 않습니다.
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists class_notices_updated_idx on public.class_notices (updated_at desc);

-- RLS를 켜고 정책은 만들지 않으며 anon·authenticated의 권한을 모두 거둡니다.
-- 브라우저 키로 직접 읽거나 쓸 수 없고, 서버 함수(service_role)만 접근합니다.
alter table public.class_notices enable row level security;
revoke all on table public.class_notices from public, anon, authenticated;

-- 확인용: rls_enabled = true, 나머지 세 칸은 모두 false 여야 합니다.
select c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', 'public.class_notices', 'select') as anon_can_select,
       has_table_privilege('authenticated', 'public.class_notices', 'select') as authenticated_can_select,
       has_table_privilege('anon', 'public.class_notices', 'insert') as anon_can_insert
from pg_class c
where c.oid = 'public.class_notices'::regclass;
