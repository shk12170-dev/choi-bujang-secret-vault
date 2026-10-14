-- 11단계 제작 2: 기기 승인 기록. 서버 함수(service_role)만 읽고 씁니다.
-- Supabase 대시보드 > SQL Editor에 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- 실제 기기 이름·개인정보는 넣지 마세요. 기기는 서버가 만든 무작위 핸들의 해시로만 구별합니다.

create table if not exists public.device_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,                       -- 승인을 요청한 로그인 사용자(서버가 검증한 값)
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),  -- 기기 핸들의 SHA-256
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (owner_id, device_hash)
);

create index if not exists device_approvals_owner_idx on public.device_approvals (owner_id, status);

-- RLS를 켜고 정책은 만들지 않으며 anon·authenticated의 권한을 모두 거둡니다.
-- 브라우저 키로 읽거나 쓸 수 없고, 앱의 어떤 경로도 status를 approved로 바꾸지 않습니다.
alter table public.device_approvals enable row level security;
revoke all on table public.device_approvals from public, anon, authenticated;

-- 확인용: rls_enabled = true, 나머지 두 칸은 false 여야 합니다.
select c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', 'public.device_approvals', 'select') as anon_can_select,
       has_table_privilege('authenticated', 'public.device_approvals', 'insert') as authenticated_can_insert
from pg_class c
where c.oid = 'public.device_approvals'::regclass;

-- ── 운영자가 직접 하는 일(이 파일에서 주석을 풀어 실행) ──
-- 대기 중인 요청 보기(요청한 이메일과 요청 시각만 봅니다):
-- select d.id, u.email, d.status, d.requested_at
-- from public.device_approvals d join auth.users u on u.id = d.owner_id
-- order by d.requested_at desc;
--
-- 확인한 기기 한 건 승인(위 목록의 id를 넣습니다):
-- update public.device_approvals set status = 'approved', decided_at = now() where id = '<요청 id>'::uuid;
--
-- 승인 취소·거부:
-- update public.device_approvals set status = 'denied', decided_at = now() where id = '<요청 id>'::uuid;
