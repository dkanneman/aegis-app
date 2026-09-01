-- Preview integration runtime. Tokens remain in Vault or hashed private tables.

create table if not exists private.integration_oauth_states (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'gmail'),
  state_hash text unique not null,
  code_verifier text not null,
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists private.integration_tokens (
  connection_id uuid primary key references public.integration_connections(id) on delete cascade,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists integration_oauth_states_expiry_idx
  on private.integration_oauth_states(expires_at);

create index if not exists health_ingest_tokens_member_idx
  on private.health_ingest_tokens(member_id, revoked_at);

create index if not exists health_daily_metrics_member_date_idx
  on public.health_daily_metrics(member_id, metric_date desc);

alter table private.integration_oauth_states enable row level security;
alter table private.integration_tokens enable row level security;

revoke all on table private.integration_oauth_states from public, anon, authenticated;
revoke all on table private.integration_tokens from public, anon, authenticated;
