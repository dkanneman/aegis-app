-- Run against a disposable database after all migrations. The transaction rolls back.
begin;

create or replace function pg_temp.assert_true(value boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(value, false) then raise exception 'assertion failed: %', message; end if;
end;
$$;

insert into public.households(id,slug,name)
values ('71000000-0000-4000-8000-000000000001','trusted-driver-test','Trusted Driver Test');

insert into public.household_members(id,household_id,slug,display_name,role)
values (
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'adult-test',
  'Adult Test',
  'adult_admin'
);

insert into public.trusted_drivers(id,household_id,display_name,relationship,created_by_member_id)
values (
  '73000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'Family Friend',
  'Friend',
  '72000000-0000-4000-8000-000000000001'
);

insert into public.events(
  id,household_id,title,starts_at,status,kind,trusted_driver_id,transport_status
) values (
  '74000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'School pickup',
  now() + interval '1 hour',
  'confirmed',
  'school_pickup',
  '73000000-0000-4000-8000-000000000001',
  'assigned'
);

select pg_temp.assert_true(
  (select transport_status = 'confirmed'
   from public.events
   where id = '74000000-0000-4000-8000-000000000001'),
  'trusted-driver assignment should normalize to confirmed'
);

select public.recompute_household_consequences(
  '71000000-0000-4000-8000-000000000001'
);

select pg_temp.assert_true(
  not exists(
    select 1
    from public.consequences
    where household_id = '71000000-0000-4000-8000-000000000001'
      and event_id = '74000000-0000-4000-8000-000000000001'
      and consequence_type = 'missing_transport'
      and status = 'open'
  ),
  'a confirmed trusted driver should clear missing transportation'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.trusted_drivers', 'select')
  and not has_table_privilege('authenticated', 'public.trusted_drivers', 'select'),
  'trusted drivers should only be reachable through the authenticated Pepper API'
);

rollback;
