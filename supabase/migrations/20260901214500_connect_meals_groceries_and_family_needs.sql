alter table public.meal_plan
  add column if not exists shopping_owner_member_id uuid
    references public.household_members(id) on delete set null;

alter table public.groceries
  add column if not exists owner_member_id uuid
    references public.household_members(id) on delete set null,
  add column if not exists meal_plan_id uuid
    references public.meal_plan(id) on delete set null;

create table if not exists public.family_meal_needs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  need_type text not null check (need_type in ('allergy', 'avoidance', 'preference', 'nutrition', 'schedule')),
  label text not null check (length(btrim(label)) between 1 and 160),
  details text,
  active boolean not null default true,
  created_by_member_id uuid references public.household_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists family_meal_needs_member_label_key
  on public.family_meal_needs (household_id, member_id, lower(label));
create index if not exists family_meal_needs_household_active_idx
  on public.family_meal_needs (household_id, active, member_id);
create index if not exists groceries_household_owner_status_idx
  on public.groceries (household_id, owner_member_id, status);
create index if not exists groceries_meal_plan_idx
  on public.groceries (meal_plan_id) where meal_plan_id is not null;

alter table public.family_meal_needs enable row level security;

