create table if not exists private.member_setup_profiles (
  member_id uuid primary key references public.household_members(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  activities text[] not null default '{}'::text[],
  school_name text not null default '',
  grade_label text not null default '',
  dietary_preferences text[] not null default '{}'::text[],
  medications text[] not null default '{}'::text[],
  goals text[] not null default '{}'::text[],
  updated_by_member_id uuid references public.household_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, member_id)
);

alter table private.member_setup_profiles enable row level security;

revoke all on table private.member_setup_profiles from public, anon, authenticated;
grant all on table private.member_setup_profiles to service_role;

create index if not exists member_setup_profiles_household_idx
  on private.member_setup_profiles (household_id, member_id);

comment on table private.member_setup_profiles is
  'Private onboarding context for member activities, family-provided school details, dietary preferences, medications, and goals. Official school schedule truth remains in private.school_profiles and related schedule tables.';

comment on column private.member_setup_profiles.medications is
  'Sensitive member context returned only to the member or an adult household member through the Pepper family API.';

