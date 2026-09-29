-- Refuse to discard occurrence lineage after feature use. A later authorized
-- rollback must retain created tasks and explicitly reconcile their lineage.
begin;
do $$ begin
  if exists (select 1 from public.tasks where recurrence_previous_task_id is not null) then
    raise exception 'Recurring chores have been used; preserve occurrences and review rollback first';
  end if;
end $$;
drop trigger if exists materialize_chore_occurrence on public.tasks;
drop function if exists private.materialize_chore_occurrence();
alter table public.tasks drop column recurrence_previous_task_id;
create or replace function public.normalize_parent_transport_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  owner_role text;
  trusted_driver_valid boolean;
begin
  if new.transport_owner_member_id is not null and new.trusted_driver_id is not null then
    raise exception 'Choose one driver for this ride.';
  end if;

  if new.trusted_driver_id is not null then
    select exists (
      select 1
      from public.trusted_drivers driver
      where driver.id = new.trusted_driver_id
        and driver.household_id = new.household_id
        and driver.active = true
    ) into trusted_driver_valid;

    if not trusted_driver_valid then
      raise exception 'Choose an active trusted driver for this household.';
    end if;

    new.transport_status := 'confirmed';
    return new;
  end if;

  if new.transport_owner_member_id is null then
    if new.kind in ('transport','school_dropoff','school_pickup') then
      new.transport_status := 'unassigned';
    end if;
    return new;
  end if;

  select role into owner_role
  from public.household_members
  where id = new.transport_owner_member_id
    and household_id = new.household_id;

  if owner_role not in ('adult_admin','adult') or owner_role is null then
    raise exception 'Choose an adult driver in this household.';
  end if;

  new.transport_status := 'confirmed';
  return new;
end;
$$;
commit;
