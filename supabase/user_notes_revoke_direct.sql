-- 5단계 제작 2: 브라우저가 가진 키(anon·로그인한 authenticated)로 자료 저장소를 직접 부르는 권한을 모두 회수합니다.
-- 대상은 public.user_notes 하나입니다. 다른 테이블은 건드리지 않습니다.
-- 적용 전에 user_notes_grants_check.sql을 한 번, 적용 뒤에 한 번 더 실행해 결과를 비교하세요.
-- 여러 번 실행해도 같은 결과가 됩니다.
--
-- 이 SQL이 바꾸지 않는 것:
--  * 서버 함수가 쓰는 service_role 권한(앱은 서버 전용 키로만 자료에 접근합니다).
--  * RLS 켜짐 상태와 4단계 정책(auth.uid() = owner_id). 권한이 없어 지금은 쓰이지 않지만,
--    나중에 실수로 권한이 다시 열려도 본인 행만 보이도록 안전장치로 남겨 둡니다.

begin;

revoke all on table public.user_notes from public, anon, authenticated;

-- RLS가 켜져 있는지 다시 보장합니다(이미 켜져 있으면 변화 없음).
alter table public.user_notes enable row level security;

commit;

-- 확인용(적용 뒤): rls_enabled = true, 정책 네 개는 그대로, 아래 세 칸은 모두 false 여야 합니다.
-- 역할별 전체 권한 대조는 user_notes_grants_check.sql을 다시 실행하세요.
select c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'user_notes') as policy_count,
       has_table_privilege('anon', 'public.user_notes', 'select') as anon_can_select,
       has_table_privilege('authenticated', 'public.user_notes', 'select') as authenticated_can_select,
       has_table_privilege('authenticated', 'public.user_notes', 'insert') as authenticated_can_insert,
       has_table_privilege('service_role', 'public.user_notes', 'select') as service_role_can_select
from pg_class c
where c.oid = 'public.user_notes'::regclass;
