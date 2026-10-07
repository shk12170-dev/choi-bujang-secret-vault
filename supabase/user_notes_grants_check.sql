-- 4단계 제작 3 (확인용): user_notes의 실제 권한을 두 방식으로 대조합니다. 읽기만 하며 아무것도 바꾸지 않습니다.
-- 적용 전에 한 번, user_notes_rls.sql 적용 뒤에 한 번 실행해 결과를 비교하세요.
-- 한 번에 한 결과만 보이므로 두 조회를 하나의 표로 합쳤습니다.

-- source = 'role_table_grants'    : information_schema에 기록된 부여 목록(grantee별 privilege_type)
-- source = 'has_table_privilege'  : PUBLIC 상속까지 합쳐 역할이 실제로 쓸 수 있는지(true/false)
select 'role_table_grants' as source,
       grantee as role_name,
       privilege_type as privilege,
       'granted' as result
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'user_notes'
   and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
union all
select 'has_table_privilege',
       r.role_name,
       p.privilege,
       has_table_privilege(r.role_name, 'public.user_notes', p.privilege)::text
  from (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
 cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(privilege)
 order by source desc, role_name, privilege;
