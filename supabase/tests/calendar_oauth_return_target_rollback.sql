-- Disposable-local exact rollback ONLY for a baseline that lacked this column.
-- Never drop a pre-existing preview column. Hosted rollback leaves this additive
-- compatibility field in place and restores the prior function deployment.
begin;
do $$
begin
  if current_setting('pepper.rehearsal_created_return_target', true) is distinct from 'true' then
    raise exception 'Require explicit absent-column local baseline evidence before rollback.';
  end if;
  if exists (select 1 from private.calendar_oauth_states where return_target <> 'web') then
    raise exception 'Rollback would discard native return-target information; preserve states.';
  end if;
end;
$$;
alter table private.calendar_oauth_states drop column return_target;
commit;
