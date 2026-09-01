-- Mirror the production event-reality columns that predate the repository's
-- replayable migration history. This file is for the isolated preview only.

alter table public.events
  add column if not exists external_connection_id uuid null
    references public.calendar_connections(id) on delete set null,
  add column if not exists external_provider text null,
  add column if not exists external_event_id text null,
  add column if not exists external_calendar_id text null,
  add column if not exists external_ical_uid text null,
  add column if not exists external_url text null,
  add column if not exists external_updated_at timestamptz null,
  add column if not exists notes text null,
  add column if not exists response_status text null,
  add column if not exists sync_status text not null default 'local',
  add column if not exists last_synced_at timestamptz null,
  add column if not exists all_day boolean not null default false,
  add column if not exists dedupe_key text null,
  add column if not exists adult_required boolean not null default false,
  add column if not exists adult_requirement_label text null,
  add column if not exists adult_owner_member_id uuid null
    references public.household_members(id) on delete set null,
  add column if not exists adult_requirement_status text null;

create index if not exists events_adult_owner_member_idx
  on public.events(adult_owner_member_id)
  where adult_owner_member_id is not null;

create index if not exists events_calendar_scan_idx
  on public.events(external_connection_id, starts_at, last_synced_at);

create unique index if not exists events_external_google_identity_idx
  on public.events(external_connection_id, external_event_id)
  where external_connection_id is not null and external_event_id is not null;

create index if not exists events_household_dedupe_idx
  on public.events(household_id, dedupe_key)
  where dedupe_key is not null;
