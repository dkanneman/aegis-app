alter table private.appointment_bridge_deliveries
  add column if not exists aegis_attempt_count integer not null default 0,
  add column if not exists aegis_destination text,
  add column if not exists aegis_record_id text,
  add column if not exists aegis_attempted_at timestamptz,
  add column if not exists aegis_written_at timestamptz,
  add column if not exists aegis_verified_at timestamptz,
  add column if not exists aegis_error_class text,
  add column if not exists aegis_lease_token uuid,
  add column if not exists aegis_lease_expires_at timestamptz;

alter table private.appointment_bridge_deliveries
  drop constraint if exists appointment_bridge_deliveries_aegis_status_check;

alter table private.appointment_bridge_deliveries
  add constraint appointment_bridge_deliveries_aegis_status_check
  check (aegis_status in (
    'pending', 'synced', 'retry_required', 'reconnect_required', 'needs_review', 'failed'
  ));

create index if not exists appointment_bridge_deliveries_aegis_retry_idx
  on private.appointment_bridge_deliveries(aegis_status, aegis_attempted_at)
  where aegis_status in ('retry_required', 'reconnect_required', 'needs_review', 'failed');

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
  if aegis_status_input not in (
       'pending', 'synced', 'retry_required', 'reconnect_required', 'needs_review', 'failed'
     )
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

create or replace function public.pepper_claim_aegis_sheet_delivery(
  event_id_input uuid,
  capture_id_input uuid,
  normalized_payload_input jsonb,
  lease_token_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery private.appointment_bridge_deliveries%rowtype;
  household_id_value uuid;
  capture_household_id_value uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service authorization required.' using errcode = '42501';
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
    aegis_status, google_status, updated_at
  ) values (
    event_id_input, capture_id_input, household_id_value, normalized_payload_input,
    'pending', 'pending', now()
  ) on conflict (event_id) do update set
    capture_id = excluded.capture_id,
    normalized_payload = excluded.normalized_payload,
    updated_at = now();

  select * into delivery
  from private.appointment_bridge_deliveries
  where event_id = event_id_input
  for update;

  if delivery.aegis_lease_token is not null
     and delivery.aegis_lease_token is distinct from lease_token_input
     and delivery.aegis_lease_expires_at > now() then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'delivery_busy',
      'retry_after', delivery.aegis_lease_expires_at
    );
  end if;

  update private.appointment_bridge_deliveries set
    aegis_status = 'pending',
    aegis_attempt_count = aegis_attempt_count + 1,
    aegis_attempted_at = now(),
    aegis_lease_token = lease_token_input,
    aegis_lease_expires_at = now() + interval '2 minutes',
    aegis_error_class = null,
    last_error = null,
    updated_at = now()
  where event_id = event_id_input;

  return jsonb_build_object(
    'claimed', true,
    'lease_token', lease_token_input,
    'event_id', event_id_input
  );
end;
$$;

create or replace function public.pepper_finish_aegis_sheet_delivery(
  event_id_input uuid,
  lease_token_input uuid,
  aegis_status_input text,
  destination_input text,
  record_id_input text,
  error_class_input text default null,
  last_error_input text default null,
  written_at_input timestamptz default null,
  verified_at_input timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery private.appointment_bridge_deliveries%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service authorization required.' using errcode = '42501';
  end if;
  if aegis_status_input not in (
       'synced', 'retry_required', 'reconnect_required', 'needs_review', 'failed'
     ) then
    raise exception 'Invalid AEGIS delivery status.' using errcode = '22023';
  end if;

  select * into delivery
  from private.appointment_bridge_deliveries
  where event_id = event_id_input
  for update;
  if delivery.event_id is null or delivery.aegis_lease_token is distinct from lease_token_input then
    raise exception 'AEGIS delivery lease is missing or stale.' using errcode = '55000';
  end if;
  if aegis_status_input = 'synced'
     and (written_at_input is null or verified_at_input is null) then
    raise exception 'AEGIS cannot be marked synced without write and readback timestamps.' using errcode = '22023';
  end if;

  update private.appointment_bridge_deliveries set
    aegis_status = aegis_status_input,
    aegis_destination = left(destination_input, 300),
    aegis_record_id = left(record_id_input, 300),
    aegis_written_at = written_at_input,
    aegis_verified_at = verified_at_input,
    aegis_error_class = left(error_class_input, 100),
    last_error = left(last_error_input, 500),
    aegis_lease_token = null,
    aegis_lease_expires_at = null,
    updated_at = now()
  where event_id = event_id_input;

  insert into public.audit_log (
    household_id, capture_id, event_type, entity_type, entity_id, summary, dedupe_key
  ) values (
    delivery.household_id, delivery.capture_id,
    case when aegis_status_input = 'synced' then 'aegis.appointment_verified' else 'aegis.appointment_incomplete' end,
    'event', event_id_input::text,
    case
      when aegis_status_input = 'synced' then 'AEGIS sandbox write completed and readback verified.'
      else 'AEGIS sandbox delivery remains incomplete: ' || aegis_status_input
    end,
    'aegis-appointment:' || event_id_input::text || ':' || delivery.aegis_attempt_count::text
  );

  return jsonb_build_object(
    'event_id', event_id_input,
    'aegis_status', aegis_status_input,
    'verified', aegis_status_input = 'synced'
  );
end;
$$;

revoke all on function public.pepper_claim_aegis_sheet_delivery(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.pepper_claim_aegis_sheet_delivery(uuid, uuid, jsonb, uuid)
  to service_role;
revoke all on function public.pepper_finish_aegis_sheet_delivery(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.pepper_finish_aegis_sheet_delivery(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz
) to service_role;

comment on column private.appointment_bridge_deliveries.aegis_verified_at is
  'Set only after the external AEGIS sandbox row is read back and matches the canonical appointment.';
