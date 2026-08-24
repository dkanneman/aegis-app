create table if not exists public.preparation_actions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source_type text not null check (source_type in ('event','future_watch','email')),
  source_event_id uuid null references public.events(id) on delete cascade,
  source_watch_id uuid null,
  source_ref text null,
  source_visibility text not null default 'household' check (source_visibility in ('household','private')),
  owner_member_id uuid null references public.household_members(id) on delete set null,
  category text not null,
  action_kind text not null,
  title text not null,
  summary text not null,
  event_on date not null,
  act_on date not null,
  lead_days integer not null default 0,
  status text not null default 'open' check (status in ('open','handled','dismissed','resolved')),
  confidence numeric not null default 0.8 check (confidence >= 0 and confidence <= 1),
  fingerprint text not null,
  handled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, fingerprint)
);

create index if not exists preparation_actions_household_status_act_on_idx
  on public.preparation_actions (household_id, status, act_on, event_on);

create table if not exists private.member_ritual_preferences (
  member_id uuid primary key references public.household_members(id) on delete cascade,
  morning_brief_enabled boolean not null default false,
  morning_channel text null check (morning_channel in ('app','email')),
  morning_local_time time null,
  evening_reflection_enabled boolean not null default false,
  evening_channel text null check (evening_channel in ('app','email')),
  evening_local_time time null,
  timezone text not null default 'America/Los_Angeles',
  updated_at timestamptz not null default now()
);

create table if not exists private.ritual_delivery_queue (
  id bigserial primary key,
  member_id uuid not null references public.household_members(id) on delete cascade,
  ritual_type text not null check (ritual_type in ('morning_brief','evening_reflection')),
  channel text not null check (channel in ('app','email')),
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','sent','skipped','failed')),
  deep_link text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz null
);

alter table public.preparation_actions enable row level security;
