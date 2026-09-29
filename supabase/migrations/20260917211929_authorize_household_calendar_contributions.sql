-- Record the Pepper household member and stable server-side session responsible
-- for each shared Calendar mutation. Browser roles remain denied; Edge Functions
-- perform authorization with the server-held database connection.

alter table public.household_members
  add column if not exists active boolean not null default true,
  add column if not exists removed_at timestamptz;

alter table public.household_members
  drop constraint if exists household_members_active_state_check,
  add constraint household_members_active_state_check
    check (active = (removed_at is null));

alter table public.member_sessions
  add column if not exists session_id uuid;

update public.member_sessions set session_id=(
  substring(md5('pepper-session-v1:'||token::text),1,8) || '-' ||
  substring(md5('pepper-session-v1:'||token::text),9,4) || '-' ||
  '5' || substring(md5('pepper-session-v1:'||token::text),14,3) || '-' ||
  '8' || substring(md5('pepper-session-v1:'||token::text),18,3) || '-' ||
  substring(md5('pepper-session-v1:'||token::text),21,12)
)::uuid
where session_id is null;

alter table public.member_sessions
  alter column session_id set default gen_random_uuid(),
  alter column session_id set not null;

create unique index if not exists member_sessions_session_id_uidx
  on public.member_sessions(session_id);

alter table public.events
  add column if not exists created_by_member_id uuid
    references public.household_members(id) on delete set null,
  add column if not exists last_modified_by_member_id uuid
    references public.household_members(id) on delete set null,
  add column if not exists last_modified_session_id uuid,
  add column if not exists revision bigint not null default 1;

create table if not exists private.calendar_event_mutation_requests (
  id uuid primary key,
  action_key text not null unique,
  household_id uuid not null references public.households(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  actor_member_id uuid not null references public.household_members(id) on delete cascade,
  actor_session_id uuid,
  action text not null check (action in ('create','update','cancel')),
  source text not null check (source in ('pepper_session','migration_backfill')),
  expected_revision bigint,
  before_revision bigint,
  after_revision bigint not null check (after_revision > 0),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz not null default now(),
  constraint calendar_event_mutation_session_check check (
    (source='pepper_session' and actor_session_id is not null)
    or source='migration_backfill'
  ),
  constraint calendar_event_mutation_revision_check check (
    (source='migration_backfill' and expected_revision is null and before_revision is null)
    or (
      source='pepper_session'
      and expected_revision is not null
      and expected_revision > 0
      and before_revision=expected_revision
      and (
        (action='create' and after_revision=expected_revision)
        or (action in ('update','cancel') and after_revision=expected_revision+1)
      )
    )
  )
);

create index if not exists calendar_event_mutation_event_idx
  on private.calendar_event_mutation_requests(event_id, requested_at desc);

create index if not exists calendar_event_mutation_household_idx
  on private.calendar_event_mutation_requests(household_id, requested_at desc);

create index if not exists calendar_event_mutation_actor_idx
  on private.calendar_event_mutation_requests(actor_member_id, requested_at desc);

alter table private.calendar_event_mutation_requests enable row level security;
revoke all on private.calendar_event_mutation_requests from public, anon, authenticated;
grant select, insert on private.calendar_event_mutation_requests to service_role;

create or replace function private.pepper_calendar_action_uuid(action_key_input text)
returns uuid
language sql
immutable
strict
set search_path to pg_catalog
as $$
  select (
    substring(md5(action_key_input),1,8) || '-' ||
    substring(md5(action_key_input),9,4) || '-' ||
    '5' || substring(md5(action_key_input),14,3) || '-' ||
    '8' || substring(md5(action_key_input),18,3) || '-' ||
    substring(md5(action_key_input),21,12)
  )::uuid;
$$;

create or replace function private.pepper_record_calendar_event_mutation(
  household_id_input uuid,
  event_id_input uuid,
  actor_member_id_input uuid,
  actor_session_id_input uuid,
  action_input text,
  action_key_input text,
  expected_revision_input bigint,
  before_revision_input bigint,
  after_revision_input bigint,
  request_input jsonb
)
returns uuid
language plpgsql
security invoker
set search_path to pg_catalog, public, private
as $$
declare
  action_id uuid;
  request_hash_value text;
  existing private.calendar_event_mutation_requests%rowtype;
begin
  if household_id_input is null or event_id_input is null
     or actor_member_id_input is null or actor_session_id_input is null then
    raise exception 'A household, event, member, and stable session are required.' using errcode='22023';
  end if;
  if action_input not in ('create','update','cancel') then
    raise exception 'Unsupported Calendar mutation.' using errcode='22023';
  end if;
  if expected_revision_input is null or expected_revision_input < 1
     or before_revision_input is distinct from expected_revision_input
     or (
       action_input='create' and after_revision_input<>expected_revision_input
     )
     or (
       action_input in ('update','cancel') and after_revision_input<>expected_revision_input+1
     ) then
    raise exception 'Calendar mutation revisions are invalid.' using errcode='22023';
  end if;
  if nullif(btrim(action_key_input),'') is null or length(action_key_input)>500 then
    raise exception 'A bounded idempotency key is required.' using errcode='22023';
  end if;
  if request_input is null or jsonb_typeof(request_input)<>'object' then
    raise exception 'Calendar mutation evidence must be an object.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.household_members member
    where member.id=actor_member_id_input
      and member.household_id=household_id_input
      and member.role in ('adult_admin','adult')
      and member.active=true
      and member.removed_at is null
  ) then
    raise exception 'An active adult household member is required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.member_sessions session
    where session.session_id=actor_session_id_input
      and session.member_id=actor_member_id_input
      and session.revoked_at is null
      and session.expires_at>now()
  ) then
    raise exception 'The Pepper session is not active for this member.' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.events event
    where event.id=event_id_input and event.household_id=household_id_input
  ) then
    raise exception 'The event does not belong to this household.' using errcode='42501';
  end if;

  action_id := private.pepper_calendar_action_uuid(action_key_input);
  request_hash_value := encode(extensions.digest(request_input::text,'sha256'),'hex');

  insert into private.calendar_event_mutation_requests(
    id,action_key,household_id,event_id,actor_member_id,actor_session_id,
    action,source,expected_revision,before_revision,after_revision,request_hash
  ) values (
    action_id,btrim(action_key_input),household_id_input,event_id_input,
    actor_member_id_input,actor_session_id_input,action_input,'pepper_session',
    expected_revision_input,before_revision_input,after_revision_input,request_hash_value
  )
  on conflict (action_key) do nothing;

  select * into existing
  from private.calendar_event_mutation_requests request
  where request.action_key=btrim(action_key_input);

  if existing.id is null
     or existing.id<>action_id
     or existing.household_id<>household_id_input
     or existing.event_id<>event_id_input
     or existing.actor_member_id<>actor_member_id_input
     or existing.actor_session_id is distinct from actor_session_id_input
     or existing.action<>action_input
     or existing.request_hash<>request_hash_value then
    raise exception 'The Calendar mutation key was reused with different evidence.' using errcode='23505';
  end if;
  return action_id;
end;
$$;

revoke all on function private.pepper_calendar_action_uuid(text) from public, anon, authenticated;
revoke all on function private.pepper_record_calendar_event_mutation(
  uuid,uuid,uuid,uuid,text,text,bigint,bigint,bigint,jsonb
) from public, anon, authenticated;
grant execute on function private.pepper_calendar_action_uuid(text) to service_role;
grant execute on function private.pepper_record_calendar_event_mutation(
  uuid,uuid,uuid,uuid,text,text,bigint,bigint,bigint,jsonb
) to service_role;

create or replace function private.pepper_reject_calendar_mutation_change()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  if pg_trigger_depth()>1 then return old; end if;
  raise exception 'Calendar mutation evidence is immutable.' using errcode='55000';
end;
$$;

drop trigger if exists calendar_event_mutation_requests_immutable
  on private.calendar_event_mutation_requests;
create trigger calendar_event_mutation_requests_immutable
before update or delete on private.calendar_event_mutation_requests
for each row execute function private.pepper_reject_calendar_mutation_change();

alter table public.events
  add column if not exists last_calendar_action_id uuid
    references private.calendar_event_mutation_requests(id) on delete restrict;

create index if not exists events_created_by_member_idx
  on public.events(created_by_member_id) where created_by_member_id is not null;
create index if not exists events_last_modified_by_member_idx
  on public.events(last_modified_by_member_id) where last_modified_by_member_id is not null;
create index if not exists events_last_calendar_action_idx
  on public.events(last_calendar_action_id) where last_calendar_action_id is not null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='events' and column_name='source_capture_id'
  ) then
    execute $backfill$
      with actors as (
        select event.id as event_id,
          coalesce(capture.member_id,connection.connected_by_member_id) as actor_member_id
        from public.events event
        left join public.captures capture on capture.id=event.source_capture_id
        left join public.calendar_connections connection
          on connection.household_id=event.household_id and connection.provider='google'
      ), valid_actors as (
        select actors.event_id,member.id as actor_member_id
        from actors
        join public.events event on event.id=actors.event_id
        join public.household_members member
          on member.id=actors.actor_member_id
         and member.household_id=event.household_id
         and member.role in ('adult_admin','adult')
         and member.active=true
         and member.removed_at is null
      )
      update public.events event set
        created_by_member_id=coalesce(event.created_by_member_id,valid_actors.actor_member_id),
        last_modified_by_member_id=coalesce(event.last_modified_by_member_id,valid_actors.actor_member_id)
      from valid_actors
      where event.id=valid_actors.event_id
        and (event.created_by_member_id is null or event.last_modified_by_member_id is null)
    $backfill$;
  else
    with valid_actors as (
      select event.id as event_id,member.id as actor_member_id
      from public.events event
      join public.calendar_connections connection
        on connection.household_id=event.household_id and connection.provider='google'
      join public.household_members member
        on member.id=connection.connected_by_member_id
       and member.household_id=event.household_id
       and member.role in ('adult_admin','adult')
       and member.active=true
       and member.removed_at is null
    )
    update public.events event set
      created_by_member_id=coalesce(event.created_by_member_id,valid_actors.actor_member_id),
      last_modified_by_member_id=coalesce(event.last_modified_by_member_id,valid_actors.actor_member_id)
    from valid_actors
    where event.id=valid_actors.event_id
      and (event.created_by_member_id is null or event.last_modified_by_member_id is null);
  end if;
end;
$$;

insert into private.calendar_event_mutation_requests(
  id,action_key,household_id,event_id,actor_member_id,actor_session_id,
  action,source,expected_revision,before_revision,after_revision,request_hash,requested_at
)
select
  private.pepper_calendar_action_uuid('migration-backfill:'||event.id::text),
  'migration-backfill:'||event.id::text,event.household_id,event.id,
  event.last_modified_by_member_id,null,
  case when event.status='canceled' then 'cancel' else 'create' end,
  'migration_backfill',null,null,event.revision,
  encode(extensions.digest(jsonb_build_object(
    'event_id',event.id,'household_id',event.household_id,'migration_backfill',true
  )::text,'sha256'),'hex'),event.updated_at
from public.events event
where event.last_modified_by_member_id is not null
on conflict (action_key) do nothing;

update public.events event set last_calendar_action_id=request.id
from private.calendar_event_mutation_requests request
where request.event_id=event.id
  and request.action_key='migration-backfill:'||event.id::text
  and event.last_calendar_action_id is null;

comment on table private.calendar_event_mutation_requests is
  'Immutable server-side evidence for authorized shared-household Calendar mutations.';
comment on column public.member_sessions.session_id is
  'Stable non-secret session identity. The bearer token remains server-side and is never stored in event audit records.';
comment on column public.events.last_modified_session_id is
  'Stable Pepper session identity for the latest canonical event mutation; never a bearer token.';
