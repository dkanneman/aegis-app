alter table public.tasks
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_member_id uuid references public.household_members(id) on delete set null;

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check
  check (status in ('open', 'in_progress', 'on_hold', 'completed', 'canceled'));

alter table public.events
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_member_id uuid references public.household_members(id) on delete set null,
  add column if not exists canonical_content_override jsonb not null default '{}'::jsonb;

create index if not exists tasks_household_active_idx
  on public.tasks (household_id, updated_at desc)
  where deleted_at is null;

create index if not exists events_household_active_starts_idx
  on public.events (household_id, starts_at)
  where deleted_at is null;

comment on column public.tasks.deleted_at is
  'Soft deletion marker. Deleted tasks leave active Pepper views but remain available to the audit trail.';
comment on column public.events.deleted_at is
  'Soft deletion marker. Calendar sync may refresh source metadata but must not restore this event to Pepper views.';
comment on column public.events.canonical_content_override is
  'Family-approved event fields edited in Pepper. Google Calendar remains evidence and cannot overwrite these values.';
