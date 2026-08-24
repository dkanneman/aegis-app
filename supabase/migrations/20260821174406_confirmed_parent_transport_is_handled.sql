create or replace function public.normalize_parent_transport_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  owner_role text;
begin
  if new.transport_owner_member_id is null then
    if new.kind = 'transport' then
      new.transport_status := 'unassigned';
    end if;
    return new;
  end if;

  select role into owner_role
  from public.household_members
  where id = new.transport_owner_member_id
    and household_id = new.household_id;

  if owner_role in ('adult_admin','adult') then
    new.transport_status := 'confirmed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_parent_transport_assignment on public.events;
create trigger trg_normalize_parent_transport_assignment
before insert or update of transport_owner_member_id, transport_status, household_id
on public.events
for each row
execute function public.normalize_parent_transport_assignment();

update public.events e
set transport_status = 'confirmed', updated_at = now()
from public.household_members hm
where e.transport_owner_member_id = hm.id
  and e.household_id = hm.household_id
  and hm.role in ('adult_admin','adult')
  and e.transport_status is distinct from 'confirmed';
