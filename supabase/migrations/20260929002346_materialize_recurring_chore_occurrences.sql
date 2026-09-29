begin;

alter table public.tasks add column if not exists recurrence_previous_task_id uuid references public.tasks(id);
create unique index if not exists tasks_recurrence_previous_unique
  on public.tasks(recurrence_previous_task_id) where recurrence_previous_task_id is not null;

-- Completion and creation of the next occurrence commit together. Reopen/complete
-- replay never reopens the earlier occurrence or creates a second successor.
create or replace function private.materialize_chore_occurrence()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  next_due timestamp;
begin
  if new.status <> 'completed' or old.status = 'completed'
    or new.deleted_at is not null or new.classification is distinct from 'Chore'
    or new.recurrence not in ('daily','weekly','monthly') or new.due_at is null then
    return new;
  end if;
  next_due := (new.due_at at time zone 'America/Los_Angeles') +
    case new.recurrence when 'daily' then interval '1 day'
      when 'weekly' then interval '7 days' else interval '1 month' end;
  insert into public.tasks(
    household_id,title,owner_member_id,creator_member_id,visibility,status,due_at,
    source,area,project,classification,tags,recurrence,next_action,recurrence_previous_task_id
  ) values (
    new.household_id,new.title,new.owner_member_id,new.creator_member_id,new.visibility,'open',
    next_due at time zone 'America/Los_Angeles',new.source,new.area,new.project,
    new.classification,new.tags,new.recurrence,new.next_action,new.id
  ) on conflict (recurrence_previous_task_id) where recurrence_previous_task_id is not null do nothing;
  return new;
end;
$$;
revoke all on function private.materialize_chore_occurrence() from public, anon, authenticated;
drop trigger if exists materialize_chore_occurrence on public.tasks;
create trigger materialize_chore_occurrence after update of status on public.tasks
  for each row execute function private.materialize_chore_occurrence();
-- A named adult is an assignment, not evidence that the adult accepted it.
create or replace function public.normalize_parent_transport_assignment()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.transport_owner_member_id is not null and new.trusted_driver_id is not null then
    raise exception 'Choose one driver for this ride.';
  end if;
  if new.trusted_driver_id is not null then
    if not exists (select 1 from public.trusted_drivers d where d.id=new.trusted_driver_id
      and d.household_id=new.household_id and d.active=true) then
      raise exception 'Choose an active trusted driver for this household.';
    end if;
  elsif new.transport_owner_member_id is not null then
    if not exists (select 1 from public.household_members m where m.id=new.transport_owner_member_id
      and m.household_id=new.household_id and m.role in ('adult_admin','adult')
      and m.active=true and m.removed_at is null) then
      raise exception 'Choose an active adult driver in this household.';
    end if;
  else
    if new.transport_status is not null or new.kind in ('transport','school_dropoff','school_pickup') then
      new.transport_status := 'unassigned';
    end if;
    return new;
  end if;
  if tg_op='INSERT' then
    new.transport_status := 'assigned';
  elsif new.transport_owner_member_id is distinct from old.transport_owner_member_id
    or new.trusted_driver_id is distinct from old.trusted_driver_id then
    new.transport_status := 'assigned';
  elsif new.transport_status is null or new.transport_status='unassigned' then
    new.transport_status := 'assigned';
  end if;
  return new;
end;
$$;
commit;
