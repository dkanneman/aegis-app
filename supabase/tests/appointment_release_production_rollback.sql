-- Non-destructive functional rollback for the production appointment release.
-- Additive delivery/audit columns and RPCs are intentionally retained so that
-- rollback never erases synchronization evidence.

do $$
begin
  if exists (
    select 1
    from private.appointment_bridge_deliveries
    where aegis_status in ('retry_required', 'reconnect_required', 'needs_review')
       or google_status = 'retry_required'
  ) then
    raise exception 'Resolve delivery states that the previous release cannot represent before production rollback.';
  end if;
  if (select count(*) from cron.job where jobname='pepper-calendar-sync') > 1 then
    raise exception 'Duplicate pepper-calendar-sync jobs require manual reconciliation.';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('private.pepper_disable_calendar_sync()') is not null then
    perform private.pepper_disable_calendar_sync();
  end if;
end;
$$;

do $$
begin
  if to_regclass('private.appointment_release_task_backfill_backup') is null then
    raise exception 'Medical coordination backup is missing; task fields cannot be restored safely.';
  end if;
  if to_regclass('private.appointment_release_calendar_connection_backup') is null then
    raise exception 'Calendar connection backup is missing; connection state cannot be restored safely.';
  end if;
end;
$$;

alter table public.calendar_connections
  drop constraint if exists calendar_connections_active_probe_check;

drop trigger if exists zz_tasks_medical_coordination_priority on public.tasks;

update public.tasks task
set priority = backup.priority,
    area = backup.area,
    project = backup.project,
    classification = backup.classification,
    tags = backup.tags,
    next_action = backup.next_action,
    importance = backup.importance,
    urgency = backup.urgency,
    deadline_type = backup.deadline_type,
    due_date_confidence = backup.due_date_confidence,
    priority_classification_confidence = backup.priority_classification_confidence,
    priority_reason = backup.priority_reason
from private.appointment_release_task_backfill_backup backup
where task.id = backup.task_id;

update public.calendar_connections connection
set status = backup.status,
    sync_status = backup.sync_status,
    last_error = backup.last_error,
    updated_at = backup.updated_at
from private.appointment_release_calendar_connection_backup backup
where connection.id = backup.connection_id;

create or replace function private.pepper_set_medical_coordination_priority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'pepper_medical_coordination' then
    new.area := 'Family';
    new.project := 'Medical coordination';
    new.priority := 'P0';
    new.classification := 'Medical coordination';
    new.tags := coalesce(new.tags, '{}'::text[]);
    if not ('medical' = any(new.tags)) then new.tags := array_append(new.tags, 'medical'); end if;
    if not ('coordination' = any(new.tags)) then new.tags := array_append(new.tags, 'coordination'); end if;
    new.next_action := coalesce(nullif(new.next_action, ''), new.title);
  end if;
  return new;
end;
$$;

create trigger zz_tasks_medical_coordination_priority
before insert or update of source, priority, area, project, classification, tags
on public.tasks
for each row execute function private.pepper_set_medical_coordination_priority();

-- Retain additive delivery columns, indexes, RPCs, the Vault secret, and the
-- backup table. They contain audit/rollback evidence and are harmless to the
-- previous function versions. Restore the captured prior Edge Function and
-- Vercel versions after this script completes.
