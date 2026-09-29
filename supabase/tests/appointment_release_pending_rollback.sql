-- Exact test-only rollback for pending production migrations 20260916120000,
-- 20260916150000, 20260917211929, and 20260928230029.
-- Never run this against a hosted project. First set the explicit local-only
-- absent-column-baseline assertion required by the OAuth rollback.

\ir calendar_oauth_return_target_rollback.sql

\ir multi_member_calendar_contributions_rollback.sql
\ir appointment_release_production_rollback.sql

drop function if exists public.pepper_claim_aegis_sheet_delivery(uuid,uuid,jsonb,uuid);
drop function if exists public.pepper_finish_aegis_sheet_delivery(
  uuid,uuid,text,text,text,text,text,timestamptz,timestamptz
);

drop index if exists private.appointment_bridge_deliveries_aegis_retry_idx;
drop index if exists private.appointment_bridge_deliveries_household_idx;

alter table private.appointment_bridge_deliveries
  drop constraint if exists appointment_bridge_deliveries_aegis_status_check;
alter table private.appointment_bridge_deliveries
  add constraint appointment_bridge_deliveries_aegis_status_check
  check (aegis_status in ('pending','synced','failed'));

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

revoke all on function public.pepper_record_appointment_bridge(uuid,uuid,jsonb,text,text,text)
  from public,anon,authenticated;
grant execute on function public.pepper_record_appointment_bridge(uuid,uuid,jsonb,text,text,text)
  to service_role;

drop index if exists public.events_calendar_sync_retry_idx;
alter table public.events
  drop column if exists last_sync_error,
  drop column if exists sync_retry_at,
  drop column if exists sync_attempt_count;

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

drop function if exists private.pepper_schedule_calendar_sync(text);
drop function if exists private.pepper_disable_calendar_sync();
drop table if exists private.appointment_release_task_backfill_backup;
drop table if exists private.appointment_release_calendar_connection_backup;
