-- Disposable local rehearsal only. Never downgrade a live callback to the
-- insecure pre-binding runtime. Production recovery disables connection setup.
begin;
do $$ begin
  if exists(select 1 from private.calendar_oauth_states where initiating_session_id is not null) then
    raise exception 'Outstanding bound OAuth state exists; rollback refused';
  end if;
end $$;
alter table private.calendar_oauth_states drop column initiating_session_id;
commit;
