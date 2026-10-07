-- 3단계 제작 3: 로그인한 사용자가 추가·수정·삭제하는 가상 메모 테이블.
-- Supabase 대시보드 > SQL Editor에 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- 메모 본문은 학습용 가상 문장만 쓰세요. 실제 개인정보·비밀값은 넣지 마세요.

create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  -- 서버가 검증한 로그인 사용자 ID. 4단계 전까지 소유자 검사는 하지 않습니다.
  -- auth.users 외래키는 걸지 않습니다(심판 계정도 같은 칸을 씁니다).
  owner_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_notes_owner_created_idx on public.user_notes (owner_id, created_at);

-- RLS를 켜고 정책은 만들지 않습니다. anon·authenticated는 이 테이블을 직접 읽거나 쓸 수 없고,
-- 서버 함수만 서버 전용 키로 접근합니다.
alter table public.user_notes enable row level security;
revoke all on table public.user_notes from anon, authenticated;

-- 확인용: rls_enabled = true, 나머지 세 칸은 모두 false 여야 합니다.
select c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', 'public.user_notes', 'select') as anon_can_select,
       has_table_privilege('authenticated', 'public.user_notes', 'select') as authenticated_can_select,
       has_table_privilege('anon', 'public.user_notes', 'insert') as anon_can_insert
from pg_class c
where c.oid = 'public.user_notes'::regclass;
