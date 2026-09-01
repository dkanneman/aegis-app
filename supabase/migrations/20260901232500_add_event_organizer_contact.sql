alter table public.events
  add column if not exists external_organizer_email text,
  add column if not exists external_organizer_name text;

comment on column public.events.external_organizer_email is
  'Organizer contact supplied by the external calendar. Used only for user-approved coordination messages.';

comment on column public.events.external_organizer_name is
  'Organizer display name supplied by the external calendar.';
