create table if not exists private.family_routines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  person_slug text,
  title text not null,
  location text,
  days_of_week smallint[] not null default '{}',
  starts_local time not null,
  ends_local time,
  kind text not null default 'routine',
  transport_owner_member_id uuid references public.household_members(id),
  active boolean not null default true,
  effective_start date,
  effective_end date,
  importance text not null default 'normal' check (importance in ('normal','high')),
  source text not null default 'pepper',
  confidence numeric(4,3) not null default 1.000 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, person_slug, title)
);
alter table private.family_routines enable row level security;
create index if not exists family_routines_household_active_idx on private.family_routines(household_id, active);

insert into private.family_routines (household_id, person_slug, title, location, days_of_week, starts_local, kind, transport_owner_member_id, effective_start, importance, source)
select h.id, 'posey', 'Posey · School drop-off', 'La Mariposa Elementary School', array[1,2,3,4,5]::smallint[], time '07:50', 'school_dropoff', elle.id, date '2026-08-17', 'high', 'family_state'
from public.households h
join public.household_members elle on elle.household_id=h.id and elle.slug='elle'
where h.slug is not null
on conflict (household_id, person_slug, title) do update set location=excluded.location, days_of_week=excluded.days_of_week, starts_local=excluded.starts_local, transport_owner_member_id=excluded.transport_owner_member_id, active=true, updated_at=now();

insert into private.family_routines (household_id, person_slug, title, location, days_of_week, starts_local, kind, transport_owner_member_id, effective_start, importance, source)
select h.id, 'lyra', 'Lyra · School drop-off', 'Rancho Campana High School', array[1,2,3,4,5]::smallint[], time '08:00', 'school_dropoff', elle.id, date '2026-08-17', 'high', 'family_state'
from public.households h
join public.household_members elle on elle.household_id=h.id and elle.slug='elle'
where h.slug is not null
on conflict (household_id, person_slug, title) do update set location=excluded.location, days_of_week=excluded.days_of_week, starts_local=excluded.starts_local, transport_owner_member_id=excluded.transport_owner_member_id, active=true, updated_at=now();

insert into private.family_routines (household_id, person_slug, title, location, days_of_week, starts_local, kind, transport_owner_member_id, effective_start, importance, source)
select h.id, 'chloe', 'Chloe · School drop-off', 'Las Colinas Middle School', array[1,2,3,4,5]::smallint[], time '08:15', 'school_dropoff', elle.id, date '2026-08-17', 'high', 'family_state'
from public.households h
join public.household_members elle on elle.household_id=h.id and elle.slug='elle'
where h.slug is not null
on conflict (household_id, person_slug, title) do update set location=excluded.location, days_of_week=excluded.days_of_week, starts_local=excluded.starts_local, transport_owner_member_id=excluded.transport_owner_member_id, active=true, updated_at=now();
