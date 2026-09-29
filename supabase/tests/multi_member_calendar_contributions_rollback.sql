-- Exact rollback for 20260917211929_authorize_household_calendar_contributions.sql.

alter table public.events drop column if exists last_calendar_action_id;

drop trigger if exists calendar_event_mutation_requests_immutable
  on private.calendar_event_mutation_requests;
drop function if exists private.pepper_reject_calendar_mutation_change();
drop function if exists private.pepper_record_calendar_event_mutation(
  uuid,uuid,uuid,uuid,text,text,bigint,bigint,bigint,jsonb
);
drop function if exists private.pepper_calendar_action_uuid(text);
drop table if exists private.calendar_event_mutation_requests;

alter table public.events
  drop column if exists revision,
  drop column if exists last_modified_session_id,
  drop column if exists last_modified_by_member_id,
  drop column if exists created_by_member_id;

drop index if exists public.member_sessions_session_id_uidx;
alter table public.member_sessions drop column if exists session_id;

alter table public.household_members
  drop constraint if exists household_members_active_state_check,
  drop column if exists removed_at,
  drop column if exists active;
