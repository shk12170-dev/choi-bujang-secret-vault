-- 4단계 제작 3: user_notes에 RLS와 최소 권한을 적용합니다. 다른 테이블은 건드리지 않습니다.
-- 먼저 user_notes_grants_check.sql을 실행해 "적용 전" 표를 저장해 두세요.
-- 여러 번 실행해도 같은 결과가 됩니다(정책은 지우고 다시 만듭니다).
--
-- 서버 API(Vercel 함수)는 서버 전용 키(service_role)로 접근하므로 이 SQL의 영향을 받지 않고,
-- 이 SQL은 anon/authenticated 키로 Data API를 직접 부르는 경로를 좁힙니다.

begin;

-- 1) 기존 권한을 모두 회수합니다.
revoke all on table public.user_notes from public, anon, authenticated;

-- 2) 로그인한 사용자에게 네 가지 권한만 부여합니다. anon에는 아무것도 주지 않습니다.
grant select, insert, update, delete on table public.user_notes to authenticated;

-- 3) RLS를 켭니다. 정책이 없는 동작은 모두 거부됩니다.
alter table public.user_notes enable row level security;

-- 4) 정책: auth.uid() = owner_id 인 행만 허용합니다. (select auth.uid())는 행마다 다시 계산하지 않게 합니다.
drop policy if exists user_notes_select_own on public.user_notes;
drop policy if exists user_notes_insert_own on public.user_notes;
drop policy if exists user_notes_update_own on public.user_notes;
drop policy if exists user_notes_delete_own on public.user_notes;

-- 읽기: 기존 행이 본인 것일 때만
create policy user_notes_select_own on public.user_notes
  for select to authenticated
  using ((select auth.uid()) = owner_id);

-- 추가: 새 행의 owner_id가 본인일 때만
create policy user_notes_insert_own on public.user_notes
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

-- 수정: 기존 행이 본인 것이고(using), 수정 뒤의 새 행도 본인 것일 때만(with check) → 소유자 변경 불가
create policy user_notes_update_own on public.user_notes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- 삭제: 기존 행이 본인 것일 때만
create policy user_notes_delete_own on public.user_notes
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;

-- 확인용(적용 뒤 결과): 정책 네 개와 RLS 상태를 보여 줍니다. 권한 대조는 user_notes_grants_check.sql을 다시 실행하세요.
select c.relrowsecurity as rls_enabled,
       p.policyname, p.cmd, p.roles,
       p.qual as using_condition,
       p.with_check as with_check_condition
  from pg_class c
  left join pg_policies p on p.schemaname = 'public' and p.tablename = 'user_notes'
 where c.oid = 'public.user_notes'::regclass
 order by p.cmd, p.policyname;
