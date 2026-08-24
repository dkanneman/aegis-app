-- Pepper V6 Phase 0 runtime schema baseline
-- Captured read-only from production PostgreSQL catalogs on 2026-08-24.
--
-- SCHEMA ONLY: this file contains no rows, session tokens, OAuth material,
-- household identifiers, credentials, sequence state, or seed values.
--
-- This is a reconstruction supplement, not an unapplied migration. It records
-- runtime-critical objects whose original DDL is absent from the safe migration
-- baseline. Do not apply it to production.
--
-- Required dependencies supplied by the captured migration baseline:
--   * pgcrypto / gen_random_uuid()
--   * public.households
--   * public.household_members
--   * private.pepper_current_household_id()
--
-- Observed schema reachability relevant to these objects:
--   * private schema owner: postgres
--   * private schema USAGE: postgres, anon, authenticated
--   * public schema owner: pg_database_owner
--   * public schema USAGE: PUBLIC, pg_database_owner, postgres, anon,
--     authenticated, service_role

create table public.member_sessions (
  token uuid default gen_random_uuid() not null,
  member_id uuid not null,
  device_label text,
  last_seen_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '30 days'::interval) not null,
  revoked_at timestamp with time zone,
  constraint member_sessions_pkey primary key (token),
  constraint member_sessions_member_id_fkey
    foreign key (member_id) references public.household_members(id) on delete cascade
);

alter table public.member_sessions owner to postgres;

create index member_sessions_member_expiry_idx
  on public.member_sessions using btree (member_id, expires_at desc);

alter table public.member_sessions enable row level security;
alter table public.member_sessions no force row level security;

create policy member_sessions_no_direct_access
  on public.member_sessions
  as permissive
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- No non-internal triggers were deployed on public.member_sessions.

revoke all privileges on table public.member_sessions
  from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update
  on table public.member_sessions to service_role;

create table public.calendar_connections (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  connected_by_member_id uuid not null,
  provider text default 'google'::text not null,
  provider_calendar_id text default 'primary'::text not null,
  calendar_name text,
  calendar_time_zone text,
  access_scope text default 'calendar.readonly'::text not null,
  status text default 'disconnected'::text not null,
  sync_status text default 'never'::text not null,
  scan_window_days integer default 14 not null,
  last_attempt_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint calendar_connections_pkey primary key (id),
  constraint calendar_connections_household_id_provider_key
    unique (household_id, provider),
  constraint calendar_connections_connected_by_member_id_fkey
    foreign key (connected_by_member_id)
    references public.household_members(id) on delete restrict,
  constraint calendar_connections_household_id_fkey
    foreign key (household_id) references public.households(id) on delete cascade,
  constraint calendar_connections_scan_window_days_check
    check (scan_window_days >= 7 and scan_window_days <= 14),
  constraint calendar_connections_status_check
    check (status = any (array[
      'disconnected'::text,
      'connected'::text,
      'error'::text
    ])),
  constraint calendar_connections_sync_status_check
    check (sync_status = any (array[
      'never'::text,
      'syncing'::text,
      'healthy'::text,
      'error'::text
    ]))
);

alter table public.calendar_connections owner to postgres;

create index calendar_connections_connected_member_idx
  on public.calendar_connections using btree (connected_by_member_id);

alter table public.calendar_connections enable row level security;
alter table public.calendar_connections no force row level security;

create policy calendar_connections_family_select
  on public.calendar_connections
  as permissive
  for select
  to anon, authenticated
  using (
    household_id = (
      select private.pepper_current_household_id()
    )
  );

-- No non-internal triggers were deployed on public.calendar_connections.

revoke all privileges on table public.calendar_connections
  from public, anon, authenticated, service_role;
grant maintain, references, select, trigger, truncate
  on table public.calendar_connections to anon, authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update
  on table public.calendar_connections to service_role;

create table private.calendar_oauth_states (
  id uuid default gen_random_uuid() not null,
  state_hash text not null,
  code_verifier text not null,
  household_id uuid not null,
  member_id uuid not null,
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint calendar_oauth_states_pkey primary key (id),
  constraint calendar_oauth_states_state_hash_key unique (state_hash),
  constraint calendar_oauth_states_household_id_fkey
    foreign key (household_id) references public.households(id) on delete cascade,
  constraint calendar_oauth_states_member_id_fkey
    foreign key (member_id) references public.household_members(id) on delete cascade
);

alter table private.calendar_oauth_states owner to postgres;

create index calendar_oauth_states_expiry_idx
  on private.calendar_oauth_states using btree (expires_at);
create index calendar_oauth_states_household_idx
  on private.calendar_oauth_states using btree (household_id);
create index calendar_oauth_states_member_idx
  on private.calendar_oauth_states using btree (member_id);

alter table private.calendar_oauth_states disable row level security;
alter table private.calendar_oauth_states no force row level security;

-- No policies or non-internal triggers were deployed on
-- private.calendar_oauth_states.

revoke all privileges on table private.calendar_oauth_states
  from public, anon, authenticated, service_role;

create table private.calendar_tokens (
  connection_id uuid not null,
  vault_secret_id uuid not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint calendar_tokens_pkey primary key (connection_id),
  constraint calendar_tokens_connection_id_fkey
    foreign key (connection_id)
    references public.calendar_connections(id) on delete cascade
);

alter table private.calendar_tokens owner to postgres;
alter table private.calendar_tokens disable row level security;
alter table private.calendar_tokens no force row level security;

-- No policies, additional indexes, or non-internal triggers were deployed on
-- private.calendar_tokens. Its primary-key index is created by the constraint.

revoke all privileges on table private.calendar_tokens
  from public, anon, authenticated, service_role;

create sequence private.calendar_sync_runs_id_seq
  as bigint
  increment by 1
  minvalue 1
  maxvalue 9223372036854775807
  start with 1
  cache 1
  no cycle;

alter sequence private.calendar_sync_runs_id_seq owner to postgres;

create table private.calendar_sync_runs (
  id bigint default nextval('private.calendar_sync_runs_id_seq'::regclass) not null,
  connection_id uuid not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  status text default 'running'::text not null,
  events_seen integer default 0 not null,
  events_upserted integer default 0 not null,
  duplicates_merged integer default 0 not null,
  events_removed integer default 0 not null,
  error_code text,
  error_message text,
  constraint calendar_sync_runs_pkey primary key (id),
  constraint calendar_sync_runs_connection_id_fkey
    foreign key (connection_id)
    references public.calendar_connections(id) on delete cascade,
  constraint calendar_sync_runs_status_check
    check (status = any (array[
      'running'::text,
      'healthy'::text,
      'error'::text
    ]))
);

alter table private.calendar_sync_runs owner to postgres;
alter sequence private.calendar_sync_runs_id_seq
  owned by private.calendar_sync_runs.id;

create index calendar_sync_runs_connection_started_idx
  on private.calendar_sync_runs using btree (connection_id, started_at desc);

alter table private.calendar_sync_runs disable row level security;
alter table private.calendar_sync_runs no force row level security;

-- No policies or non-internal triggers were deployed on
-- private.calendar_sync_runs.

revoke all privileges on sequence private.calendar_sync_runs_id_seq
  from public, anon, authenticated, service_role;
revoke all privileges on table private.calendar_sync_runs
  from public, anon, authenticated, service_role;
