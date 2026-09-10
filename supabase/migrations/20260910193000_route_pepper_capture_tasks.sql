create or replace function private.pepper_task_universal_fields()
returns trigger
language plpgsql
set search_path to 'public', 'private'
as $function$
begin
  new.area := coalesce(nullif(btrim(new.area), ''), 'Personal');
  new.project := coalesce(btrim(new.project), '');
  new.priority := coalesce(nullif(btrim(new.priority), ''), 'P2');
  new.classification := coalesce(nullif(btrim(new.classification), ''), 'Open');
  new.tags := coalesce(new.tags, '{}'::text[]);
  new.notes := coalesce(new.notes, '');
  new.source_record := coalesce(new.source_record, '');
  new.waiting_on := coalesce(new.waiting_on, '');
  new.recurrence := coalesce(nullif(btrim(new.recurrence), ''), 'none');
  new.next_action := coalesce(btrim(new.next_action), '');

  if new.source = 'pepper_capture_work' then
    new.area := 'Work';
    new.project := 'Work';
    new.classification := 'Work';
    if not ('work' = any(new.tags)) then new.tags := array_append(new.tags, 'work'); end if;
    new.next_action := coalesce(nullif(new.next_action, ''), new.title);
  elsif new.source = 'pepper_capture_need' then
    new.project := 'Needs';
    new.classification := 'Need';
    if not ('need' = any(new.tags)) then new.tags := array_append(new.tags, 'need'); end if;
    new.next_action := coalesce(nullif(new.next_action, ''), new.title);
  elsif new.source = 'pepper_capture_event_follow_up' then
    new.project := 'Calendar';
    new.classification := 'Needs details';
    if not ('event' = any(new.tags)) then new.tags := array_append(new.tags, 'event'); end if;
    new.next_action := coalesce(nullif(new.next_action, ''), new.title);
  end if;

  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.completed_at := coalesce(new.completed_at, now());
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status is distinct from 'completed' then
    new.completed_at := null;
  end if;

  return new;
end;
$function$;

comment on function private.pepper_task_universal_fields() is
  'Normalizes task organizer fields and routes Tell Pepper task categories into visible app sections.';
