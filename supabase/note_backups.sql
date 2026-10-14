-- 10단계 제작 3: 비공개 가상 메모 사본과 복원 감사 기록. 서버 함수(service_role)만 읽고 씁니다.
-- Supabase 대시보드 > SQL Editor에 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- 가상 메모만 사본으로 두세요. 실제 개인정보·비밀값은 넣지 마세요.

create table if not exists public.note_backups (
  id uuid primary key,                       -- 원본 메모의 ID
  owner_id uuid not null,                    -- 원본 메모의 소유자
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 5000),
  -- 제목의 UTF-8 바이트 수 + ':' + 제목 + 줄바꿈 + 본문의 SHA-256(src/note-restore.mjs의 contentHash와 같음)
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  backed_up_at timestamptz not null default now()
);

create table if not exists public.note_restore_audit (
  seq bigint generated always as identity primary key,
  note_id uuid not null,
  owner_id uuid not null,
  content_sha256 text not null,
  action text not null check (action in ('updated', 'recreated')),
  outcome text not null,
  restored_at timestamptz not null default now()
);

-- 감사 기록은 덧붙이기만 합니다. 고치거나 지우려는 시도는 서버 키로도 막습니다.
create or replace function public.note_restore_audit_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'note_restore_audit is append-only';
end;
$$;
drop trigger if exists note_restore_audit_no_change on public.note_restore_audit;
create trigger note_restore_audit_no_change
  before update or delete on public.note_restore_audit
  for each row execute function public.note_restore_audit_append_only();

-- RLS를 켜고 정책은 만들지 않으며 anon·authenticated의 권한을 모두 거둡니다.
alter table public.note_backups enable row level security;
alter table public.note_restore_audit enable row level security;
revoke all on table public.note_backups from public, anon, authenticated;
revoke all on table public.note_restore_audit from public, anon, authenticated;

-- 사본 만들기(침해 전, 메모가 올바른 상태일 때 한 번): 시험 계정 B의 메모만 사본으로 둡니다.
-- 아래 '<B의 사용자 ID>'를 시험 계정 B의 UUID로 바꿔 직접 실행하세요(주석을 풀고). 이 파일에는 값을 적지 않습니다.
-- insert into public.note_backups (id, owner_id, title, body, content_sha256)
-- select id, owner_id, title, body,
--        encode(sha256(convert_to(octet_length(convert_to(title, 'UTF8'))::text || ':' || title || E'\n' || body, 'UTF8')), 'hex')
-- from public.user_notes
-- where owner_id = '<B의 사용자 ID>'::uuid
-- on conflict (id) do nothing;

-- 확인용: rls_enabled = true, 나머지는 모두 false 여야 합니다.
select c.relname,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'select') as anon_can_select,
       has_table_privilege('authenticated', c.oid, 'select') as authenticated_can_select
from pg_class c
where c.oid in ('public.note_backups'::regclass, 'public.note_restore_audit'::regclass);
