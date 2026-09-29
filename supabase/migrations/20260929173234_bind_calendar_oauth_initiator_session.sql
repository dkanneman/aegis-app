begin;

-- No inferred/backfilled authorization: in-flight legacy states fail closed.
-- Stable session identity is not a bearer token. Deleting a session invalidates
-- its outstanding OAuth states without obstructing ordinary session cleanup.
alter table private.calendar_oauth_states
  add column if not exists initiating_session_id uuid
    references public.member_sessions(session_id) on delete set null;
create index if not exists calendar_oauth_states_initiating_session_idx
  on private.calendar_oauth_states(initiating_session_id);
comment on column private.calendar_oauth_states.initiating_session_id is
  'Initiating Pepper session; callback must reauthorize current member/household. NULL is unauthorized.';

commit;
