-- Database-backed authorization and idempotency checks. Synthetic data only.
begin;

do $$
declare
  matt_session uuid;
  action_id uuid;
  replay_id uuid;
  action_count integer;
  event_count integer;
  first_revision bigint;
  update_action_id uuid;
  second_update_action_id uuid;
  cancel_action_id uuid;
  danielle_session uuid;
begin
  select session_id into matt_session
  from public.member_sessions
  where member_id='00000000-0000-4000-8000-000000000013'::uuid;

  if matt_session is null then raise exception 'Matt stable session is missing'; end if;
  select session_id into danielle_session
  from public.member_sessions
  where member_id='00000000-0000-4000-8000-000000000011'::uuid;
  if danielle_session is null then raise exception 'Danielle stable session is missing'; end if;

  insert into public.events(
    id,household_id,title,starts_at,ends_at,status,visibility,kind,source,
    created_by_member_id,last_modified_by_member_id,last_modified_session_id,revision
  ) values (
    '00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000001',
    '[PEPPER TEST] Matt shared event','2026-09-21T17:00:00Z','2026-09-21T18:00:00Z',
    'confirmed','household','event','pepper','00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000013',matt_session,1
  );

  select private.pepper_record_calendar_event_mutation(
    '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000013',matt_session,'create',
    'pepper-test:matt:create:401',1,1,1,
    '{"synthetic":true,"operation":"create"}'::jsonb
  ) into action_id;

  update public.events set last_calendar_action_id=action_id
  where id='00000000-0000-4000-8000-000000000401';

  select private.pepper_record_calendar_event_mutation(
    '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000013',matt_session,'create',
    'pepper-test:matt:create:401',1,1,1,
    '{"synthetic":true,"operation":"create"}'::jsonb
  ) into replay_id;

  if replay_id<>action_id then raise exception 'Replay changed the deterministic action ID'; end if;
  select count(*) into action_count from private.calendar_event_mutation_requests
  where action_key='pepper-test:matt:create:401';
  if action_count<>1 then raise exception 'Replay duplicated the immutable action'; end if;
  select count(*) into event_count from public.events
  where id='00000000-0000-4000-8000-000000000401'
    and household_id='00000000-0000-4000-8000-000000000001';
  if event_count<>1 then raise exception 'Danielle and Matt do not resolve the same canonical event'; end if;

  begin
    perform private.pepper_record_calendar_event_mutation(
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401',
      '00000000-0000-4000-8000-000000000013',
      (select session_id from public.member_sessions where member_id='00000000-0000-4000-8000-000000000014'),
      'update','pepper-test:forged-member',1,1,2,'{"synthetic":true}'::jsonb
    );
    raise exception 'Forged member/session identity was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform private.pepper_record_calendar_event_mutation(
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401',
      '00000000-0000-4000-8000-000000000014',
      (select session_id from public.member_sessions where member_id='00000000-0000-4000-8000-000000000014'),
      'update','pepper-test:child',1,1,2,'{"synthetic":true}'::jsonb
    );
    raise exception 'Child Calendar mutation was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform private.pepper_record_calendar_event_mutation(
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401',
      '00000000-0000-4000-8000-000000000021',
      (select session_id from public.member_sessions where member_id='00000000-0000-4000-8000-000000000021'),
      'update','pepper-test:other-household',1,1,2,'{"synthetic":true}'::jsonb
    );
    raise exception 'Cross-household Calendar mutation was accepted';
  exception when insufficient_privilege then null;
  end;

  update public.household_members set active=false,removed_at=now()
  where id='00000000-0000-4000-8000-000000000013';
  begin
    perform private.pepper_record_calendar_event_mutation(
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401',
      '00000000-0000-4000-8000-000000000013',matt_session,
      'update','pepper-test:inactive',1,1,2,'{"synthetic":true}'::jsonb
    );
    raise exception 'Inactive member Calendar mutation was accepted';
  exception when insufficient_privilege then null;
  end;
  update public.household_members set active=true,removed_at=null
  where id='00000000-0000-4000-8000-000000000013';

  begin
    update private.calendar_event_mutation_requests set action='update' where id=action_id;
    raise exception 'Immutable Calendar action was updated';
  exception when object_not_in_prerequisite_state then null;
  end;

  select revision into first_revision from public.events
  where id='00000000-0000-4000-8000-000000000401';
  select private.pepper_record_calendar_event_mutation(
    '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000013',matt_session,'update',
    'pepper-test:matt:update:401',first_revision,first_revision,first_revision+1,
    '{"synthetic":true,"operation":"update"}'::jsonb
  ) into update_action_id;
  update public.events set revision=revision+1,title='[PEPPER TEST] Matt updated event',
    last_calendar_action_id=update_action_id,
    last_modified_by_member_id='00000000-0000-4000-8000-000000000013',
    last_modified_session_id=matt_session
  where id='00000000-0000-4000-8000-000000000401' and revision=first_revision;
  if not found then raise exception 'First optimistic update failed'; end if;
  update public.events set revision=revision+1,title='[PEPPER TEST] stale overwrite'
  where id='00000000-0000-4000-8000-000000000401' and revision=first_revision;
  if found then raise exception 'Stale simultaneous update overwrote newer state'; end if;
  update public.events set revision=revision+1,title='[PEPPER TEST] future overwrite'
  where id='00000000-0000-4000-8000-000000000401' and revision=first_revision+2;
  if found then raise exception 'Future revision was accepted'; end if;

  select private.pepper_record_calendar_event_mutation(
    '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000011',danielle_session,'update',
    'pepper-test:danielle:update:401',first_revision+1,first_revision+1,first_revision+2,
    '{"synthetic":true,"operation":"update","device":"second"}'::jsonb
  ) into second_update_action_id;
  update public.events set revision=revision+1,title='[PEPPER TEST] Danielle updated event',
    location='[PEPPER TEST] Shared location',updated_at=now(),
    last_calendar_action_id=second_update_action_id,
    last_modified_by_member_id='00000000-0000-4000-8000-000000000011',
    last_modified_session_id=danielle_session
  where id='00000000-0000-4000-8000-000000000401' and revision=first_revision+1;
  if not found then raise exception 'Second authorized update failed'; end if;
  if not exists (
    select 1 from public.events
    where id='00000000-0000-4000-8000-000000000401'
      and revision=first_revision+2
      and title='[PEPPER TEST] Danielle updated event'
      and location='[PEPPER TEST] Shared location'
      and last_modified_by_member_id='00000000-0000-4000-8000-000000000011'
      and last_modified_session_id=danielle_session
  ) then raise exception 'Second session cannot see revision 3 with Danielle attribution'; end if;

  update public.events set status='canceled',revision=revision+1
  where id='00000000-0000-4000-8000-000000000401' and revision=first_revision+1;
  if found then raise exception 'Stale cancellation overwrote revision 3'; end if;

  select private.pepper_record_calendar_event_mutation(
    '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000013',matt_session,'cancel',
    'pepper-test:matt:cancel:401',first_revision+2,first_revision+2,first_revision+3,
    '{"synthetic":true,"operation":"cancel"}'::jsonb
  ) into cancel_action_id;
  update public.events set status='canceled',revision=revision+1,
    last_calendar_action_id=cancel_action_id,
    last_modified_by_member_id='00000000-0000-4000-8000-000000000013',
    last_modified_session_id=matt_session
  where id='00000000-0000-4000-8000-000000000401' and revision=first_revision+2;
  if not found then raise exception 'Authorized cancellation did not preserve optimistic concurrency'; end if;

  select count(*) into action_count from private.calendar_event_mutation_requests
  where event_id='00000000-0000-4000-8000-000000000401';
  if action_count<>4 then raise exception 'Create, two updates, and cancel did not produce four immutable actions'; end if;
  if (select revision from public.events where id='00000000-0000-4000-8000-000000000401')<>first_revision+3 then
    raise exception 'Event revision did not increment exactly once per successful mutation';
  end if;
  if (select count(*) from public.events where id='00000000-0000-4000-8000-000000000401')<>1 then
    raise exception 'Event lifecycle created a duplicate canonical event';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon','private.calendar_event_mutation_requests','select')
     or has_table_privilege('authenticated','private.calendar_event_mutation_requests','select') then
    raise exception 'Browser roles can read Calendar mutation evidence';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='private' and table_name='calendar_event_mutation_requests'
      and column_name in ('token','access_token','refresh_token','client_secret')
  ) then
    raise exception 'Calendar mutation evidence exposes an OAuth or session secret column';
  end if;
end;
$$;

rollback;
