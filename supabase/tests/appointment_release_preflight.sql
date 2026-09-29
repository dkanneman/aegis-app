-- Read-only release preflight. Run before applying appointment migrations.
with duplicate_keys as (
  select household_id,dedupe_key,count(*) as record_count,array_agg(id order by created_at) as event_ids
  from public.events
  where dedupe_key is not null and deleted_at is null
  group by household_id,dedupe_key
  having count(*) > 1
), malformed_times as (
  select id,starts_at,ends_at
  from public.events
  where starts_at is null or (ends_at is not null and ends_at <= starts_at)
), invalid_types as (
  select id,appointment_type
  from public.events
  where appointment_type is not null
    and appointment_type not in (
      'doctor','dental','orthodontic','physical_therapy','mental_health_therapy','medical_other'
    )
), orphaned_deliveries as (
  select delivery.event_id,delivery.capture_id
  from private.appointment_bridge_deliveries delivery
  left join public.events event on event.id=delivery.event_id
  left join public.captures capture on capture.id=delivery.capture_id
  where event.id is null or capture.id is null or event.household_id is distinct from capture.household_id
)
select 'duplicate_dedupe_keys' as check_name,count(*)::bigint as issue_count from duplicate_keys
union all
select 'malformed_timestamps',count(*)::bigint from malformed_times
union all
select 'invalid_appointment_types',count(*)::bigint from invalid_types
union all
select 'orphaned_bridge_deliveries',count(*)::bigint from orphaned_deliveries
order by check_name;

select version,name
from supabase_migrations.schema_migrations
where version in (
  '20260915164500',
  '20260915175808',
  '20260915203426',
  '20260915203431',
  '20260916120000',
  '20260916143000',
  '20260916150000',
  '20260917211929'
)
order by version;

select
  count(*) filter (where jobname='pepper-calendar-sync') as calendar_sync_job_count,
  count(*) filter (
    where jobname='pepper-calendar-sync'
      and schedule='*/10 * * * *'
  ) as correctly_scheduled_calendar_job_count
from cron.job;

select count(*) as calendar_cron_secret_count
from vault.secrets
where name='pepper_calendar_cron_secret';

with required_columns(table_schema,table_name,column_name) as (
  values
    ('public','events','appointment_type'),
    ('public','events','clinician_name'),
    ('public','events','patient_member_id'),
    ('public','events','facility_name'),
    ('public','events','preparation_instructions'),
    ('public','events','original_source_text'),
    ('public','events','source_timezone'),
    ('public','events','scheduling_priority'),
    ('public','tasks','importance'),
    ('public','tasks','urgency'),
    ('public','tasks','deadline_type'),
    ('public','tasks','due_date_confidence'),
    ('public','tasks','waiting_follow_up_at'),
    ('public','tasks','blocked'),
    ('public','tasks','snoozed_until'),
    ('public','tasks','dismissed_for_date'),
    ('public','tasks','manually_pinned'),
    ('public','tasks','daily_plan_state'),
    ('public','tasks','priority_score'),
    ('public','tasks','priority_reason'),
    ('public','tasks','estimated_minutes'),
    ('public','tasks','priority_classification_confidence')
), present_columns as (
  select required.*,
    columns.column_name is not null as present
  from required_columns required
  left join information_schema.columns columns
    on columns.table_schema=required.table_schema
   and columns.table_name=required.table_name
   and columns.column_name=required.column_name
)
select
  count(*) filter (where present) as present_required_columns,
  count(*) as expected_required_columns,
  coalesce(bool_and(present),false) as structurally_equivalent
from present_columns;

select
  to_regclass('private.appointment_bridge_deliveries') is not null
    as appointment_bridge_deliveries_present,
  to_regclass('private.task_priority_review_queue') is not null
    as task_priority_review_queue_present,
  to_regprocedure('private.pepper_set_medical_scheduling_priority()') is not null
    as medical_priority_function_present,
  to_regprocedure('private.pepper_set_medical_coordination_priority()') is not null
    as medical_coordination_function_present,
  to_regprocedure('private.pepper_task_universal_fields()') is not null
    as task_priority_function_present,
  to_regprocedure('public.pepper_record_appointment_bridge(uuid,uuid,jsonb,text,text,text)') is not null
    as appointment_bridge_rpc_present;

select household_id,dedupe_key,count(*) as record_count,array_agg(id order by created_at) as event_ids
from public.events
where dedupe_key is not null and deleted_at is null
group by household_id,dedupe_key
having count(*) > 1
order by record_count desc,dedupe_key;

select
  count(*) filter (where kind='appointment') as appointment_count,
  count(*) filter (where kind='appointment' and appointment_type is not null) as typed_appointment_count,
  count(*) filter (where kind='appointment' and scheduling_priority=100) as fixed_priority_count,
  count(*) filter (where kind='appointment' and original_source_text is not null) as source_preserved_count,
  count(*) filter (where external_event_id is not null) as linked_google_event_count
from public.events
where deleted_at is null;

select id,title,starts_at,ends_at,appointment_type,source_timezone,dedupe_key,
  external_event_id,sync_status
from public.events
where kind='appointment' and deleted_at is null
order by updated_at desc
limit 20;
