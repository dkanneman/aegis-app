create table if not exists private.family_rotations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  rotation_key text not null,
  label text not null,
  anchor_date date not null,
  participant_member_ids uuid[] not null,
  created_by_member_id uuid references public.household_members(id) on delete set null,
  updated_by_member_id uuid references public.household_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, rotation_key),
  check (cardinality(participant_member_ids) >= 2)
);

create table if not exists private.family_rotation_days (
  id uuid primary key default gen_random_uuid(),
  rotation_id uuid not null references private.family_rotations(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  rotation_date date not null,
  assigned_member_id uuid not null references public.household_members(id) on delete cascade,
  status text not null default 'planned' check (status in ('planned', 'confirmed')),
  source text not null default 'manual' check (source in ('rotation', 'manual')),
  updated_by_member_id uuid references public.household_members(id) on delete set null,
  confirmed_by_member_id uuid references public.household_members(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rotation_id, rotation_date)
);

alter table private.family_rotations enable row level security;
alter table private.family_rotation_days enable row level security;

revoke all on table private.family_rotations from public, anon, authenticated;
revoke all on table private.family_rotation_days from public, anon, authenticated;
grant all on table private.family_rotations to service_role;
grant all on table private.family_rotation_days to service_role;

create index if not exists family_rotations_household_idx
  on private.family_rotations (household_id, rotation_key);

create index if not exists family_rotation_days_household_date_idx
  on private.family_rotation_days (household_id, rotation_date);

comment on table private.family_rotations is
  'Canonical household turn-taking rules. Pepper derives routine days from the anchor and ordered participants.';

comment on table private.family_rotation_days is
  'Persisted exceptions and confirmations for a family rotation. Routine assignments remain derived rather than copied into every day.';

with eriksen_front_seat as (
  select
    h.id as household_id,
    array_agg(m.id order by case m.slug when 'posey' then 1 when 'chloe' then 2 when 'lyra' then 3 end)
      filter (where m.slug in ('posey', 'chloe', 'lyra')) as participant_member_ids,
    (array_agg(m.id) filter (where m.slug = 'elle'))[1] as created_by_member_id
  from public.households h
  join public.household_members m on m.household_id = h.id
  where h.slug = 'eriksen'
    and m.slug in ('posey', 'chloe', 'lyra', 'elle')
  group by h.id
)
insert into private.family_rotations (
  household_id,
  rotation_key,
  label,
  anchor_date,
  participant_member_ids,
  created_by_member_id,
  updated_by_member_id
)
select
  household_id,
  'front-seat',
  'Front seat',
  date '2026-09-02',
  participant_member_ids,
  created_by_member_id,
  created_by_member_id
from eriksen_front_seat
where cardinality(participant_member_ids) = 3
on conflict (household_id, rotation_key) do update
set anchor_date = excluded.anchor_date,
    participant_member_ids = excluded.participant_member_ids,
    updated_by_member_id = excluded.updated_by_member_id,
    updated_at = now();
