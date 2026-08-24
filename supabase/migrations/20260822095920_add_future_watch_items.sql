create table if not exists private.future_watch_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  person_slug text,
  category text not null default 'custom' check (category in ('school_break','school_deadline','birthday','deadline','appointment','activity','travel','preparation','custom')),
  starts_on date not null,
  ends_on date,
  status text not null default 'confirmed' check (status in ('tentative','confirmed','canceled','completed')),
  preparation_required boolean not null default false,
  preparation_summary text,
  prep_lead_days integer not null default 0 check (prep_lead_days >= 0 and prep_lead_days <= 90),
  owner_member_id uuid references public.household_members(id),
  visibility text not null default 'household' check (visibility in ('household','private')),
  source text not null default 'pepper',
  source_ref text,
  confidence numeric(4,3) not null default 1.000 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.future_watch_items enable row level security;
create index if not exists future_watch_household_date_idx on private.future_watch_items(household_id, starts_on) where status not in ('canceled','completed');
create index if not exists future_watch_owner_idx on private.future_watch_items(owner_member_id) where owner_member_id is not null;
