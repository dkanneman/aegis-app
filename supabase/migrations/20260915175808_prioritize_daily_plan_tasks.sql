alter table public.tasks
  add column if not exists importance text not null default 'normal'
    check (importance in ('critical', 'high', 'normal', 'low', 'someday')),
  add column if not exists urgency text not null default 'flexible'
    check (urgency in ('today', 'this_week', 'upcoming', 'flexible')),
  add column if not exists deadline_type text not null default 'none'
    check (deadline_type in ('hard', 'soft', 'none')),
  add column if not exists due_date_confidence numeric(4,3) not null default 0
    check (due_date_confidence between 0 and 1),
  add column if not exists waiting_follow_up_at timestamptz,
  add column if not exists blocked boolean not null default false,
  add column if not exists snoozed_until timestamptz,
  add column if not exists dismissed_for_date date,
  add column if not exists manually_pinned boolean not null default false,
  add column if not exists daily_plan_state text not null default 'eligible'
    check (daily_plan_state in ('eligible', 'selected', 'optional', 'dismissed', 'snoozed', 'waiting', 'blocked', 'returned', 'complete')),
  add column if not exists priority_score integer not null default 0,
  add column if not exists priority_reason text not null default '',
  add column if not exists estimated_minutes integer not null default 45
    check (estimated_minutes between 5 and 480),
  add column if not exists priority_classification_confidence numeric(4,3) not null default 0.500
    check (priority_classification_confidence between 0 and 1);

comment on column public.tasks.priority is
  'Legacy source priority retained for compatibility. Pepper v6 maps it into importance but never destroys or overwrites it.';
comment on column public.tasks.due_date_confidence is
  'Confidence that due_at is a real task deadline. Values below 0.750 do not create deadline pressure in the daily plan.';
comment on column public.tasks.dismissed_for_date is
  'Local household date on which the task was removed from the daily plan. This does not complete, delete, or change the task deadline.';
comment on column public.tasks.priority_score is
  'Last classified base score. The day planner recomputes date-sensitive pressure whenever the plan is refreshed.';

create index if not exists tasks_household_daily_plan_eligible_idx
  on public.tasks (
    household_id,
    owner_member_id,
    manually_pinned desc,
    priority_score desc,
    updated_at desc
  )
  where deleted_at is null and status in ('open', 'in_progress', 'on_hold');

create index if not exists tasks_household_snoozed_idx
  on public.tasks (household_id, snoozed_until)
  where snoozed_until is not null and deleted_at is null;

create index if not exists tasks_household_dismissed_date_idx
  on public.tasks (household_id, dismissed_for_date)
  where dismissed_for_date is not null and deleted_at is null;

-- Map the existing backlog without changing the source priority or original due date.
update public.tasks
set
  importance = case
    when lower(coalesce(priority, '')) ~ '(^|[^a-z0-9])(p0|critical|urgent|highest)([^a-z0-9]|$)' then 'critical'
    when lower(coalesce(priority, '')) ~ '(^|[^a-z0-9])(p1|high)([^a-z0-9]|$)' then 'high'
    when lower(coalesce(priority, '')) ~ '(^|[^a-z0-9])(p3|low|later)([^a-z0-9]|$)' then 'low'
    when lower(coalesce(priority, '')) ~ '(^|[^a-z0-9])someday([^a-z0-9]|$)' then 'someday'
    else 'normal'
  end,
  deadline_type = case
    when due_at is null then 'none'
    when lower(concat_ws(' ', title, area, project, classification, notes, array_to_string(tags, ' '))) ~
      '(^|[^a-z])(payroll|tax filing|court date|legal filing|hard deadline|filing deadline|safety log due|must be (done|filed|paid|submitted) by)([^a-z]|$)'
      then 'hard'
    else 'soft'
  end,
  due_date_confidence = case
    when due_at is null then 0.000
    when lower(concat_ws(' ', title, area, project, classification, notes, array_to_string(tags, ' '))) ~
      '(^|[^a-z])(payroll|tax filing|court date|legal filing|hard deadline|filing deadline|safety log due|must be (done|filed|paid|submitted) by)([^a-z]|$)'
      then 0.950
    when lower(coalesce(source, '')) in ('pepper', 'pepper_capture', 'pepper_personal', 'pepper_chore')
      and created_at >= now() - interval '45 days' then 0.800
    when coalesce(source_record, '') <> '' or title ~* '^MC-[0-9]+' then 0.450
    else 0.650
  end,
  blocked = status = 'on_hold'
    or lower(coalesce(classification, '')) = 'blocked'
    or lower(coalesce(notes, '')) like '%source status: blocked%',
  daily_plan_state = case
    when status in ('completed', 'canceled') then 'complete'
    when status = 'on_hold' then 'blocked'
    when coalesce(waiting_on, '') <> '' then 'waiting'
    else 'eligible'
  end,
  estimated_minutes = case
    when lower(coalesce(classification, '')) = 'chore' or lower(coalesce(area, '')) = 'chores' then 30
    when lower(concat_ws(' ', title, project, classification)) ~ '(^|[^a-z])(write|revise|manuscript|chapter|compile|proposal|bid)([^a-z]|$)' then 90
    when lower(title) ~ '(^|[^a-z])(call|email|confirm|schedule|book|upload|send|order|pay)([^a-z]|$)' then 30
    else 45
  end,
  priority_classification_confidence = case
    when lower(concat_ws(' ', title, area, project, classification, notes, array_to_string(tags, ' '))) ~
      '(^|[^a-z])(medical|doctor|dentist|dental|orthodont|physical therapy|eye appointment|hearing appointment|pediatric|pulmonology|blood work|blood-work|mental health therapy|payroll|safety|osha|legal|court|financial loss|late fee|penalty)([^a-z]|$)'
      then 0.900
    when coalesce(source_record, '') <> '' or title ~* '^MC-[0-9]+' then 0.550
    when coalesce(priority, '') <> '' and coalesce(project, '') <> '' then 0.750
    else 0.500
  end;

update public.tasks
set urgency = case
  when deadline_type = 'none' or due_at is null or due_date_confidence < 0.750 then 'flexible'
  when (due_at at time zone 'America/Los_Angeles')::date <= (now() at time zone 'America/Los_Angeles')::date then 'today'
  when (due_at at time zone 'America/Los_Angeles')::date <= (now() at time zone 'America/Los_Angeles')::date + 7 then 'this_week'
  when (due_at at time zone 'America/Los_Angeles')::date <= (now() at time zone 'America/Los_Angeles')::date + 30 then 'upcoming'
  else 'flexible'
end;

update public.tasks
set
  priority_score =
    case importance when 'critical' then 40 when 'high' then 30 when 'normal' then 20 when 'low' then 10 else 0 end
    + case urgency when 'today' then 30 when 'this_week' then 20 when 'upcoming' then 10 else 0 end
    + case
        when deadline_type = 'hard' and due_date_confidence >= 0.750 and due_at is not null then 20
        when deadline_type = 'soft' and due_date_confidence >= 0.750 and due_at is not null then 14
        else 0
      end
    + case
        when lower(concat_ws(' ', title, area, project, classification, next_action, array_to_string(tags, ' '))) ~
          '(^|[^a-z])(medical|doctor|dentist|dental|orthodont|physical therapy|eye appointment|hearing appointment|pediatric|pulmonology|blood work|blood-work|mental health therapy|payroll|safety|osha|legal|court|financial loss|late fee|penalty|blocks?|blocking)([^a-z]|$)'
          then 10
        else 0
      end
    + case when manually_pinned then 100 else 0 end
    + case
        when deadline_type in ('hard', 'soft')
          and due_date_confidence >= 0.750
          and (due_at at time zone 'America/Los_Angeles')::date < (now() at time zone 'America/Los_Angeles')::date then 5
        else 0
      end,
  priority_reason = case
    when manually_pinned then 'User pinned'
    when deadline_type = 'hard' and due_date_confidence >= 0.750
      and (due_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date then 'Hard deadline today'
    when lower(concat_ws(' ', title, area, project, classification)) ~ '(^|[^a-z])(medical|doctor|dentist|dental|orthodont|physical therapy|eye appointment|hearing appointment|pediatric|pulmonology|blood work|blood-work|mental health therapy)([^a-z]|$)' then 'Medical care'
    when lower(concat_ws(' ', title, area, project, classification)) ~ '(^|[^a-z])(financial loss|late fee|penalty|lease-end bill|lien|insurance lapse)([^a-z]|$)' then 'Prevents financial loss'
    when lower(concat_ws(' ', title, area, project, classification)) ~ '(^|[^a-z])(payroll|pay employees|paycheck)([^a-z]|$)' then 'Payroll obligation'
    when lower(concat_ws(' ', title, area, project, classification)) ~ '(^|[^a-z])(safety|osha|injury log|tailgate training)([^a-z]|$)' then 'Safety obligation'
    when lower(concat_ws(' ', title, area, project, classification)) ~ '(^|[^a-z])(legal|court|legal filing|court filing|regulatory filing|compliance deadline|subpoena)([^a-z]|$)' then 'Legal obligation'
    when urgency = 'today' then 'Due today'
    when urgency = 'this_week' then 'Due this week'
    when importance = 'critical' then 'Critical importance'
    when importance = 'high' then 'High importance'
    else 'Ready next action'
  end;

create table if not exists private.task_priority_review_queue (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  review_reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  classification_confidence numeric(4,3) not null check (classification_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.task_priority_review_queue enable row level security;
revoke all on table private.task_priority_review_queue from public, anon, authenticated;

insert into private.task_priority_review_queue (
  task_id,
  household_id,
  review_reason,
  classification_confidence
)
select
  id,
  household_id,
  'Potentially consequential task needs deadline or importance confirmation.',
  priority_classification_confidence
from public.tasks
where deleted_at is null
  and status in ('open', 'in_progress')
  and priority_classification_confidence < 0.650
  and (importance = 'critical' or priority_score >= 50)
  and coalesce(waiting_on, '') = ''
  and blocked = false
on conflict (task_id) do update
set
  review_reason = excluded.review_reason,
  classification_confidence = excluded.classification_confidence,
  updated_at = now();

create index if not exists task_priority_review_queue_household_status_idx
  on private.task_priority_review_queue (household_id, status, updated_at desc);

create or replace function private.pepper_task_universal_fields()
returns trigger
language plpgsql
set search_path to 'public', 'private'
as $function$
declare
  normalized_priority text;
  task_context text;
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
  new.importance := coalesce(nullif(lower(btrim(new.importance)), ''), 'normal');
  new.urgency := coalesce(nullif(lower(btrim(new.urgency)), ''), 'flexible');
  new.deadline_type := coalesce(nullif(lower(btrim(new.deadline_type)), ''), 'none');
  new.due_date_confidence := coalesce(new.due_date_confidence, 0);
  new.blocked := coalesce(new.blocked, false);
  new.manually_pinned := coalesce(new.manually_pinned, false);
  new.daily_plan_state := coalesce(nullif(lower(btrim(new.daily_plan_state)), ''), 'eligible');
  new.priority_score := coalesce(new.priority_score, 0);
  new.priority_reason := coalesce(new.priority_reason, '');
  new.estimated_minutes := coalesce(new.estimated_minutes, 45);
  new.priority_classification_confidence := coalesce(new.priority_classification_confidence, 0.500);

  if tg_op = 'INSERT' then
    normalized_priority := lower(new.priority);
    task_context := lower(concat_ws(
      ' ', new.title, new.area, new.project, new.classification,
      new.notes, new.next_action, array_to_string(new.tags, ' ')
    ));

    if new.importance = 'normal' then
      new.importance := case
        when normalized_priority ~ '(^|[^a-z0-9])(p0|critical|urgent|highest)([^a-z0-9]|$)' then 'critical'
        when normalized_priority ~ '(^|[^a-z0-9])(p1|high)([^a-z0-9]|$)' then 'high'
        when normalized_priority ~ '(^|[^a-z0-9])(p3|low|later)([^a-z0-9]|$)' then 'low'
        when normalized_priority ~ '(^|[^a-z0-9])someday([^a-z0-9]|$)' then 'someday'
        else 'normal'
      end;
    end if;

    if new.due_at is null then
      new.deadline_type := 'none';
      new.due_date_confidence := 0;
      new.urgency := 'flexible';
    else
      if new.deadline_type = 'none' then
        new.deadline_type := case
          when task_context ~ '(^|[^a-z])(payroll|tax filing|court date|legal filing|hard deadline|filing deadline|safety log due|must be (done|filed|paid|submitted) by)([^a-z]|$)'
            then 'hard'
          else 'soft'
        end;
      end if;
      if new.due_date_confidence = 0 then
        new.due_date_confidence := case
          when new.deadline_type = 'hard' then 0.950
          when lower(coalesce(new.source, '')) in ('pepper', 'pepper_capture', 'pepper_personal', 'pepper_chore') then 0.800
          when new.source_record <> '' then 0.450
          else 0.650
        end;
      end if;
      if new.due_date_confidence >= 0.750 then
        new.urgency := case
          when (new.due_at at time zone 'America/Los_Angeles')::date <= (now() at time zone 'America/Los_Angeles')::date then 'today'
          when (new.due_at at time zone 'America/Los_Angeles')::date <= (now() at time zone 'America/Los_Angeles')::date + 7 then 'this_week'
          when (new.due_at at time zone 'America/Los_Angeles')::date <= (now() at time zone 'America/Los_Angeles')::date + 30 then 'upcoming'
          else 'flexible'
        end;
      end if;
    end if;

    new.blocked := new.blocked
      or new.status = 'on_hold'
      or lower(new.classification) = 'blocked'
      or lower(new.notes) like '%source status: blocked%';
    if new.estimated_minutes = 45 then
      new.estimated_minutes := case
        when lower(new.classification) = 'chore' or lower(new.area) = 'chores' then 30
        when task_context ~ '(^|[^a-z])(write|revise|manuscript|chapter|compile|proposal|bid)([^a-z]|$)' then 90
        when lower(new.title) ~ '(^|[^a-z])(call|email|confirm|schedule|book|upload|send|order|pay)([^a-z]|$)' then 30
        else 45
      end;
    end if;
    new.priority_classification_confidence := case
      when task_context ~ '(^|[^a-z])(medical|doctor|dentist|dental|orthodont|physical therapy|eye appointment|hearing appointment|pediatric|pulmonology|blood work|blood-work|mental health therapy|payroll|safety|osha|legal|court|financial loss|late fee|penalty)([^a-z]|$)' then 0.900
      when new.source_record <> '' then 0.550
      when new.priority <> '' and new.project <> '' then 0.750
      else 0.500
    end;
    new.priority_score :=
      case new.importance when 'critical' then 40 when 'high' then 30 when 'normal' then 20 when 'low' then 10 else 0 end
      + case new.urgency when 'today' then 30 when 'this_week' then 20 when 'upcoming' then 10 else 0 end
      + case
          when new.deadline_type = 'hard' and new.due_date_confidence >= 0.750 then 20
          when new.deadline_type = 'soft' and new.due_date_confidence >= 0.750 then 14
          else 0
        end
      + case
          when task_context ~ '(^|[^a-z])(medical|doctor|dentist|dental|orthodont|physical therapy|eye appointment|hearing appointment|pediatric|pulmonology|blood work|blood-work|mental health therapy|payroll|safety|osha|legal|court|financial loss|late fee|penalty|blocks?|blocking)([^a-z]|$)' then 10
          else 0
        end
      + case when new.manually_pinned then 100 else 0 end
      + case
          when new.deadline_type in ('hard', 'soft')
            and new.due_date_confidence >= 0.750
            and (new.due_at at time zone 'America/Los_Angeles')::date < (now() at time zone 'America/Los_Angeles')::date then 5
          else 0
        end;
    new.priority_reason := case
      when new.manually_pinned then 'User pinned'
      when new.deadline_type = 'hard' and new.due_date_confidence >= 0.750
        and (new.due_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date then 'Hard deadline today'
      when task_context ~ '(^|[^a-z])(medical|doctor|dentist|dental|orthodont|physical therapy|eye appointment|hearing appointment|pediatric|pulmonology|blood work|blood-work|mental health therapy)([^a-z]|$)' then 'Medical care'
      when task_context ~ '(^|[^a-z])(financial loss|late fee|penalty|lease-end bill|lien|insurance lapse)([^a-z]|$)' then 'Prevents financial loss'
      when task_context ~ '(^|[^a-z])(payroll|pay employees|paycheck)([^a-z]|$)' then 'Payroll obligation'
      when task_context ~ '(^|[^a-z])(safety|osha|injury log|tailgate training)([^a-z]|$)' then 'Safety obligation'
      when task_context ~ '(^|[^a-z])(legal|court|legal filing|court filing|regulatory filing|compliance deadline|subpoena)([^a-z]|$)' then 'Legal obligation'
      when new.urgency = 'today' then 'Due today'
      when new.urgency = 'this_week' then 'Due this week'
      when new.importance = 'critical' then 'Critical importance'
      when new.importance = 'high' then 'High importance'
      else 'Ready next action'
    end;
  end if;

  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.completed_at := coalesce(new.completed_at, now());
    new.daily_plan_state := 'complete';
    new.manually_pinned := false;
  elsif new.status = 'canceled' then
    new.daily_plan_state := 'complete';
    new.manually_pinned := false;
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status is distinct from 'completed' then
    new.completed_at := null;
    new.daily_plan_state := 'eligible';
  elsif new.blocked then
    new.daily_plan_state := 'blocked';
  elsif new.waiting_on <> '' then
    new.daily_plan_state := 'waiting';
  end if;

  return new;
end;
$function$;
