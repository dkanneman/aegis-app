create or replace function public.pepper_apply_action(
  session_token_input uuid,
  action_input text,
  payload_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  current_member uuid;
  current_household uuid;
  member_role_value text;
  entity_id uuid;
  owner_id uuid;
  previous_status text;
  next_status text;
  title_value text;
  visibility_value text;
  reflection_type text;
  starts_value timestamptz;
  ends_value timestamptz;
  meal_record public.meal_plan%rowtype;
begin
  if payload_input is null then
    payload_input := '{}'::jsonb;
  end if;
  if length(payload_input::text) > 10000 then
    raise exception 'Update is too large.' using errcode = '22023';
  end if;

  current_member := private.pepper_set_session(session_token_input);
  current_household := private.pepper_current_household_id();
  member_role_value := private.pepper_current_role();
  perform private.pepper_touch_session(session_token_input);

  if action_input = 'session.end' then
    perform private.pepper_end_session(session_token_input);
    return jsonb_build_object('ok', true, 'action', action_input);
  end if;

  if action_input = 'task.toggle' then
    entity_id := (payload_input ->> 'id')::uuid;
    select t.status into previous_status from public.tasks t where t.id = entity_id;
    if not found then raise exception 'Task not found or not permitted.' using errcode = '42501'; end if;
    next_status := case when previous_status = 'completed' then 'open' else 'completed' end;
    update public.tasks set status = next_status where id = entity_id;

  elsif action_input = 'task.assign' then
    if member_role_value not in ('adult_admin', 'adult') then
      raise exception 'Only an adult can reassign a family responsibility.' using errcode = '42501';
    end if;
    entity_id := (payload_input ->> 'id')::uuid;
    owner_id := (payload_input ->> 'owner_member_id')::uuid;
    if not exists (
      select 1 from public.household_members m
      where m.id = owner_id and m.household_id = current_household
    ) then
      raise exception 'Family member not found.' using errcode = '22023';
    end if;
    update public.tasks set owner_member_id = owner_id where id = entity_id;
    if not found then raise exception 'Task not found or not permitted.' using errcode = '42501'; end if;

  elsif action_input = 'task.create' then
    title_value := left(trim(coalesce(payload_input ->> 'title', '')), 240);
    if title_value = '' then raise exception 'A task needs a title.' using errcode = '22023'; end if;
    owner_id := coalesce(nullif(payload_input ->> 'owner_member_id', '')::uuid, current_member);
    if member_role_value not in ('adult_admin', 'adult') then owner_id := current_member; end if;
    if not exists (
      select 1 from public.household_members m
      where m.id = owner_id and m.household_id = current_household
    ) then
      raise exception 'Family member not found.' using errcode = '22023';
    end if;
    visibility_value := case when payload_input ->> 'visibility' = 'private' then 'private' else 'household' end;
    insert into public.tasks (
      household_id, title, owner_member_id, creator_member_id, visibility, status, due_at, source
    ) values (
      current_household,
      title_value,
      owner_id,
      current_member,
      visibility_value,
      'open',
      nullif(payload_input ->> 'due_at', '')::timestamptz,
      'pepper'
    ) returning id into entity_id;

  elsif action_input = 'event.assign_transport' then
    if member_role_value not in ('adult_admin', 'adult') then
      raise exception 'Only an adult can change a driver.' using errcode = '42501';
    end if;
    entity_id := (payload_input ->> 'id')::uuid;
    owner_id := nullif(payload_input ->> 'owner_member_id', '')::uuid;
    if owner_id is not null and not exists (
      select 1 from public.household_members m
      where m.id = owner_id
        and m.household_id = current_household
        and m.role in ('adult_admin', 'adult')
    ) then
      raise exception 'Choose an adult driver in this household.' using errcode = '22023';
    end if;
    update public.events
    set transport_owner_member_id = owner_id,
        transport_status = case when owner_id is null then 'unassigned' else 'assigned' end
    where id = entity_id;
    if not found then raise exception 'Event not found or not permitted.' using errcode = '42501'; end if;

  elsif action_input = 'event.status' then
    if member_role_value not in ('adult_admin', 'adult') then
      raise exception 'Only an adult can change a family event.' using errcode = '42501';
    end if;
    entity_id := (payload_input ->> 'id')::uuid;
    next_status := payload_input ->> 'status';
    if next_status not in ('tentative','confirmed','canceled','completed') then
      raise exception 'Invalid event status.' using errcode = '22023';
    end if;
    update public.events set status = next_status where id = entity_id;
    if not found then raise exception 'Event not found or not permitted.' using errcode = '42501'; end if;

  elsif action_input = 'event.create' then
    title_value := left(trim(coalesce(payload_input ->> 'title', '')), 240);
    if title_value = '' then raise exception 'An event needs a title.' using errcode = '22023'; end if;
    starts_value := (payload_input ->> 'starts_at')::timestamptz;
    ends_value := nullif(payload_input ->> 'ends_at', '')::timestamptz;
    if ends_value is not null and ends_value < starts_value then
      raise exception 'Event end time cannot be before its start.' using errcode = '22023';
    end if;
    visibility_value := case when payload_input ->> 'visibility' = 'private' then 'private' else 'household' end;
    insert into public.events (
      household_id, title, person_slug, starts_at, ends_at, location, status,
      visibility, owner_member_id, kind, source
    ) values (
      current_household,
      title_value,
      case when member_role_value in ('adult_admin','adult')
        then nullif(payload_input ->> 'person_slug', '')
        else private.pepper_current_slug()
      end,
      starts_value,
      ends_value,
      left(nullif(trim(payload_input ->> 'location'), ''), 240),
      'confirmed',
      visibility_value,
      current_member,
      left(coalesce(nullif(payload_input ->> 'kind', ''), 'event'), 40),
      'pepper'
    ) returning id into entity_id;

  elsif action_input = 'event.move' then
    entity_id := (payload_input ->> 'id')::uuid;
    starts_value := (payload_input ->> 'starts_at')::timestamptz;
    ends_value := nullif(payload_input ->> 'ends_at', '')::timestamptz;
    update public.events
    set starts_at = starts_value,
        ends_at = case when ends_value is null or ends_value >= starts_value then ends_value else ends_at end
    where id = entity_id;
    if not found then raise exception 'Event not found or not permitted.' using errcode = '42501'; end if;

  elsif action_input = 'meal.update' then
    if member_role_value not in ('adult_admin', 'adult') then
      raise exception 'Only an adult can change the dinner plan.' using errcode = '42501';
    end if;
    if nullif(payload_input ->> 'owner_member_id', '') is not null then
      owner_id := (payload_input ->> 'owner_member_id')::uuid;
      if not exists (
        select 1 from public.household_members m
        where m.id = owner_id and m.household_id = current_household
      ) then
        raise exception 'Dinner owner must be in this household.' using errcode = '22023';
      end if;
    end if;
    if nullif(payload_input ->> 'shopping_owner_member_id', '') is not null then
      owner_id := (payload_input ->> 'shopping_owner_member_id')::uuid;
      if not exists (
        select 1 from public.household_members m
        where m.id = owner_id and m.household_id = current_household
      ) then
        raise exception 'Shopping owner must be in this household.' using errcode = '22023';
      end if;
    end if;
    if nullif(payload_input ->> 'id', '') is not null then
      select * into meal_record from public.meal_plan where id = (payload_input ->> 'id')::uuid;
    else
      select * into meal_record from public.meal_plan
      where meal_date = (now() at time zone 'America/Los_Angeles')::date
      limit 1;
    end if;

    if meal_record.id is null then
      insert into public.meal_plan (
        household_id, meal_date, meal_name, prep_at, eat_at,
        owner_member_id, shopping_owner_member_id
      ) values (
        current_household,
        (now() at time zone 'America/Los_Angeles')::date,
        left(coalesce(nullif(trim(payload_input ->> 'meal_name'), ''), 'Dinner'), 240),
        nullif(payload_input ->> 'prep_at', '')::timestamptz,
        nullif(payload_input ->> 'eat_at', '')::timestamptz,
        coalesce(nullif(payload_input ->> 'owner_member_id', '')::uuid, current_member),
        nullif(payload_input ->> 'shopping_owner_member_id', '')::uuid
      ) returning * into meal_record;
    else
      update public.meal_plan
      set meal_name = case when payload_input ? 'meal_name'
          then left(trim(payload_input ->> 'meal_name'), 240) else meal_name end,
          prep_at = case when payload_input ? 'prep_at'
          then nullif(payload_input ->> 'prep_at', '')::timestamptz else prep_at end,
          eat_at = case when payload_input ? 'eat_at'
          then nullif(payload_input ->> 'eat_at', '')::timestamptz else eat_at end,
          owner_member_id = case when payload_input ? 'owner_member_id'
          then nullif(payload_input ->> 'owner_member_id', '')::uuid else owner_member_id end,
          shopping_owner_member_id = case when payload_input ? 'shopping_owner_member_id'
          then nullif(payload_input ->> 'shopping_owner_member_id', '')::uuid else shopping_owner_member_id end
      where id = meal_record.id
      returning * into meal_record;
    end if;
    entity_id := meal_record.id;

  elsif action_input = 'grocery.toggle' then
    entity_id := (payload_input ->> 'id')::uuid;
    select g.status into previous_status from public.groceries g where g.id = entity_id;
    if not found then raise exception 'Grocery item not found.' using errcode = '42501'; end if;
    next_status := case when previous_status = 'completed' then 'open' else 'completed' end;
    update public.groceries
    set status = next_status,
        completed_by_member_id = case when next_status = 'completed' then current_member else null end
    where id = entity_id;

  elsif action_input = 'grocery.add' then
    title_value := left(trim(coalesce(payload_input ->> 'item', '')), 160);
    if title_value = '' then raise exception 'A grocery item needs a name.' using errcode = '22023'; end if;
    insert into public.groceries (household_id, item, status, added_by_member_id)
    values (current_household, title_value, 'open', current_member)
    returning id into entity_id;

  elsif action_input = 'reflection.add' then
    title_value := left(trim(coalesce(payload_input ->> 'text', '')), 4000);
    if title_value = '' then raise exception 'Add one true thought first.' using errcode = '22023'; end if;
    reflection_type := case payload_input ->> 'type'
      when 'gratitude' then 'gratitude'
      when 'good_moment' then 'good_moment'
      when 'memory' then 'memory'
      when 'lesson' then 'lesson'
      when 'concern' then 'concern'
      when 'win' then 'win'
      else 'reflection'
    end;
    insert into public.reflections (
      household_id, member_id, reflection_date, type, original_text
    ) values (
      current_household,
      current_member,
      (now() at time zone 'America/Los_Angeles')::date,
      reflection_type,
      title_value
    ) returning id into entity_id;

  else
    raise exception 'Unsupported Pepper action.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', action_input,
    'entity_id', entity_id,
    'status', next_status
  );
end;
$$;
