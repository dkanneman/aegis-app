create or replace function private.pepper_route_eriksen_costuming_task()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  danielle_member_id uuid;
  task_context text;
begin
  if not exists (
    select 1
    from public.households household
    where household.id = new.household_id
      and household.slug = 'eriksen'
  ) then
    return new;
  end if;

  task_context := lower(concat_ws(
    ' ',
    new.title,
    new.area,
    new.project,
    new.classification,
    new.notes,
    array_to_string(new.tags, ' ')
  ));

  if task_context !~ '(steel[[:space:]]+magnolias|beetlejuice)'
     or task_context !~ '(costume|costuming|wardrobe)' then
    return new;
  end if;

  select member.id
  into danielle_member_id
  from public.household_members member
  where member.household_id = new.household_id
    and member.slug = 'elle'
  limit 1;

  if danielle_member_id is not null then
    new.owner_member_id := danielle_member_id;
    new.visibility := 'private';
    new.area := 'Costuming';
  end if;

  return new;
end;
$function$;

revoke all on function private.pepper_route_eriksen_costuming_task() from public, anon, authenticated;

drop trigger if exists trg_pepper_route_eriksen_costuming_task on public.tasks;
create trigger trg_pepper_route_eriksen_costuming_task
before insert or update of title, area, project, classification, notes, tags, household_id
on public.tasks
for each row execute function private.pepper_route_eriksen_costuming_task();

with matching_tasks as (
  select task.id, danielle.id as danielle_member_id
  from public.tasks task
  join public.households household
    on household.id = task.household_id
   and household.slug = 'eriksen'
  join public.household_members danielle
    on danielle.household_id = household.id
   and danielle.slug = 'elle'
  where lower(concat_ws(
    ' ',
    task.title,
    task.area,
    task.project,
    task.classification,
    task.notes,
    array_to_string(task.tags, ' ')
  )) ~ '(steel[[:space:]]+magnolias|beetlejuice)'
    and lower(concat_ws(
      ' ',
      task.title,
      task.area,
      task.project,
      task.classification,
      task.notes,
      array_to_string(task.tags, ' ')
    )) ~ '(costume|costuming|wardrobe)'
)
update public.tasks task
set owner_member_id = matching_tasks.danielle_member_id,
    visibility = 'private',
    area = 'Costuming',
    updated_at = now()
from matching_tasks
where task.id = matching_tasks.id
  and (
    task.owner_member_id is distinct from matching_tasks.danielle_member_id
    or task.visibility is distinct from 'private'
    or task.area is distinct from 'Costuming'
  );

