create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid references public.household_members(id) on delete set null,
  source text not null default 'pepper_tell' check (source in ('pepper_tell','voice','text','sync','system')),
  original_text text not null check (length(btrim(original_text)) > 0),
  status text not null default 'captured' check (status in ('captured','applied','partially_applied','needs_review','dismissed')),
  extracted_facts jsonb not null default '[]'::jsonb,
  applied_changes jsonb not null default '[]'::jsonb,
  dedupe_key text,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists captures_household_dedupe_key_uidx
  on public.captures(household_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists captures_household_status_captured_idx
  on public.captures(household_id, status, captured_at desc);

alter table public.captures enable row level security;

revoke all on table public.captures from anon, authenticated;
grant select, insert, update, delete on table public.captures to service_role;

comment on table public.captures is 'Append-first canonical inbox for every Pepper voice/text update. Original input is persisted before interpretation so unmapped information is never silently lost.';
