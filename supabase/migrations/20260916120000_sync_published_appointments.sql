alter table public.events
  add column if not exists last_sync_error text,
  add column if not exists sync_retry_at timestamptz,
  add column if not exists sync_attempt_count integer not null default 0;

create index if not exists events_calendar_sync_retry_idx
  on public.events(sync_retry_at, updated_at)
  where sync_status in ('retry_required', 'reconnect_required');

alter table private.appointment_bridge_deliveries
  drop constraint if exists appointment_bridge_deliveries_google_status_check;

alter table private.appointment_bridge_deliveries
  add constraint appointment_bridge_deliveries_google_status_check
  check (google_status in (
    'pending', 'synced', 'skipped', 'needs_reconnect', 'retry_required', 'failed'
  ));

alter table public.calendar_connections
  drop constraint if exists calendar_connections_status_check;

alter table public.calendar_connections
  add constraint calendar_connections_status_check
  check (status in ('disconnected', 'connected', 'error', 'reconnect_required'));

alter table public.calendar_connections
  add column if not exists calendar_setup_method text,
  add column if not exists calendar_created_at timestamptz,
  add column if not exists calendar_mode text,
  add column if not exists pepper_installation_id uuid,
  add column if not exists pepper_calendar_marker text,
  add column if not exists google_account_email text,
  add column if not exists google_account_subject text,
  add column if not exists google_data_owner text,
  add column if not exists calendar_probe_completed_at timestamptz,
  add column if not exists calendar_probe_evidence jsonb;

alter table public.calendar_connections
  drop constraint if exists calendar_connections_app_created_proof_check;

alter table public.calendar_connections
  add constraint calendar_connections_app_created_proof_check
  check (
    (
      calendar_setup_method is null
      and calendar_created_at is null
      and calendar_mode is null
      and pepper_installation_id is null
      and pepper_calendar_marker is null
      and google_account_email is null
      and google_account_subject is null
      and google_data_owner is null
      and calendar_probe_completed_at is null
      and calendar_probe_evidence is null
    )
    or (
      calendar_setup_method = 'google_calendars_insert_v1'
      and calendar_created_at is not null
      and calendar_mode in ('sandbox', 'production')
      and pepper_installation_id is not null
      and pepper_calendar_marker =
        'Managed by Pepper | installation:' || lower(pepper_installation_id::text)
      and length(btrim(coalesce(google_account_email, ''))) > 0
      and length(btrim(coalesce(google_account_subject, ''))) > 0
      and length(btrim(coalesce(google_data_owner, ''))) > 0
      and lower(btrim(google_data_owner)) = lower(btrim(google_account_email))
      and length(btrim(provider_calendar_id)) > 0
      and lower(btrim(provider_calendar_id)) <> 'primary'
      and lower(btrim(provider_calendar_id)) <> lower(btrim(google_account_email))
      and calendar_name = case
        when calendar_mode = 'sandbox' then 'Pepper Sandbox'
        else 'Pepper Family'
      end
      and (
        (calendar_probe_completed_at is null and calendar_probe_evidence is null)
        or (
          calendar_probe_completed_at is not null
          and pg_catalog.jsonb_typeof(calendar_probe_evidence) = 'object'
          and calendar_probe_evidence @> '{"success":true,"created":true,"read_back":true,"deleted":true,"absence_verified":true}'::jsonb
        )
      )
    )
  );

alter table public.calendar_connections
  drop constraint if exists calendar_connections_active_probe_check;

alter table public.calendar_connections
  add constraint calendar_connections_active_probe_check
  check (
    status <> 'connected'
    or (
      calendar_setup_method = 'google_calendars_insert_v1'
      and calendar_probe_completed_at is not null
      and calendar_probe_evidence is not null
      and pg_catalog.jsonb_typeof(calendar_probe_evidence) = 'object'
      and calendar_probe_evidence @> '{"success":true,"created":true,"read_back":true,"deleted":true,"absence_verified":true}'::jsonb
    )
  ) not valid;

create or replace function public.pepper_record_appointment_bridge(
  event_id_input uuid,
  capture_id_input uuid,
  normalized_payload_input jsonb,
  aegis_status_input text,
  google_status_input text,
  last_error_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  household_id_value uuid;
  capture_household_id_value uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service authorization required.' using errcode = '42501';
  end if;
  if aegis_status_input not in ('pending', 'synced', 'failed')
     or google_status_input not in (
       'pending', 'synced', 'skipped', 'needs_reconnect', 'retry_required', 'failed'
     ) then
    raise exception 'Invalid bridge status.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(normalized_payload_input) <> 'object' then
    raise exception 'Normalized appointment payload must be an object.' using errcode = '22023';
  end if;

  select event.household_id into household_id_value
  from public.events event
  where event.id = event_id_input and event.deleted_at is null;
  select capture.household_id into capture_household_id_value
  from public.captures capture
  where capture.id = capture_id_input;

  if household_id_value is null
     or capture_household_id_value is distinct from household_id_value then
    raise exception 'Bridge records must belong to the same household.' using errcode = '23503';
  end if;

  insert into private.appointment_bridge_deliveries (
    event_id, capture_id, household_id, normalized_payload,
    aegis_status, google_status, attempt_count, last_error, updated_at
  ) values (
    event_id_input, capture_id_input, household_id_value, normalized_payload_input,
    aegis_status_input, google_status_input, 1, left(last_error_input, 500), now()
  )
  on conflict (event_id) do update set
    capture_id = excluded.capture_id,
    normalized_payload = excluded.normalized_payload,
    aegis_status = excluded.aegis_status,
    google_status = excluded.google_status,
    attempt_count = private.appointment_bridge_deliveries.attempt_count
      + case when excluded.google_status in ('pending', 'retry_required') then 1 else 0 end,
    last_error = excluded.last_error,
    updated_at = now();

  return jsonb_build_object(
    'event_id', event_id_input,
    'capture_id', capture_id_input,
    'aegis_status', aegis_status_input,
    'google_status', google_status_input
  );
end;
$$;

create or replace function private.pepper_set_medical_coordination_priority()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  local_today date := (pg_catalog.now() at time zone 'America/Los_Angeles')::date;
  local_due date;
  days_until_due integer;
  routine_preparation boolean;
begin
  if new.source <> 'pepper_medical_coordination' then return new; end if;

  local_due := case
    when new.due_at is null then null
    else (new.due_at at time zone 'America/Los_Angeles')::date
  end;
  days_until_due := case when local_due is null then null else local_due - local_today end;
  routine_preparation := concat_ws(' ', new.title, new.next_action) ~*
    '\m(prepare|preparation|bring|paperwork|forms|arrive early)\M'
    and concat_ws(' ', new.title, new.next_action) !~*
    '\m(transport|ride|school release|attendance|work coverage|unresolved|confirm)\M';

  new.area := 'Family';
  new.project := 'Medical coordination';
  new.classification := 'Medical coordination';
  new.tags := coalesce(new.tags, '{}'::text[]);
  if not ('medical' = any(new.tags)) then new.tags := array_append(new.tags, 'medical'); end if;
  if not ('coordination' = any(new.tags)) then new.tags := array_append(new.tags, 'coordination'); end if;
  new.next_action := coalesce(nullif(new.next_action, ''), new.title);
  new.deadline_type := 'soft';
  new.due_date_confidence := case when new.due_at is null then 0.500 else 1.000 end;
  new.priority_classification_confidence := 1.000;

  if routine_preparation then
    new.priority := 'P2';
    new.importance := 'normal';
    new.urgency := case when days_until_due is not null and days_until_due <= 7 then 'this_week' else 'upcoming' end;
    new.priority_reason := 'Routine medical preparation';
  elsif days_until_due is not null and days_until_due between 0 and 2 then
    new.priority := 'P0';
    new.importance := 'critical';
    new.urgency := 'today';
    new.priority_reason := 'Imminent medical coordination remains unresolved';
  else
    new.priority := 'P1';
    new.importance := 'high';
    new.urgency := case when days_until_due is not null and days_until_due <= 7 then 'this_week' else 'upcoming' end;
    new.priority_reason := 'Confirmed future medical appointment requires coordination';
  end if;

  return new;
end;
$$;

create table if not exists private.appointment_release_task_backfill_backup (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  priority text not null,
  area text not null,
  project text not null,
  classification text not null,
  tags text[] not null,
  next_action text not null,
  importance text not null,
  urgency text not null,
  deadline_type text not null,
  due_date_confidence numeric not null,
  priority_classification_confidence numeric not null,
  priority_reason text not null,
  captured_at timestamptz not null default now()
);

revoke all on private.appointment_release_task_backfill_backup from public, anon, authenticated;

insert into private.appointment_release_task_backfill_backup (
  task_id, priority, area, project, classification, tags, next_action,
  importance, urgency, deadline_type, due_date_confidence,
  priority_classification_confidence, priority_reason
)
select
  task.id, task.priority, task.area, task.project, task.classification, task.tags,
  task.next_action, task.importance, task.urgency, task.deadline_type,
  task.due_date_confidence, task.priority_classification_confidence,
  task.priority_reason
from public.tasks task
where task.source = 'pepper_medical_coordination'
on conflict (task_id) do nothing;

drop trigger if exists zz_tasks_medical_coordination_priority on public.tasks;
create trigger zz_tasks_medical_coordination_priority
before insert or update of source, priority, area, project, classification, tags,
  title, next_action, due_at, importance, urgency, deadline_type
on public.tasks
for each row execute function private.pepper_set_medical_coordination_priority();

update public.tasks
set source = source
where source = 'pepper_medical_coordination';

create table if not exists private.appointment_release_calendar_connection_backup (
  connection_id uuid primary key references public.calendar_connections(id) on delete cascade,
  status text not null,
  sync_status text not null,
  last_error text,
  updated_at timestamptz not null,
  captured_at timestamptz not null default now()
);

revoke all on private.appointment_release_calendar_connection_backup
  from public, anon, authenticated;

insert into private.appointment_release_calendar_connection_backup (
  connection_id, status, sync_status, last_error, updated_at
)
select id, status, sync_status, last_error, updated_at
from public.calendar_connections
where provider = 'google'
  and (
    calendar_setup_method is distinct from 'google_calendars_insert_v1'
    or trim(coalesce(access_scope, '')) not like
      '%https://www.googleapis.com/auth/calendar.app.created%'
    or calendar_mode not in ('sandbox', 'production')
    or pepper_installation_id is null
    or pepper_calendar_marker is distinct from
      'Managed by Pepper | installation:' || lower(pepper_installation_id::text)
    or lower(btrim(coalesce(google_data_owner, ''))) is distinct from
      lower(btrim(coalesce(google_account_email, '')))
    or calendar_probe_completed_at is null
    or not coalesce(
      calendar_probe_evidence @> '{"success":true,"created":true,"read_back":true,"deleted":true,"absence_verified":true}'::jsonb,
      false
    )
  )
on conflict (connection_id) do nothing;

update public.calendar_connections
set status = 'reconnect_required',
    sync_status = 'error',
    last_error = 'Reconnect Google Calendar so Pepper can create and use its dedicated calendar.',
    updated_at = now()
where provider = 'google'
  and (
    calendar_setup_method is distinct from 'google_calendars_insert_v1'
    or trim(coalesce(access_scope, '')) not like
      '%https://www.googleapis.com/auth/calendar.app.created%'
    or calendar_mode not in ('sandbox', 'production')
    or pepper_installation_id is null
    or pepper_calendar_marker is distinct from
      'Managed by Pepper | installation:' || lower(pepper_installation_id::text)
    or lower(btrim(coalesce(google_data_owner, ''))) is distinct from
      lower(btrim(coalesce(google_account_email, '')))
    or calendar_probe_completed_at is null
    or not coalesce(
      calendar_probe_evidence @> '{"success":true,"created":true,"read_back":true,"deleted":true,"absence_verified":true}'::jsonb,
      false
    )
  )
  and (
    status is distinct from 'reconnect_required'
    or sync_status is distinct from 'error'
    or last_error is distinct from
      'Reconnect Google Calendar so Pepper can create and use its dedicated calendar.'
  );

alter table public.calendar_connections
  validate constraint calendar_connections_active_probe_check;

comment on column public.events.last_sync_error is
  'Safe, user-visible summary of the latest outbound calendar synchronization failure.';
comment on column public.events.sync_retry_at is
  'Earliest time an idempotent outbound calendar retry should run.';
comment on column public.events.sync_attempt_count is
  'Number of outbound calendar synchronization attempts for this canonical event.';
comment on column public.calendar_connections.calendar_setup_method is
  'Proof-bearing setup path. Only google_calendars_insert_v1 is eligible for Calendar API writes.';
comment on column public.calendar_connections.calendar_created_at is
  'Time Pepper stored the immutable ID returned by Google Calendars.insert.';
comment on column public.calendar_connections.calendar_mode is
  'Exact runtime mode used to create the dedicated Pepper calendar: sandbox or production.';
comment on column public.calendar_connections.pepper_installation_id is
  'Random non-secret installation UUID generated before Google Calendars.insert.';
comment on column public.calendar_connections.pepper_calendar_marker is
  'Exact Pepper ownership marker stored in the app-created calendar description.';
comment on column public.calendar_connections.google_account_email is
  'Verified Google OIDC email for the account that created the dedicated Pepper calendar.';
comment on column public.calendar_connections.google_account_subject is
  'Verified immutable Google OIDC subject for the account that created the dedicated Pepper calendar.';
comment on column public.calendar_connections.google_data_owner is
  'Google Calendars.get dataOwner returned for the dedicated Pepper calendar.';
comment on column public.calendar_connections.calendar_probe_completed_at is
  'Time the direct synthetic write/read/delete/absence probe completed successfully.';
comment on column public.calendar_connections.calendar_probe_evidence is
  'Sanitized non-secret proof that the direct connection probe completed every required stage.';

create or replace function private.pepper_schedule_calendar_sync(function_url_input text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job_id bigint;
  existing_job_count integer;
  existing_schedule text;
  existing_command text;
  scheduled_job_id bigint;
  command_text text;
begin
  if function_url_input !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/pepper-calendar$' then
    raise exception 'A valid Pepper Calendar Edge Function URL is required.';
  end if;

  if not exists (select 1 from vault.secrets where name = 'pepper_calendar_cron_secret') then
    raise exception 'Vault secret pepper_calendar_cron_secret must be created before scheduling.';
  end if;

  select count(*)::integer into existing_job_count
  from cron.job
  where jobname = 'pepper-calendar-sync';
  if existing_job_count > 1 then
    raise exception 'Duplicate pepper-calendar-sync jobs must be reconciled before scheduling.';
  end if;
  if existing_job_count = 1 then
    select jobid, schedule, command
    into existing_job_id, existing_schedule, existing_command
    from cron.job
    where jobname = 'pepper-calendar-sync';
    if existing_schedule <> '*/10 * * * *'
       or position(function_url_input in existing_command) = 0 then
      raise exception 'Existing pepper-calendar-sync job does not match the reviewed configuration.';
    end if;
    return existing_job_id;
  end if;

  command_text := format($command$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-pepper-cron', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'pepper_calendar_cron_secret' limit 1
        )
      ),
      body := '{"action":"cron"}'::jsonb
    );
  $command$, function_url_input);

  select cron.schedule('pepper-calendar-sync', '*/10 * * * *', command_text)
  into scheduled_job_id;
  return scheduled_job_id;
end;
$$;

revoke all on function private.pepper_schedule_calendar_sync(text) from public, anon, authenticated;
grant execute on function private.pepper_schedule_calendar_sync(text) to service_role;

create or replace function private.pepper_disable_calendar_sync()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job_count integer;
  existing_job_id bigint;
begin
  select count(*)::integer into existing_job_count
  from cron.job
  where jobname = 'pepper-calendar-sync';
  if existing_job_count > 1 then
    raise exception 'Duplicate pepper-calendar-sync jobs require manual reconciliation.';
  end if;
  if existing_job_count = 0 then return false; end if;
  select jobid into existing_job_id
  from cron.job
  where jobname = 'pepper-calendar-sync';
  perform cron.unschedule(existing_job_id);
  return true;
end;
$$;

revoke all on function private.pepper_disable_calendar_sync() from public, anon, authenticated;
grant execute on function private.pepper_disable_calendar_sync() to service_role;
