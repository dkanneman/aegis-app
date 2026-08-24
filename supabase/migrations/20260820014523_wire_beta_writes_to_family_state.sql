create or replace function public.pepper_record_event_state_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_subject_member_id uuid;
  v_change_type text;
  v_summary text;
begin
  select hm.id into v_subject_member_id
  from public.household_members hm
  where hm.household_id = new.household_id
    and hm.slug = new.person_slug
  limit 1;

  if tg_op = 'INSERT' then
    v_change_type := 'event_created';
    v_summary := new.title || ' was added to the family plan.';
  elsif old.status is distinct from new.status then
    v_change_type := 'event_status_changed';
    v_summary := new.title || ' changed from ' || coalesce(old.status,'unknown') || ' to ' || coalesce(new.status,'unknown') || '.';
  elsif old.transport_owner_member_id is distinct from new.transport_owner_member_id then
    v_change_type := 'transport_owner_changed';
    v_summary := case when new.transport_owner_member_id is null
      then new.title || ' now needs a transportation owner.'
      else new.title || ' transportation ownership changed.' end;
  elsif old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at then
    v_change_type := 'event_time_changed';
    v_summary := new.title || ' timing changed.';
  else
    v_change_type := 'event_updated';
    v_summary := new.title || ' was updated.';
  end if;

  insert into public.state_changes(
    household_id, entity_type, entity_id, change_type,
    before_state, after_state, consequence_summary, confidence, source, occurred_at
  ) values (
    new.household_id, 'event', new.id::text, v_change_type,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    to_jsonb(new), v_summary, 1.000, coalesce(new.source,'pepper'), now()
  );

  if new.transport_owner_member_id is not null
     or new.transport_status is not null
     or new.kind = 'transport' then
    insert into public.responsibilities(
      household_id, responsibility_type, subject_member_id, owner_member_id,
      event_id, status, starts_at, ends_at, source, confidence, updated_at
    ) values (
      new.household_id, 'transportation', v_subject_member_id, new.transport_owner_member_id,
      new.id,
      case
        when new.status='canceled' then 'canceled'
        when new.transport_status='completed' then 'completed'
        when new.transport_status='confirmed' then 'confirmed'
        when new.transport_owner_member_id is not null then 'assigned'
        else 'unassigned'
      end,
      new.starts_at, new.ends_at, coalesce(new.source,'pepper'), 1.000, now()
    )
    on conflict (household_id,event_id,responsibility_type) where event_id is not null
    do update set
      subject_member_id=excluded.subject_member_id,
      owner_member_id=excluded.owner_member_id,
      status=excluded.status,
      starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,
      source=excluded.source,
      confidence=excluded.confidence,
      updated_at=now();
  end if;

  return new;
end;
$$;

create or replace function public.pepper_record_task_state_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_change_type text;
  v_summary text;
begin
  if tg_op = 'INSERT' then
    v_change_type := 'task_created';
    v_summary := new.title || ' was added.';
  elsif old.status is distinct from new.status then
    v_change_type := 'task_status_changed';
    v_summary := new.title || ' changed to ' || new.status || '.';
  elsif old.owner_member_id is distinct from new.owner_member_id then
    v_change_type := 'task_owner_changed';
    v_summary := case when new.owner_member_id is null
      then new.title || ' now needs an owner.'
      else new.title || ' ownership changed.' end;
  else
    v_change_type := 'task_updated';
    v_summary := new.title || ' was updated.';
  end if;

  insert into public.state_changes(
    household_id, entity_type, entity_id, change_type,
    before_state, after_state, consequence_summary, confidence, source, occurred_at
  ) values (
    new.household_id, 'task', new.id::text, v_change_type,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    to_jsonb(new), v_summary, 1.000, coalesce(new.source,'pepper'), now()
  );

  insert into public.responsibilities(
    household_id, responsibility_type, owner_member_id, task_id,
    status, starts_at, source, confidence, updated_at
  ) values (
    new.household_id, 'task', new.owner_member_id, new.id,
    case
      when new.status='completed' then 'completed'
      when new.status='canceled' then 'canceled'
      when new.owner_member_id is null then 'unassigned'
      else 'assigned'
    end,
    new.due_at, coalesce(new.source,'pepper'), 1.000, now()
  )
  on conflict do nothing;

  update public.responsibilities
  set owner_member_id=new.owner_member_id,
      status=case
        when new.status='completed' then 'completed'
        when new.status='canceled' then 'canceled'
        when new.owner_member_id is null then 'unassigned'
        else 'assigned'
      end,
      starts_at=new.due_at,
      source=coalesce(new.source,'pepper'),
      updated_at=now()
  where household_id=new.household_id
    and task_id=new.id
    and responsibility_type='task';

  return new;
end;
$$;

create unique index if not exists responsibilities_task_type_unique
  on public.responsibilities(household_id, task_id, responsibility_type)
  where task_id is not null;

drop trigger if exists trg_pepper_event_family_state on public.events;
create trigger trg_pepper_event_family_state
after insert or update on public.events
for each row execute function public.pepper_record_event_state_change();

drop trigger if exists trg_pepper_task_family_state on public.tasks;
create trigger trg_pepper_task_family_state
after insert or update on public.tasks
for each row execute function public.pepper_record_task_state_change();

insert into public.responsibilities(
  household_id,responsibility_type,subject_member_id,owner_member_id,event_id,status,starts_at,ends_at,source,confidence
)
select e.household_id,'transportation',hm.id,e.transport_owner_member_id,e.id,
  case
    when e.status='canceled' then 'canceled'
    when e.transport_status='completed' then 'completed'
    when e.transport_status='confirmed' then 'confirmed'
    when e.transport_owner_member_id is not null then 'assigned'
    else 'unassigned'
  end,
  e.starts_at,e.ends_at,coalesce(e.source,'pepper'),1.000
from public.events e
left join public.household_members hm on hm.household_id=e.household_id and hm.slug=e.person_slug
where e.transport_owner_member_id is not null or e.transport_status is not null or e.kind='transport'
on conflict (household_id,event_id,responsibility_type) where event_id is not null do nothing;

insert into public.responsibilities(
  household_id,responsibility_type,owner_member_id,task_id,status,starts_at,source,confidence
)
select t.household_id,'task',t.owner_member_id,t.id,
  case
    when t.status='completed' then 'completed'
    when t.status='canceled' then 'canceled'
    when t.owner_member_id is null then 'unassigned'
    else 'assigned'
  end,
  t.due_at,coalesce(t.source,'pepper'),1.000
from public.tasks t
on conflict (household_id,task_id,responsibility_type) where task_id is not null do nothing;
