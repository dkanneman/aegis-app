-- Preview-only rollback for 20260916120000_sync_published_appointments.sql.
-- Refuses to narrow the delivery status constraint while retry rows remain.
do $$
begin
  if exists (
    select 1 from private.appointment_bridge_deliveries
    where aegis_status in ('retry_required', 'reconnect_required', 'needs_review')
  ) then
    raise exception 'Resolve incomplete AEGIS appointment deliveries before rollback.';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from private.appointment_bridge_deliveries
    where google_status = 'retry_required'
  ) then
    raise exception 'Resolve retry_required appointment deliveries before rollback.';
  end if;
end;
$$;

drop function if exists public.pepper_finish_aegis_sheet_delivery(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz
);
drop function if exists public.pepper_claim_aegis_sheet_delivery(uuid, uuid, jsonb, uuid);
drop index if exists private.appointment_bridge_deliveries_aegis_retry_idx;
drop index if exists private.appointment_bridge_deliveries_household_idx;

alter table private.appointment_bridge_deliveries
  drop constraint if exists appointment_bridge_deliveries_aegis_status_check;
alter table private.appointment_bridge_deliveries
  add constraint appointment_bridge_deliveries_aegis_status_check
  check (aegis_status in ('pending', 'synced', 'failed'));
alter table private.appointment_bridge_deliveries
  drop column if exists aegis_attempt_count,
  drop column if exists aegis_destination,
  drop column if exists aegis_record_id,
  drop column if exists aegis_attempted_at,
  drop column if exists aegis_written_at,
  drop column if exists aegis_verified_at,
  drop column if exists aegis_error_class,
  drop column if exists aegis_lease_token,
  drop column if exists aegis_lease_expires_at;

do $$
begin
  if exists (
    select 1 from public.calendar_connections
    where status = 'reconnect_required'
  ) then
    raise exception 'Reconnect or disconnect reconnect_required calendar connections before rollback.';
  end if;
end;
$$;

do $$
declare
  calendar_job_id bigint;
begin
  select jobid into calendar_job_id
  from cron.job
  where jobname = 'pepper-calendar-sync'
  limit 1;
  if calendar_job_id is not null then
    perform cron.unschedule(calendar_job_id);
  end if;
end;
$$;

drop function if exists private.pepper_schedule_calendar_sync(text);
drop function if exists private.pepper_disable_calendar_sync();

drop trigger if exists zz_tasks_medical_coordination_priority on public.tasks;

create or replace function private.pepper_set_medical_coordination_priority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'pepper_medical_coordination' then
    new.area := 'Family';
    new.project := 'Medical coordination';
    new.priority := 'P0';
    new.classification := 'Medical coordination';
    new.tags := coalesce(new.tags, '{}'::text[]);
    if not ('medical' = any(new.tags)) then new.tags := array_append(new.tags, 'medical'); end if;
    if not ('coordination' = any(new.tags)) then new.tags := array_append(new.tags, 'coordination'); end if;
    new.next_action := coalesce(nullif(new.next_action, ''), new.title);
  end if;
  return new;
end;
$$;

update public.tasks task
set priority = backup.priority,
    area = backup.area,
    project = backup.project,
    classification = backup.classification,
    tags = backup.tags,
    next_action = backup.next_action,
    importance = backup.importance,
    urgency = backup.urgency,
    deadline_type = backup.deadline_type,
    due_date_confidence = backup.due_date_confidence,
    priority_classification_confidence = backup.priority_classification_confidence,
    priority_reason = backup.priority_reason
from private.appointment_release_task_backfill_backup backup
where task.id = backup.task_id;

create trigger zz_tasks_medical_coordination_priority
before insert or update of source, priority, area, project, classification, tags
on public.tasks
for each row execute function private.pepper_set_medical_coordination_priority();

drop table private.appointment_release_task_backfill_backup;

alter table private.appointment_bridge_deliveries
  drop constraint if exists appointment_bridge_deliveries_google_status_check;
alter table private.appointment_bridge_deliveries
  add constraint appointment_bridge_deliveries_google_status_check
  check (google_status in ('pending','synced','skipped','needs_reconnect','failed'));

alter table public.calendar_connections
  drop constraint if exists calendar_connections_status_check;
alter table public.calendar_connections
  add constraint calendar_connections_status_check
  check (status in ('disconnected','connected','error'));

alter table public.calendar_connections
  drop constraint if exists calendar_connections_active_probe_check;
alter table public.calendar_connections
  drop constraint if exists calendar_connections_app_created_proof_check;
alter table public.calendar_connections
  drop column if exists calendar_setup_method,
  drop column if exists calendar_created_at,
  drop column if exists calendar_mode,
  drop column if exists pepper_installation_id,
  drop column if exists pepper_calendar_marker,
  drop column if exists google_account_email,
  drop column if exists google_account_subject,
  drop column if exists google_data_owner,
  drop column if exists calendar_probe_completed_at,
  drop column if exists calendar_probe_evidence;

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
     or google_status_input not in ('pending', 'synced', 'skipped', 'needs_reconnect', 'failed') then
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
      + case when excluded.google_status = 'pending' then 1 else 0 end,
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

drop index if exists public.events_calendar_sync_retry_idx;
alter table public.events
  drop column if exists last_sync_error,
  drop column if exists sync_retry_at,
  drop column if exists sync_attempt_count;
