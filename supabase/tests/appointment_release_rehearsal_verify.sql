-- Fail-fast post-apply assertions for the isolated synthetic rehearsal.

do $$
declare
  issue_count integer;
  appointment_count_before integer;
  delivery_count_before integer;
  audit_count_before integer;
  evidence_type text;
  -- Explicit local test double; never represents externally verified evidence.
  valid_probe_evidence jsonb := jsonb_build_object(
    'success', true,
    'event_id', 'pepperprobe00000000000040008000000000000099',
    'created', true,
    'read_back', true,
    'deleted', true,
    'absence_verified', true
  );
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version='20260915203426'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version='20260915203431'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version='20260916120000'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version='20260916150000'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version='20260917211929'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version='20260928230029'
  ) then raise exception 'Reconciled migration history is incomplete.'; end if;

  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version in ('20260915164500','20260915175808','20260916143000')
  ) then raise exception 'Local or sandbox-only migration leaked into the production rehearsal.'; end if;

  if to_regprocedure('public.pepper_claim_aegis_sheet_delivery(uuid,uuid,jsonb,uuid)') is null
     or to_regprocedure('public.pepper_finish_aegis_sheet_delivery(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz)') is null
     or to_regprocedure('private.pepper_schedule_calendar_sync(text)') is null
     or to_regprocedure('private.pepper_disable_calendar_sync()') is null then
    raise exception 'Required delivery or scheduler function is missing.';
  end if;

  if to_regprocedure('private.pepper_record_calendar_event_mutation(uuid,uuid,uuid,uuid,text,text,bigint,bigint,bigint,jsonb)') is null
     or to_regclass('private.calendar_event_mutation_requests') is null then
    raise exception 'Required household Calendar authorization objects are missing.';
  end if;

  if (
    select count(*) from information_schema.columns
    where table_schema='public' and table_name='events'
      and column_name in (
        'created_by_member_id','last_modified_by_member_id','last_modified_session_id',
        'last_calendar_action_id','revision'
      )
  ) <> 5 then
    raise exception 'Household Calendar event provenance columns are missing.';
  end if;

  if to_regclass('public.events_calendar_sync_retry_idx') is null
     or to_regclass('private.appointment_bridge_deliveries_aegis_retry_idx') is null
     or to_regclass('private.appointment_bridge_deliveries_household_idx') is null then
    raise exception 'Required pending-migration index is missing.';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema='public' and table_name='calendar_connections'
      and column_name in (
        'calendar_setup_method','calendar_created_at',
        'calendar_mode','pepper_installation_id','pepper_calendar_marker',
        'google_account_email','google_account_subject','google_data_owner',
        'calendar_probe_completed_at','calendar_probe_evidence'
      )
  ) <> 10 then
    raise exception 'App-created Calendar proof columns are missing.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.calendar_connections'::regclass
      and conname='calendar_connections_app_created_proof_check'
  ) then
    raise exception 'App-created Calendar proof constraint is missing.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.calendar_connections'::regclass
      and conname='calendar_connections_active_probe_check'
  ) then
    raise exception 'Calendar connection activation probe constraint is missing.';
  end if;

  begin
    update public.calendar_connections
    set calendar_setup_method='google_calendars_insert_v1'
    where id='00000000-0000-4000-8000-000000000021';
    raise exception 'Partial Calendar creation proof unexpectedly passed.';
  exception when check_violation then
    null;
  end;

  select count(*) into appointment_count_before
  from public.events where kind='appointment';
  select count(*) into delivery_count_before
  from private.appointment_bridge_deliveries;
  select count(*) into audit_count_before
  from public.audit_log;

  update public.calendar_connections
  set provider_calendar_id='pepper-app-created@group.calendar.google.com',
      calendar_name='Pepper Sandbox',
      access_scope='openid email https://www.googleapis.com/auth/calendar.app.created',
      calendar_setup_method='google_calendars_insert_v1',
      calendar_created_at=now(),
      calendar_mode='sandbox',
      pepper_installation_id='00000000-0000-4000-8000-000000000099',
      pepper_calendar_marker='Managed by Pepper | installation:00000000-0000-4000-8000-000000000099',
      google_account_email='synthetic@example.com',
      google_account_subject='synthetic-google-subject',
      google_data_owner='synthetic@example.com',
      calendar_probe_completed_at=null,
      calendar_probe_evidence=null,
      status='error', sync_status='never', last_error='[PEPPER TEST] probe pending'
  where id='00000000-0000-4000-8000-000000000021';

  update public.calendar_connections
  set calendar_probe_completed_at=now(),
      calendar_probe_evidence=valid_probe_evidence,
      status='connected', sync_status='never', last_error=null
  where id='00000000-0000-4000-8000-000000000021';

  select pg_typeof(calendar_probe_evidence)::text into evidence_type
  from public.calendar_connections
  where id='00000000-0000-4000-8000-000000000021';
  if evidence_type <> 'jsonb' then
    raise exception 'Probe evidence was not stored as jsonb.';
  end if;
  if (select jsonb_typeof(calendar_probe_evidence)
      from public.calendar_connections
      where id='00000000-0000-4000-8000-000000000021') <> 'object' then
    raise exception 'Probe evidence was not stored as a JSON object.';
  end if;
  if not (
    select calendar_probe_evidence @> valid_probe_evidence
      and jsonb_typeof(calendar_probe_evidence->'success')='boolean'
      and jsonb_typeof(calendar_probe_evidence->'created')='boolean'
      and jsonb_typeof(calendar_probe_evidence->'read_back')='boolean'
      and jsonb_typeof(calendar_probe_evidence->'deleted')='boolean'
      and jsonb_typeof(calendar_probe_evidence->'absence_verified')='boolean'
      and jsonb_typeof(calendar_probe_evidence->'event_id')='string'
    from public.calendar_connections
    where id='00000000-0000-4000-8000-000000000021'
  ) then
    raise exception 'Probe evidence properties or JSON types are incorrect.';
  end if;

  update public.calendar_connections
  set calendar_probe_completed_at=now(),
      calendar_probe_evidence=valid_probe_evidence,
      status='connected'
  where id='00000000-0000-4000-8000-000000000021';
  if (select count(*) from public.calendar_connections
      where household_id='00000000-0000-4000-8000-000000000001'
        and provider='google') <> 1 then
    raise exception 'Probe retry duplicated the Calendar connection.';
  end if;

  update public.calendar_connections
  set calendar_probe_completed_at=null,
      calendar_probe_evidence=null,
      status='error', sync_status='never', last_error='[PEPPER TEST] probe pending'
  where id='00000000-0000-4000-8000-000000000021';

  begin
    update public.calendar_connections
    set calendar_probe_completed_at=now(),
        calendar_probe_evidence=to_jsonb(valid_probe_evidence::text),
        status='connected'
    where id='00000000-0000-4000-8000-000000000021';
    raise exception 'JSON-stringified probe evidence unexpectedly activated the connection.';
  exception when check_violation then null;
  end;
  begin
    update public.calendar_connections
    set calendar_probe_completed_at=now(), calendar_probe_evidence=null, status='connected'
    where id='00000000-0000-4000-8000-000000000021';
    raise exception 'Null probe evidence unexpectedly activated the connection.';
  exception when check_violation then null;
  end;
  begin
    update public.calendar_connections
    set calendar_probe_completed_at=now(), calendar_probe_evidence='true'::jsonb, status='connected'
    where id='00000000-0000-4000-8000-000000000021';
    raise exception 'Scalar probe evidence unexpectedly activated the connection.';
  exception when check_violation then null;
  end;
  begin
    update public.calendar_connections
    set calendar_probe_completed_at=now(), calendar_probe_evidence='[]'::jsonb, status='connected'
    where id='00000000-0000-4000-8000-000000000021';
    raise exception 'Array probe evidence unexpectedly activated the connection.';
  exception when check_violation then null;
  end;
  begin
    update public.calendar_connections
    set calendar_probe_completed_at=now(), calendar_probe_evidence='not-json'::jsonb, status='connected'
    where id='00000000-0000-4000-8000-000000000021';
    raise exception 'Malformed probe evidence unexpectedly activated the connection.';
  exception when invalid_text_representation then null;
  end;
  begin
    update public.calendar_connections
    set calendar_probe_completed_at=now(),
        calendar_probe_evidence='{"success":true}'::jsonb,
        status='connected'
    where id='00000000-0000-4000-8000-000000000021';
    raise exception 'Incomplete probe evidence unexpectedly activated the connection.';
  exception when check_violation then null;
  end;

  if (select status from public.calendar_connections
      where id='00000000-0000-4000-8000-000000000021') = 'connected' then
    raise exception 'Failed probe evidence persistence activated the connection.';
  end if;
  if (select count(*) from public.events where kind='appointment') <> appointment_count_before
     or (select count(*) from private.appointment_bridge_deliveries) <> delivery_count_before
     or (select count(*) from public.audit_log) <> audit_count_before then
    raise exception 'Connection probe created appointment, delivery, or audit side effects.';
  end if;

  update public.calendar_connections
  set provider_calendar_id='synthetic@group.calendar.google.com',
      calendar_name='Pepper Sandbox',
      access_scope='calendar.readonly',
      calendar_setup_method=null,
      calendar_created_at=null,
      calendar_mode=null,
      pepper_installation_id=null,
      pepper_calendar_marker=null,
      google_account_email=null,
      google_account_subject=null,
      google_data_owner=null,
      calendar_probe_completed_at=null,
      calendar_probe_evidence=null,
      status='reconnect_required', sync_status='error',
      last_error='Reconnect Google Calendar so Pepper can create and use its dedicated calendar.'
  where id='00000000-0000-4000-8000-000000000021';

  begin
    update public.calendar_connections
    set provider_calendar_id='pepper-app-created@group.calendar.google.com',
        calendar_name='Pepper Sandbox',
        access_scope='openid email https://www.googleapis.com/auth/calendar.app.created',
        calendar_setup_method='google_calendars_insert_v1',
        calendar_created_at=now(),
        calendar_mode='sandbox',
        pepper_installation_id='00000000-0000-4000-8000-000000000099',
        pepper_calendar_marker='Managed by Pepper | installation:00000000-0000-4000-8000-000000000099',
        google_account_email='synthetic@example.com',
        google_account_subject='synthetic-google-subject',
        google_data_owner='synthetic@example.com',
        calendar_probe_completed_at=null,
        calendar_probe_evidence=null,
        status='connected'
    where id='00000000-0000-4000-8000-000000000021';
    raise exception 'Calendar connection activated without a complete probe.';
  exception when check_violation then
    null;
  end;

  select count(*) into issue_count from (
    select household_id,dedupe_key from public.events
    where dedupe_key is not null and deleted_at is null
    group by household_id,dedupe_key having count(*) > 1
  ) duplicate_keys;
  if issue_count <> 0 then raise exception 'Duplicate event dedupe keys found.'; end if;

  select count(*) into issue_count from public.events
  where starts_at is null or (ends_at is not null and ends_at <= starts_at);
  if issue_count <> 0 then raise exception 'Malformed timestamps found.'; end if;

  select count(*) into issue_count
  from private.appointment_bridge_deliveries delivery
  left join public.events event on event.id=delivery.event_id
  left join public.captures capture on capture.id=delivery.capture_id
  where event.id is null or capture.id is null
     or event.household_id is distinct from capture.household_id;
  if issue_count <> 0 then raise exception 'Orphaned bridge deliveries found.'; end if;

  if (select count(*) from public.events where kind='appointment' and deleted_at is null) <> 7 then
    raise exception 'Expected seven synthetic appointments.';
  end if;
  if (select count(*) from public.events where kind='appointment' and scheduling_priority=100) <> 7 then
    raise exception 'Medical priority was not preserved.';
  end if;
  if (select count(*) from public.calendar_connections where status='reconnect_required') <> 1 then
    raise exception 'Read-only Calendar connection was not marked reconnect_required.';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.events'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.tasks'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.captures'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.calendar_connections'::regclass)
     or not (select relrowsecurity from pg_class where oid='private.task_priority_review_queue'::regclass) then
    raise exception 'Expected RLS is not enabled.';
  end if;

  if has_table_privilege('anon','private.appointment_bridge_deliveries','select')
     or has_table_privilege('authenticated','private.appointment_bridge_deliveries','select')
     or has_table_privilege('anon','private.appointment_release_task_backfill_backup','select')
     or has_table_privilege('authenticated','private.appointment_release_calendar_connection_backup','select') then
    raise exception 'Private release tables leaked to browser roles.';
  end if;

  begin
    perform private.pepper_schedule_calendar_sync(
      'https://synthetic.supabase.co/functions/v1/pepper-calendar'
    );
    raise exception 'Scheduler unexpectedly accepted missing Vault configuration.';
  exception when others then
    if sqlerrm not like 'Vault secret pepper_calendar_cron_secret must be created%' then raise; end if;
  end;
  if exists (select 1 from cron.job where jobname='pepper-calendar-sync') then
    raise exception 'Scheduler job was created without protected configuration.';
  end if;
end;
$$;

begin;
select set_config('request.jwt.claim.role','service_role',true);

select public.pepper_record_appointment_bridge(
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000103',
  '{"synthetic":true,"state":"retry"}',
  'retry_required','retry_required','Synthetic transient failure'
);
select public.pepper_record_appointment_bridge(
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000103',
  '{"synthetic":true,"state":"retry"}',
  'retry_required','retry_required','Synthetic replay'
);

do $$
declare lease uuid := '00000000-0000-4000-8000-000000000401';
begin
  perform public.pepper_claim_aegis_sheet_delivery(
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000102',
    '{"synthetic":true,"state":"claimed"}',lease
  );
  perform public.pepper_finish_aegis_sheet_delivery(
    '00000000-0000-4000-8000-000000000202',lease,'synced',
    'synthetic-workbook/Pepper Appointments','pepper-event:00000000-0000-4000-8000-000000000202',
    null,null,now(),now()
  );
  if (select count(*) from private.appointment_bridge_deliveries
      where event_id='00000000-0000-4000-8000-000000000203') <> 1 then
    raise exception 'Replay created a duplicate bridge delivery.';
  end if;
  if (select external_event_id from public.events
      where id='00000000-0000-4000-8000-000000000203') <> 'stale-google-id' then
    raise exception 'Stale Google identity was replaced unexpectedly.';
  end if;
end;
$$;

update public.events set status='canceled',sync_status='retry_required'
where id='00000000-0000-4000-8000-000000000201';
do $$
begin
  if (select external_event_id from public.events
      where id='00000000-0000-4000-8000-000000000201') <> 'synthetic-google-1' then
    raise exception 'Cancellation changed the existing Google event ID.';
  end if;
end;
$$;
rollback;
