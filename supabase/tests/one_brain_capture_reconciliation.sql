-- Run against a disposable database after all migrations:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/one_brain_capture_reconciliation.sql
-- The transaction always rolls back. Never point this test at production.

begin;

create or replace function pg_temp.assert_true(value boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(value, false) then raise exception 'assertion failed: %', message; end if;
end;
$$;

insert into public.households(id,slug,name)
values ('10000000-0000-4000-8000-000000000001','one-brain-test','One Brain Test');
insert into public.household_members(id,household_id,slug,display_name,role) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','tester','Tester','adult_admin'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','other','Other','adult');

-- Existing V5.1 service-role task writes must continue through the trace trigger
-- even though direct execution of private trace helpers is revoked.
set local role service_role;
insert into public.tasks(id,household_id,title,visibility,status,source)
values (
  '40000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001',
  'Existing V5.1 task path','household','open','pepper'
);
update public.tasks set status='completed' where id='40000000-0000-4000-8000-000000000010';
insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary)
values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  'task_completed','task','40000000-0000-4000-8000-000000000010','Existing task completed.'
);
reset role;
select pg_temp.assert_true(
  (select status='completed' from public.tasks where id='40000000-0000-4000-8000-000000000010')
  and exists(select 1 from public.audit_log where entity_id='40000000-0000-4000-8000-000000000010'),
  'service-role task completion and audit should remain intact'
);

-- Successful full application, actor/capture traceability, and downstream
-- responsibility provenance through the existing task trigger.
insert into public.captures(
  id,household_id,member_id,source,original_text,status,aegis_sync_status
) values (
  '30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','text','Please buy milk','captured','captured'
);

select private.apply_capture_plan(
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'full-application',
  '{
    "version":1,"kind":"initial","outcome":"applied","safe_subset_declared":false,
    "extracted_facts":["Please buy milk"],"remaining_ambiguities":[],
    "writes":[{
      "operation":"task.create","record_id":"40000000-0000-4000-8000-000000000001",
      "title":"Buy milk","visibility":"household","status":"open","source":"pepper_capture"
    }]
  }'::jsonb
);

select pg_temp.assert_true(
  (select status='applied' and aegis_sync_status='synced'
   from public.captures where id='30000000-0000-4000-8000-000000000001'),
  'full application should reconcile the capture'
);
select pg_temp.assert_true(
  (select count(*)=1 from public.tasks where id='40000000-0000-4000-8000-000000000001'),
  'full application should create exactly one canonical task'
);
select pg_temp.assert_true(
  exists(
    select 1 from public.state_changes
    where capture_id='30000000-0000-4000-8000-000000000001'
      and actor_member_id='20000000-0000-4000-8000-000000000001'
      and entity_type='task' and entity_id='40000000-0000-4000-8000-000000000001'
  ),
  'state change should retain capture and actor'
);
select pg_temp.assert_true(
  exists(
    select 1 from public.responsibilities
    where task_id='40000000-0000-4000-8000-000000000001'
      and originating_capture_id='30000000-0000-4000-8000-000000000001'
      and last_actor_member_id='20000000-0000-4000-8000-000000000001'
  ),
  'downstream responsibility should retain capture and actor'
);

-- Idempotent lost-response retry: same key and same plan returns the prior result
-- without a second task, state change, or ledger row.
select private.apply_capture_plan(
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'full-application',
  '{
    "version":1,"kind":"initial","outcome":"applied","safe_subset_declared":false,
    "extracted_facts":["Please buy milk"],"remaining_ambiguities":[],
    "writes":[{
      "operation":"task.create","record_id":"40000000-0000-4000-8000-000000000001",
      "title":"Buy milk","visibility":"household","status":"open","source":"pepper_capture"
    }]
  }'::jsonb
);
select pg_temp.assert_true(
  (select count(*)=1 from public.tasks where id='40000000-0000-4000-8000-000000000001')
  and (select count(*)=1 from private.capture_plan_applications
       where capture_id='30000000-0000-4000-8000-000000000001'),
  'idempotent retry must not duplicate canonical state'
);

-- Mid-plan failure rolls back the earlier write in the same plan.
insert into public.captures(id,household_id,member_id,source,original_text,status,aegis_sync_status)
values (
  '30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','text','Two required changes','captured','captured'
);
do $$
begin
  perform private.apply_capture_plan(
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001','rollback-test',
    '{
      "version":1,"kind":"initial","outcome":"applied","safe_subset_declared":false,
      "extracted_facts":["Two required changes"],"remaining_ambiguities":[],
      "writes":[
        {"operation":"task.create","record_id":"40000000-0000-4000-8000-000000000002","title":"Must roll back","visibility":"household"},
        {"operation":"task.update","record_id":"40000000-0000-4000-8000-000000000099","status":"completed"}
      ]
    }'::jsonb
  );
  raise exception 'expected mid-plan failure';
exception when sqlstate 'P0002' then null;
end;
$$;
select pg_temp.assert_true(
  not exists(select 1 from public.tasks where id='40000000-0000-4000-8000-000000000002')
  and (select status='captured' from public.captures where id='30000000-0000-4000-8000-000000000002')
  and not exists(select 1 from private.capture_plan_applications where capture_id='30000000-0000-4000-8000-000000000002'),
  'mid-plan failure must roll back every canonical write and ledger result'
);

-- Explicit partial safe application.
insert into public.captures(id,household_id,member_id,source,original_text,status,aegis_sync_status)
values (
  '30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','text','Buy bread and maybe move Saturday','captured','captured'
);
select private.apply_capture_plan(
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001','partial-test',
  '{
    "version":1,"kind":"initial","outcome":"partially_applied","safe_subset_declared":true,
    "extracted_facts":["Buy bread","maybe move Saturday"],
    "remaining_ambiguities":["maybe move Saturday"],
    "writes":[{"operation":"task.create","record_id":"40000000-0000-4000-8000-000000000003","title":"Buy bread","visibility":"household"}]
  }'::jsonb
);
select pg_temp.assert_true(
  (select status='partially_applied' and aegis_sync_status='needs_review'
   from public.captures where id='30000000-0000-4000-8000-000000000003')
  and exists(select 1 from public.tasks where id='40000000-0000-4000-8000-000000000003'),
  'declared safe subset should commit and retain review state'
);

-- Chloe acceptance case: preserve raw member-private input, invent no records,
-- and keep it visible only in Chloe's member-scoped review list.
insert into public.captures(
  id,household_id,member_id,source,original_text,status,aegis_sync_status,sharing_scope
) values (
  '30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','text',
  'Chloe is starting a six week running plan with mileage that may change',
  'captured','captured','member_private'
);
select private.apply_capture_plan(
  '30000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000001','chloe-review',
  '{
    "version":1,"kind":"initial","outcome":"needs_review","safe_subset_declared":false,
    "extracted_facts":["Chloe running plan"],
    "remaining_ambiguities":["Schedule, ownership, and milestones are not explicit"],"writes":[]
  }'::jsonb
);
select pg_temp.assert_true(
  (select status='needs_review' and aegis_sync_status='needs_review'
   from public.captures where id='30000000-0000-4000-8000-000000000004')
  and not exists(select 1 from public.state_changes where capture_id='30000000-0000-4000-8000-000000000004')
  and exists(select 1 from private.list_capture_reviews('20000000-0000-4000-8000-000000000001',50)
             where capture_id='30000000-0000-4000-8000-000000000004')
  and not exists(select 1 from private.list_capture_reviews('20000000-0000-4000-8000-000000000002',50)
                 where capture_id='30000000-0000-4000-8000-000000000004'),
  'ambiguous running plan must stay private, write nothing, and remain reviewable'
);

-- Actor attribution cannot be forged by another household member.
do $$
begin
  perform private.resolve_capture_review(
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000002','wrong-actor',
    '{"version":1,"kind":"review_resolution","outcome":"applied","resolution":"no_change_required","safe_subset_declared":false,"extracted_facts":[],"remaining_ambiguities":[],"writes":[]}'::jsonb
  );
  raise exception 'expected privacy failure';
exception when insufficient_privilege then null;
end;
$$;

-- Phase 3 dry-run machinery: exact IDs, counts, and existing canonical refs pass;
-- any unexpected count fails closed and applies zero writes.
select private.capture_backlog_dry_run(
  array[
    '30000000-0000-4000-8000-000000000002'::uuid,
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid
  ],
  3,
  '[{"capture_id":"30000000-0000-4000-8000-000000000003","entity_type":"task","record_id":"40000000-0000-4000-8000-000000000003"}]'::jsonb
);
do $$
begin
  perform private.capture_backlog_dry_run(
    array[
      '30000000-0000-4000-8000-000000000002'::uuid,
      '30000000-0000-4000-8000-000000000003'::uuid,
      '30000000-0000-4000-8000-000000000004'::uuid
    ],
    2,
    '[{"capture_id":"30000000-0000-4000-8000-000000000003","entity_type":"task","record_id":"40000000-0000-4000-8000-000000000003"}]'::jsonb
  );
  raise exception 'expected fail-closed count mismatch';
exception when sqlstate 'P0003' then null;
end;
$$;

rollback;
