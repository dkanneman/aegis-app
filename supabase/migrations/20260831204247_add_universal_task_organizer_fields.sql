alter table public.tasks
  add column if not exists area text not null default 'Personal',
  add column if not exists project text not null default '',
  add column if not exists priority text not null default 'P2',
  add column if not exists classification text not null default 'Open',
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists notes text not null default '',
  add column if not exists source_record text not null default '',
  add column if not exists waiting_on text not null default '',
  add column if not exists recurrence text not null default 'none',
  add column if not exists completed_at timestamptz;

create index if not exists tasks_household_area_status_idx
  on public.tasks (household_id, area, status);

create index if not exists tasks_household_project_status_idx
  on public.tasks (household_id, project, status);

create index if not exists tasks_household_priority_status_idx
  on public.tasks (household_id, priority, status);

create index if not exists tasks_source_record_idx
  on public.tasks (source_record)
  where source_record <> '';

create index if not exists tasks_tags_gin_idx
  on public.tasks using gin (tags);

create or replace function private.pepper_task_universal_fields()
returns trigger
language plpgsql
set search_path = public, private
as $$
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

  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.completed_at := coalesce(new.completed_at, now());
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status is distinct from 'completed' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_universal_fields on public.tasks;
create trigger tasks_universal_fields
before insert or update on public.tasks
for each row
execute function private.pepper_task_universal_fields();
