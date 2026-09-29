-- Real PostgreSQL checks. These are local synthetic constraint tests, NOT
-- evidence of a successful Google connection. Every mutation rolls back.
begin;
do $$
declare original_count bigint;
begin
  select count(*) into original_count from private.calendar_oauth_states;
  insert into private.calendar_oauth_states
    (state_hash,code_verifier,household_id,member_id,expires_at)
  values ('LOCAL_SCHEMA_TEST','LOCAL_DUMMY_VERIFIER',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000011',now()+interval '10 minutes');
  if (select return_target from private.calendar_oauth_states where state_hash='LOCAL_SCHEMA_TEST') <> 'web' then
    raise exception 'Missing web default';
  end if;
  update private.calendar_oauth_states set return_target='pepper_ios' where state_hash='LOCAL_SCHEMA_TEST';
  begin
    update private.calendar_oauth_states set return_target=null where state_hash='LOCAL_SCHEMA_TEST';
    raise exception 'Null return target accepted';
  exception when not_null_violation then null;
  end;
  begin
    update private.calendar_oauth_states set return_target='https://evil.invalid' where state_hash='LOCAL_SCHEMA_TEST';
    raise exception 'External redirect accepted';
  exception when check_violation then null;
  end;
  if (select count(*) from private.calendar_oauth_states) <> original_count+1 then
    raise exception 'Unexpected OAuth state count';
  end if;
  if not (select relrowsecurity from pg_class where oid='private.calendar_oauth_states'::regclass)
     or has_table_privilege('anon','private.calendar_oauth_states','select,insert,update,delete')
     or has_table_privilege('authenticated','private.calendar_oauth_states','select,insert,update,delete') then
    raise exception 'OAuth private-schema access boundary changed';
  end if;
end;
$$;
rollback;
