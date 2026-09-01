alter table public.events
  add column if not exists canonical_status_override text
    check (canonical_status_override in ('confirmed', 'canceled', 'completed'));

comment on column public.events.canonical_status_override is
  'An explicit family decision made in Pepper. Calendar imports may update evidence but must not overwrite this canonical status.';
