-- Run against a disposable restore of the hosted schema, not only the local chain.
begin;
do $$
declare
  household uuid := gen_random_uuid();
  other_household uuid := gen_random_uuid();
  adult uuid := gen_random_uuid();
  minor uuid := gen_random_uuid();
  driver uuid := gen_random_uuid();
  other_driver uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  state text;
begin
  insert into public.households(id,slug,name) values
    (household,'test-'||household,'[PEPPER TEST] Transport prerequisite'),
    (other_household,'test-'||other_household,'[PEPPER TEST] Other household');
  insert into public.household_members(id,household_id,slug,display_name,role) values
    (adult,household,'parent','[PEPPER TEST] Parent','adult_admin'),
    (minor,household,'teen','[PEPPER TEST] Teen','teen');
  -- This INSERT must reproduce the old-schema failure before the forward repair.
  insert into public.events(id,household_id,title,starts_at,ends_at,kind,source)
    values(event_id,household,'[PEPPER TEST] Transport prerequisite',now()+interval '1 day',
      now()+interval '1 day 1 hour','transport','pepper');
  select transport_status into state from public.events where id=event_id;
  if state is distinct from 'unassigned' then raise exception 'Unassigned ride mismatch'; end if;
  insert into public.trusted_drivers(id,household_id,display_name) values
    (driver,household,'[PEPPER TEST] Driver'),(other_driver,other_household,'[PEPPER TEST] Other driver');
  update public.events set transport_owner_member_id=adult where id=event_id;
  select transport_status into state from public.events where id=event_id;
  if state is distinct from 'assigned' then raise exception 'Assignment falsely confirmed'; end if;
  update public.events set transport_status='confirmed' where id=event_id;
  update public.events set title='[PEPPER TEST] Updated' where id=event_id;
  select transport_status into state from public.events where id=event_id;
  if state is distinct from 'confirmed' then raise exception 'Unrelated edit reset confirmation'; end if;
  begin
    update public.events set transport_owner_member_id=minor where id=event_id;
    raise exception 'TEST: teen driver accepted';
  exception when raise_exception then
    if sqlerrm <> 'Choose an active adult driver in this household.' then raise; end if;
  end;
  update public.household_members set active=false,removed_at=now() where id=adult;
  begin
    update public.events set transport_status='confirmed' where id=event_id;
    raise exception 'TEST: inactive driver accepted';
  exception when raise_exception then
    if sqlerrm <> 'Choose an active adult driver in this household.' then raise; end if;
  end;
  update public.events set transport_owner_member_id=null,trusted_driver_id=driver where id=event_id;
  select transport_status into state from public.events where id=event_id;
  if state is distinct from 'assigned' then raise exception 'Trusted driver transition mismatch'; end if;
  begin
    update public.events set trusted_driver_id=other_driver where id=event_id;
    raise exception 'TEST: cross-household driver accepted';
  exception when raise_exception then
    if sqlerrm <> 'Choose an active trusted driver for this household.' then raise; end if;
  end;
  update public.events set trusted_driver_id=null where id=event_id;
  select transport_status into state from public.events where id=event_id;
  if state is distinct from 'unassigned' then raise exception 'Driver removal mismatch'; end if;
  perform public.recompute_household_consequences(household);
  if not (select relrowsecurity from pg_class where oid='public.trusted_drivers'::regclass)
    or has_table_privilege('anon','public.trusted_drivers','SELECT')
    or has_table_privilege('authenticated','public.trusted_drivers','INSERT') then
    raise exception 'Trusted driver browser boundary failed';
  end if;
end;
$$;
select 'PASS: event writes, assignment semantics, member/household guards, consequence runtime and RLS';
rollback;
