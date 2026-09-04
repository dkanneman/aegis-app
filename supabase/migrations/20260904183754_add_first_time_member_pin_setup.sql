alter table public.household_members
  add column if not exists pin_setup_completed_at timestamptz;

-- Preserve established accounts. Members who have never opened Pepper keep a
-- one-time invitation code and will choose their personal PIN on first use.
update public.household_members member
set pin_setup_completed_at = coalesce(
  (
    select min(session.created_at)
    from public.member_sessions session
    where session.member_id = member.id
  ),
  now()
)
where member.pin_setup_completed_at is null
  and (
    exists (
      select 1
      from public.member_sessions session
      where session.member_id = member.id
    )
    or exists (
      select 1
      from public.households household
      where household.id = member.household_id
        and household.slug = 'pepper-review'
    )
  );

create table if not exists private.member_pin_setup_sessions (
  token uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.household_members(id) on delete cascade,
  device_label text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists member_pin_setup_sessions_member_active_idx
  on private.member_pin_setup_sessions (member_id, expires_at desc)
  where consumed_at is null;

alter table private.member_pin_setup_sessions enable row level security;
revoke all on table private.member_pin_setup_sessions from public, anon, authenticated;
grant all on table private.member_pin_setup_sessions to service_role;

create or replace function private.pepper_start_session(
  household_slug_input text,
  member_slug_input text,
  pin_input text,
  device_label_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row record;
  attempt_key_value text;
  recent_failures integer;
  setup_token uuid;
  setup_expiry timestamptz;
  new_token uuid;
  new_expiry timestamptz;
begin
  attempt_key_value := lower(left(trim(coalesce(household_slug_input, '')), 80))
    || ':' || lower(left(trim(coalesce(member_slug_input, '')), 80));

  delete from private.pepper_login_attempts
  where attempted_at < now() - interval '24 hours';
  delete from public.member_sessions
  where expires_at < now() - interval '7 days'
     or revoked_at < now() - interval '7 days';
  delete from private.member_pin_setup_sessions
  where expires_at < now() - interval '24 hours'
     or consumed_at < now() - interval '24 hours';

  select count(*)::integer into recent_failures
  from private.pepper_login_attempts
  where attempt_key = attempt_key_value
    and succeeded = false
    and attempted_at > now() - interval '15 minutes';

  if recent_failures >= 5 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Too many attempts. Wait 15 minutes and try again.',
      'retry_after_seconds', 900
    );
  end if;

  select
    member.id,
    member.household_id,
    member.slug,
    member.display_name,
    member.role,
    member.pin_hash,
    member.pin_setup_completed_at,
    household.name as household_name,
    household.slug as household_slug
  into member_row
  from public.households household
  join public.household_members member on member.household_id = household.id
  where lower(household.slug) = lower(trim(coalesce(household_slug_input, '')))
    and lower(member.slug) = lower(trim(coalesce(member_slug_input, '')))
  limit 1;

  if not found
     or pin_input is null
     or pin_input !~ '^[0-9]{4,12}$'
     or member_row.pin_hash is null
     or member_row.pin_hash <> extensions.crypt(pin_input, member_row.pin_hash) then
    insert into private.pepper_login_attempts(attempt_key, succeeded)
    values (attempt_key_value, false);
    perform pg_catalog.pg_sleep(0.35);
    return jsonb_build_object('ok', false, 'error', 'That name or PIN did not match.');
  end if;

  delete from private.pepper_login_attempts where attempt_key = attempt_key_value;

  if member_row.pin_setup_completed_at is null
     and member_row.household_slug <> 'pepper-review' then
    update private.member_pin_setup_sessions
    set consumed_at = now()
    where member_id = member_row.id
      and consumed_at is null;

    setup_token := gen_random_uuid();
    setup_expiry := now() + interval '10 minutes';
    insert into private.member_pin_setup_sessions(
      token, member_id, device_label, expires_at
    ) values (
      setup_token,
      member_row.id,
      left(nullif(trim(device_label_input), ''), 120),
      setup_expiry
    );

    return jsonb_build_object(
      'ok', true,
      'setup_required', true,
      'setup_token', setup_token,
      'setup_expires_at', setup_expiry,
      'member', jsonb_build_object(
        'display_name', member_row.display_name
      )
    );
  end if;

  new_token := gen_random_uuid();
  new_expiry := now() + interval '30 days';
  insert into public.member_sessions(
    token, member_id, device_label, last_seen_at, created_at, expires_at, revoked_at
  ) values (
    new_token,
    member_row.id,
    left(nullif(trim(device_label_input), ''), 120),
    now(),
    now(),
    new_expiry,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'token', new_token,
    'expires_at', new_expiry,
    'member', jsonb_build_object(
      'id', member_row.id,
      'slug', member_row.slug,
      'display_name', member_row.display_name,
      'role', member_row.role
    ),
    'household', jsonb_build_object(
      'id', member_row.household_id,
      'slug', member_row.household_slug,
      'name', member_row.household_name
    )
  );
end;
$$;

create or replace function private.pepper_complete_pin_setup(
  setup_token_input uuid,
  new_pin_input text,
  device_label_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  setup_row record;
  member_row record;
  new_token uuid;
  new_expiry timestamptz;
begin
  if new_pin_input is null or new_pin_input !~ '^[0-9]{4,12}$' then
    return jsonb_build_object('ok', false, 'error', 'Choose a 4–12 digit PIN.');
  end if;

  select setup.token, setup.member_id, setup.device_label
  into setup_row
  from private.member_pin_setup_sessions setup
  where setup.token = setup_token_input
    and setup.consumed_at is null
    and setup.expires_at > now()
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'That PIN setup has expired. Start again with your invitation code.'
    );
  end if;

  select
    member.id,
    member.household_id,
    member.slug,
    member.display_name,
    member.role,
    member.pin_hash,
    member.pin_setup_completed_at,
    household.name as household_name,
    household.slug as household_slug
  into member_row
  from public.household_members member
  join public.households household on household.id = member.household_id
  where member.id = setup_row.member_id
  for update of member;

  if not found or member_row.pin_setup_completed_at is not null then
    update private.member_pin_setup_sessions
    set consumed_at = now()
    where token = setup_token_input;
    return jsonb_build_object(
      'ok', false,
      'error', 'This profile already has a PIN. Return to sign in.'
    );
  end if;

  if member_row.pin_hash = extensions.crypt(new_pin_input, member_row.pin_hash) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Choose a personal PIN that is different from the invitation code.'
    );
  end if;

  update public.household_members
  set pin_hash = extensions.crypt(new_pin_input, extensions.gen_salt('bf')),
      pin_setup_completed_at = now()
  where id = member_row.id;

  update private.member_pin_setup_sessions
  set consumed_at = now()
  where member_id = member_row.id
    and consumed_at is null;

  update public.member_sessions
  set revoked_at = now(), last_seen_at = now()
  where member_id = member_row.id
    and revoked_at is null;

  new_token := gen_random_uuid();
  new_expiry := now() + interval '30 days';
  insert into public.member_sessions(
    token, member_id, device_label, last_seen_at, created_at, expires_at, revoked_at
  ) values (
    new_token,
    member_row.id,
    coalesce(
      left(nullif(trim(device_label_input), ''), 120),
      setup_row.device_label
    ),
    now(),
    now(),
    new_expiry,
    null
  );

  insert into public.audit_log(
    household_id, actor_member_id, event_type, entity_type, entity_id, summary
  ) values (
    member_row.household_id,
    member_row.id,
    'member_pin_setup_completed',
    'member',
    member_row.id,
    member_row.display_name || ' created a personal Pepper PIN.'
  );

  return jsonb_build_object(
    'ok', true,
    'token', new_token,
    'expires_at', new_expiry,
    'member', jsonb_build_object(
      'id', member_row.id,
      'slug', member_row.slug,
      'display_name', member_row.display_name,
      'role', member_row.role
    ),
    'household', jsonb_build_object(
      'id', member_row.household_id,
      'slug', member_row.household_slug,
      'name', member_row.household_name
    )
  );
end;
$$;

create or replace function public.pepper_start_family_session(
  member_slug_input text,
  pin_input text,
  device_label_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_identity text := lower(trim(coalesce(member_slug_input, '')));
  resolved_slug text;
begin
  -- A 10-digit PIN remains reserved for the isolated TestFlight reviewer.
  if requested_identity in ('elle', 'danielle')
     and coalesce(pin_input, '') ~ '^[0-9]{10}$' then
    return private.pepper_start_session(
      'pepper-review', 'reviewer', pin_input, device_label_input
    );
  end if;

  select member.slug
  into resolved_slug
  from public.household_members member
  join public.households household on household.id = member.household_id
  where household.slug = 'eriksen'
    and (
      lower(member.slug) = requested_identity
      or lower(member.display_name) = requested_identity
    )
  order by case when lower(member.slug) = requested_identity then 0 else 1 end
  limit 1;

  return private.pepper_start_session(
    'eriksen', coalesce(resolved_slug, requested_identity), pin_input, device_label_input
  );
end;
$$;

revoke execute on function private.pepper_start_session(text, text, text, text)
  from public, anon, authenticated;
revoke execute on function private.pepper_complete_pin_setup(uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.pepper_start_session(text, text, text, text)
  to service_role;
grant execute on function private.pepper_complete_pin_setup(uuid, text, text)
  to service_role;

revoke execute on function public.pepper_start_family_session(text, text, text)
  from public;
grant execute on function public.pepper_start_family_session(text, text, text)
  to anon, authenticated, service_role;
