-- A member's Today warning choices are private. They never mutate calendar records.
create table private.day_plan_warning_decisions (
  household_id uuid not null references public.households(id),
  member_id uuid not null references public.household_members(id),
  warning_key text not null check (warning_key ~ '^[0-9a-f]{16}$'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$'),
  decision text not null check (decision in ('dismissed', 'snoozed')),
  snoozed_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (member_id, warning_key),
  check ((decision = 'snoozed') = (snoozed_until is not null))
);

alter table private.day_plan_warning_decisions enable row level security;
revoke all on private.day_plan_warning_decisions from public, anon, authenticated;
grant select, insert, update, delete on private.day_plan_warning_decisions to service_role;
