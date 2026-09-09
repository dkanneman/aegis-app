-- Fail closed if a private preview skipped the canonical One Brain capture
-- migrations. Apply these canonical files, in order, before this guard:
--   20260816203301_complete_aegis_capture_pipeline.sql
--   20260824204510_add_one_brain_capture_reconciliation.sql

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'captures'
      and column_name = 'aegis_sync_status'
  ) then
    raise exception 'Preview is missing 20260816203301_complete_aegis_capture_pipeline.sql';
  end if;

  if to_regprocedure('private.apply_capture_plan(uuid,uuid,text,jsonb)') is null
     or to_regprocedure('private.pepper_record_capture_apply_failure(uuid,uuid,text)') is null
     or to_regclass('private.capture_plan_applications') is null then
    raise exception 'Preview is missing 20260824204510_add_one_brain_capture_reconciliation.sql';
  end if;
end;
$$;
