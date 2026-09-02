create index if not exists meal_plan_shopping_owner_idx
  on public.meal_plan (shopping_owner_member_id)
  where shopping_owner_member_id is not null;

create index if not exists family_meal_needs_member_idx
  on public.family_meal_needs (member_id);

create index if not exists family_meal_needs_created_by_idx
  on public.family_meal_needs (created_by_member_id)
  where created_by_member_id is not null;
