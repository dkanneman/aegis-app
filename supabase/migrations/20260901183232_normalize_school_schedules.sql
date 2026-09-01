create table if not exists private.school_profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  student_member_id uuid not null references public.household_members(id) on delete cascade,
  academic_year text not null check (academic_year ~ '^[0-9]{4}-[0-9]{2}$'),
  school_name text not null,
  district_name text not null,
  grade_label text,
  timezone text not null default 'America/Los_Angeles',
  family_arrival_target_local time,
  first_bell_local time,
  normal_dismissal_local time not null,
  first_day date not null,
  last_day date not null,
  source_label text not null,
  source_url text not null check (source_url ~ '^https://'),
  source_checked_on date not null,
  confidence numeric(4,3) not null default 1.000
    check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (first_day <= last_day),
  unique (household_id, student_member_id, academic_year)
);

create table if not exists private.school_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  school_profile_id uuid not null references private.school_profiles(id) on delete cascade,
  rule_kind text not null
    check (rule_kind in ('normal_day', 'recurring_early_release')),
  title text not null,
  days_of_week smallint[] not null,
  dismissal_local time not null,
  starts_on date not null,
  ends_on date not null,
  transportation_impact boolean not null default true,
  source_label text not null,
  source_url text not null check (source_url ~ '^https://'),
  source_checked_on date not null,
  confidence numeric(4,3) not null default 1.000
    check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(days_of_week) > 0),
  check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  check (starts_on <= ends_on),
  unique (school_profile_id, rule_kind, title)
);

create table if not exists private.school_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  school_profile_id uuid not null references private.school_profiles(id) on delete cascade,
  exception_date date not null,
  exception_type text not null
    check (exception_type in (
      'no_school',
      'special_schedule',
      'minimum_day',
      'finals',
      'early_release'
    )),
  title text not null,
  attendance_required boolean not null,
  dismissal_local time,
  transportation_impact boolean not null default true,
  source_label text not null,
  source_url text not null check (source_url ~ '^https://'),
  schedule_source_label text,
  schedule_source_url text check (
    schedule_source_url is null or schedule_source_url ~ '^https://'
  ),
  source_checked_on date not null,
  confidence numeric(4,3) not null default 1.000
    check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (exception_type = 'no_school' and attendance_required = false and dismissal_local is null)
    or
    (exception_type <> 'no_school' and attendance_required = true and dismissal_local is not null)
  ),
  unique (school_profile_id, exception_date)
);

alter table private.school_profiles enable row level security;
alter table private.school_schedule_rules enable row level security;
alter table private.school_schedule_exceptions enable row level security;

revoke all on table private.school_profiles from public, anon, authenticated;
revoke all on table private.school_schedule_rules from public, anon, authenticated;
revoke all on table private.school_schedule_exceptions from public, anon, authenticated;

create index if not exists school_profiles_household_year_idx
  on private.school_profiles(household_id, academic_year);

create index if not exists school_schedule_rules_profile_dates_idx
  on private.school_schedule_rules(school_profile_id, starts_on, ends_on);

create index if not exists school_schedule_exceptions_profile_date_idx
  on private.school_schedule_exceptions(school_profile_id, exception_date);

create or replace function private.resolve_school_schedule(
  household_id_input uuid,
  starts_on_input date,
  ends_on_input date
)
returns table (
  school_profile_id uuid,
  household_id uuid,
  student_member_id uuid,
  person_slug text,
  display_name text,
  school_name text,
  district_name text,
  grade_label text,
  schedule_date date,
  day_starts_at timestamptz,
  dismissal_at timestamptz,
  dismissal_local time,
  schedule_kind text,
  schedule_title text,
  attendance_required boolean,
  transportation_impact boolean,
  precedence smallint,
  resolution_level text,
  source_label text,
  source_url text,
  schedule_source_label text,
  schedule_source_url text,
  source_checked_on date
)
language sql
stable
security invoker
set search_path to public, private, pg_temp
as $$
  select
    p.id,
    p.household_id,
    p.student_member_id,
    m.slug,
    m.display_name,
    p.school_name,
    p.district_name,
    p.grade_label,
    d.schedule_date,
    (d.schedule_date::timestamp at time zone p.timezone),
    case
      when exception_row.exception_type = 'no_school' then null
      else (
        d.schedule_date + coalesce(exception_row.dismissal_local, rule_row.dismissal_local)
      ) at time zone p.timezone
    end,
    coalesce(exception_row.dismissal_local, rule_row.dismissal_local),
    coalesce(exception_row.exception_type, rule_row.rule_kind),
    coalesce(exception_row.title, rule_row.title),
    coalesce(exception_row.attendance_required, true),
    coalesce(exception_row.transportation_impact, rule_row.transportation_impact, false),
    case
      when exception_row.exception_type = 'no_school' then 400
      when exception_row.id is not null then 300
      when rule_row.rule_kind = 'recurring_early_release' then 200
      else 100
    end::smallint,
    case
      when exception_row.id is not null then 'dated_exception'
      when rule_row.rule_kind = 'recurring_early_release' then 'recurring_rule'
      else 'normal_rule'
    end,
    coalesce(exception_row.source_label, rule_row.source_label),
    coalesce(exception_row.source_url, rule_row.source_url),
    exception_row.schedule_source_label,
    exception_row.schedule_source_url,
    coalesce(exception_row.source_checked_on, rule_row.source_checked_on)
  from private.school_profiles p
  join public.household_members m
    on m.id = p.student_member_id
   and m.household_id = p.household_id
  cross join lateral (
    select generated_day::date as schedule_date
    from generate_series(
      greatest(p.first_day, starts_on_input)::timestamp,
      least(p.last_day, ends_on_input)::timestamp,
      interval '1 day'
    ) generated_day
  ) d
  left join lateral (
    select e.*
    from private.school_schedule_exceptions e
    where e.school_profile_id = p.id
      and e.exception_date = d.schedule_date
    order by case when e.exception_type = 'no_school' then 2 else 1 end desc
    limit 1
  ) exception_row on true
  left join lateral (
    select r.*
    from private.school_schedule_rules r
    where exception_row.id is null
      and r.school_profile_id = p.id
      and d.schedule_date between r.starts_on and r.ends_on
      and extract(dow from d.schedule_date)::smallint = any(r.days_of_week)
    order by case when r.rule_kind = 'recurring_early_release' then 2 else 1 end desc
    limit 1
  ) rule_row on true
  where p.household_id = household_id_input
    and starts_on_input <= ends_on_input
    and (exception_row.id is not null or rule_row.id is not null)
  order by d.schedule_date, 17 desc, m.display_name;
$$;

revoke all on function private.resolve_school_schedule(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.resolve_school_schedule(uuid, date, date)
  to service_role;
