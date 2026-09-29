alter table public.events
  add column if not exists appointment_type text,
  add column if not exists clinician_name text,
  add column if not exists patient_member_id uuid references public.household_members(id) on delete set null,
  add column if not exists facility_name text,
  add column if not exists preparation_instructions text,
  add column if not exists original_source_text text,
  add column if not exists source_timezone text,
  add column if not exists scheduling_priority integer not null default 50;

alter table public.events
  drop constraint if exists events_appointment_type_check,
  add constraint events_appointment_type_check check (
    appointment_type is null or appointment_type in (
      'doctor',
      'dental',
      'orthodontic',
      'physical_therapy',
      'mental_health_therapy',
      'medical_other'
    )
  ),
  drop constraint if exists events_scheduling_priority_check,
  add constraint events_scheduling_priority_check check (scheduling_priority between 0 and 100);

comment on column public.events.original_source_text is
  'Exact source text retained for appointment review and reconciliation.';
comment on column public.events.source_timezone is
  'IANA timezone used to normalize the source date and time.';
comment on column public.events.scheduling_priority is
  'Medical appointments use 100 and remain fixed when school or work overlaps.';

update public.events event
set appointment_type = case
      when concat_ws(' ', event.kind, event.title, event.location) ~* '\m(physical therapy|physical therapist|physio|PT appointment|PT session|PT visit)\M'
        then 'physical_therapy'
      when concat_ws(' ', event.kind, event.title, event.location) ~* '\m(mental health|psych|counsel|behavioral health|therapy|therapist)\M'
        then 'mental_health_therapy'
      when concat_ws(' ', event.kind, event.title, event.location) ~* '\m(orthodont|braces)'
        then 'orthodontic'
      when concat_ws(' ', event.kind, event.title, event.location) ~* '\m(dental|dentist|dentistry|teeth cleaning)\M'
        then 'dental'
      when concat_ws(' ', event.kind, event.title, event.location) ~* '\m(doctor|physician|pediatric|dermatolog|cardiolog|neurolog|check-up|checkup|physical)'
        then 'doctor'
      else 'medical_other'
    end,
    scheduling_priority = 100,
    patient_member_id = member.id
from public.household_members member
where event.kind = 'appointment'
  and member.household_id = event.household_id
  and member.slug = event.person_slug
  and (
    event.appointment_type is null
    or event.scheduling_priority <> 100
    or event.patient_member_id is null
  );

update public.events
set appointment_type = 'medical_other', scheduling_priority = 100
where kind = 'appointment'
  and (appointment_type is null or scheduling_priority <> 100);

create or replace function private.pepper_set_medical_scheduling_priority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'appointment' or new.appointment_type is not null then
    new.kind := 'appointment';
    new.appointment_type := coalesce(new.appointment_type, 'medical_other');
    new.scheduling_priority := 100;
  end if;

  if new.patient_member_id is null and new.person_slug is not null then
    select member.id into new.patient_member_id
    from public.household_members member
    where member.household_id = new.household_id
      and member.slug = new.person_slug
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists events_medical_scheduling_priority on public.events;
create trigger events_medical_scheduling_priority
before insert or update of kind, appointment_type, scheduling_priority, person_slug
on public.events
for each row execute function private.pepper_set_medical_scheduling_priority();

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

drop trigger if exists zz_tasks_medical_coordination_priority on public.tasks;
create trigger zz_tasks_medical_coordination_priority
before insert or update of source, priority, area, project, classification, tags
on public.tasks
for each row execute function private.pepper_set_medical_coordination_priority();

drop index if exists public.events_household_dedupe_idx;
create unique index if not exists events_household_dedupe_uidx
  on public.events(household_id, dedupe_key)
  where dedupe_key is not null and deleted_at is null;

create table if not exists private.appointment_bridge_deliveries (
  event_id uuid primary key references public.events(id) on delete cascade,
  capture_id uuid not null references public.captures(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  normalized_payload jsonb not null,
  aegis_status text not null default 'pending'
    check (aegis_status in ('pending', 'synced', 'failed')),
  google_status text not null default 'pending'
    check (google_status in ('pending', 'synced', 'skipped', 'needs_reconnect', 'failed')),
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointment_bridge_deliveries_capture_idx
  on private.appointment_bridge_deliveries(capture_id);

revoke all on private.appointment_bridge_deliveries from public, anon, authenticated;

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

revoke all on function public.pepper_record_appointment_bridge(
  uuid, uuid, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.pepper_record_appointment_bridge(
  uuid, uuid, jsonb, text, text, text
) to service_role;
