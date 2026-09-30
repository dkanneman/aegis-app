-- Read capabilities are member-private and never enter the shared event writer.
create table private.planning_source_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  member_id uuid not null references public.household_members(id),
  capability text not null check (capability in ('gmail','calendar_read')),
  subject text not null,
  email text not null,
  scopes text not null,
  vault_secret_id uuid not null,
  status text not null default 'pending' check (status in ('pending','connected','syncing','error','reconnect_required','disconnected')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  selected_calendars jsonb not null default '[]' check (jsonb_typeof(selected_calendars)='array'),
  generation bigint not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique (member_id,capability),
  unique (capability,subject)
);
create table private.planning_source_oauth (
  state_hash text primary key,
  code_verifier text not null,
  household_id uuid not null references public.households(id),
  member_id uuid not null references public.household_members(id),
  initiator_session_id uuid not null,
  capability text not null check (capability in ('gmail','calendar_read')),
  return_target text not null check (return_target in ('web','pepper_ios')),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create table private.planning_source_items (
  connection_id uuid not null references private.planning_source_connections(id) on delete cascade,
  source_id text not null,
  data jsonb not null check (jsonb_typeof(data)='object'),
  synced_at timestamptz not null default now(),
  primary key(connection_id,source_id)
);
alter table private.planning_source_connections enable row level security;
alter table private.planning_source_oauth enable row level security;
alter table private.planning_source_items enable row level security;
revoke all on private.planning_source_connections,private.planning_source_oauth,private.planning_source_items from public,anon,authenticated;
-- Access is exclusively through authenticated Edge handlers with member+household predicates.
grant select,insert,update,delete on private.planning_source_connections,private.planning_source_oauth,private.planning_source_items to service_role;
