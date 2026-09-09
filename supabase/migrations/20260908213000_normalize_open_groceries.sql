alter table public.groceries
  add column if not exists origin text;

update public.groceries
set origin = case
  when meal_plan_id is not null
    and owner_member_id is null
    and status = 'open'
    then 'meal_plan'
  else 'manual'
end
where origin is null;

alter table public.groceries
  alter column origin set default 'manual',
  alter column origin set not null;

alter table public.groceries
  drop constraint if exists groceries_origin_check;

alter table public.groceries
  add constraint groceries_origin_check
  check (origin in ('manual', 'meal_plan'));

with duplicate_groups as (
  select
    household_id,
    lower(btrim(item)) as normalized_item,
    (array_agg(
      id
      order by (origin = 'manual') desc, (owner_member_id is not null) desc, created_at, id
    ))[1] as keeper_id,
    (array_agg(owner_member_id order by created_at)
      filter (where owner_member_id is not null))[1] as preserved_owner_member_id,
    (array_agg(meal_plan_id order by created_at desc)
      filter (where meal_plan_id is not null))[1] as preserved_meal_plan_id,
    bool_or(origin = 'manual') as has_manual_origin
  from public.groceries
  where status = 'open'
  group by household_id, lower(btrim(item))
  having count(*) > 1
)
update public.groceries grocery
set
  owner_member_id = coalesce(grocery.owner_member_id, duplicate_groups.preserved_owner_member_id),
  meal_plan_id = coalesce(duplicate_groups.preserved_meal_plan_id, grocery.meal_plan_id),
  origin = case when duplicate_groups.has_manual_origin then 'manual' else 'meal_plan' end,
  updated_at = now()
from duplicate_groups
where grocery.id = duplicate_groups.keeper_id;

with ranked as (
  select
    id,
    row_number() over (
      partition by household_id, lower(btrim(item))
      order by (origin = 'manual') desc, (owner_member_id is not null) desc, created_at, id
    ) as duplicate_rank
  from public.groceries
  where status = 'open'
)
delete from public.groceries grocery
using ranked
where grocery.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists groceries_one_open_item_per_household_idx
  on public.groceries (household_id, (lower(btrim(item))))
  where status = 'open';

comment on column public.groceries.origin is
  'Tracks whether a grocery was entered by a person or generated from the weekly meal plan.';
