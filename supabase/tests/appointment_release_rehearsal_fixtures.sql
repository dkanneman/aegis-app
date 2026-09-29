-- Synthetic-only fixtures for the isolated appointment release rehearsal.
-- This legacy destination is unverified, not evidence of a Google connection.
-- Simulated successful/failed probes belong to the explicit verification tests.

insert into public.households(id,slug,name,created_at) values
  ('00000000-0000-4000-8000-000000000001','pepper-test','[PEPPER TEST] Household','2026-09-16T12:00:00Z');

insert into public.household_members(id,household_id,slug,display_name,role,created_at) values
  ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','adult','[PEPPER TEST] Adult','adult_admin','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','teen','[PEPPER TEST] Teen','teen','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','matt','[PEPPER TEST] Matt','adult','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000001','child','[PEPPER TEST] Child','child','2026-09-16T12:00:00Z');

insert into public.households(id,slug,name,created_at) values
  ('00000000-0000-4000-8000-000000000002','pepper-other-test','[PEPPER TEST] Other household','2026-09-16T12:00:00Z');

insert into public.household_members(id,household_id,slug,display_name,role,created_at) values
  ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000002','other-adult','[PEPPER TEST] Other adult','adult_admin','2026-09-16T12:00:00Z');

insert into public.member_sessions(token,member_id,device_label,expires_at) values
  ('10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','[PEPPER TEST] Danielle device','2026-10-16T12:00:00Z'),
  ('10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000012','[PEPPER TEST] Teen device','2026-10-16T12:00:00Z'),
  ('10000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000013','[PEPPER TEST] Matt device','2026-10-16T12:00:00Z'),
  ('10000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000014','[PEPPER TEST] Child device','2026-10-16T12:00:00Z'),
  ('10000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000021','[PEPPER TEST] Other device','2026-10-16T12:00:00Z');

insert into public.calendar_connections(
  id,household_id,connected_by_member_id,provider,provider_calendar_id,calendar_name,
  calendar_time_zone,access_scope,status,sync_status,last_error,created_at,updated_at
) values (
  '00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000011','google','synthetic@group.calendar.google.com',
  'Pepper Sandbox','America/Los_Angeles','calendar.readonly','disconnected','never',null,
  '2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'
);

insert into public.captures(id,household_id,member_id,source,original_text,status,dedupe_key,captured_at,updated_at)
select
  ('00000000-0000-4000-8000-' || lpad(value::text,12,'0'))::uuid,
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000011','text',
  '[PEPPER TEST] synthetic appointment source ' || value,'applied',
  'pepper-test-capture-' || value,'2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'
from generate_series(101,107) as value;

insert into public.events(
  id,household_id,title,person_slug,starts_at,ends_at,location,status,visibility,kind,source,
  external_connection_id,external_provider,external_event_id,external_calendar_id,sync_status,
  dedupe_key,original_source_text,source_timezone,appointment_type,scheduling_priority,
  patient_member_id,created_at,updated_at
) values
  ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Doctor','teen','2026-09-19T20:45:00Z','2026-09-19T21:45:00Z','Clinic A','confirmed','household','appointment','pepper','00000000-0000-4000-8000-000000000021','google','synthetic-google-1','synthetic@group.calendar.google.com','synced','pepper-test-event-1','09/19 at 1:45 PM PDT','America/Los_Angeles','doctor',100,'00000000-0000-4000-8000-000000000012','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Physical Therapy','teen','2026-10-01T15:00:00Z','2026-10-01T16:00:00Z','Two Trees PT','confirmed','household','appointment','pepper',null,null,null,null,'local','pepper-test-event-2','Oct 1st at 8am','America/Los_Angeles','physical_therapy',100,'00000000-0000-4000-8000-000000000012','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Dental','adult','2026-09-20T17:00:00Z','2026-09-20T18:00:00Z','Dental A','confirmed','household','appointment','pepper','00000000-0000-4000-8000-000000000021','google','stale-google-id','synthetic@group.calendar.google.com','retry_required','pepper-test-event-3','Dental synthetic','America/Los_Angeles','dental',100,'00000000-0000-4000-8000-000000000011','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000204','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Orthodontic','teen','2026-09-22T17:00:00Z','2026-09-22T18:00:00Z','Ortho A','confirmed','household','appointment','pepper',null,null,null,null,'local','pepper-test-event-4','Orthodontic synthetic','America/Los_Angeles','orthodontic',100,'00000000-0000-4000-8000-000000000012','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000205','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Therapy','adult','2026-09-23T17:00:00Z','2026-09-23T18:00:00Z','Telehealth','confirmed','private','appointment','pepper',null,null,null,null,'local','pepper-test-event-5','Mental health synthetic','America/Los_Angeles','mental_health_therapy',100,'00000000-0000-4000-8000-000000000011','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000206','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Medical Other','adult','2026-09-24T17:00:00Z','2026-09-24T18:00:00Z','Clinic B','tentative','household','appointment','pepper',null,null,null,null,'local','pepper-test-event-6','Medical synthetic','America/Los_Angeles','medical_other',100,'00000000-0000-4000-8000-000000000011','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000207','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Canceled Doctor','adult','2026-09-25T17:00:00Z','2026-09-25T18:00:00Z','Clinic C','canceled','household','appointment','pepper','00000000-0000-4000-8000-000000000021','google','synthetic-google-7','synthetic@group.calendar.google.com','synced','pepper-test-event-7','Canceled synthetic','America/Los_Angeles','doctor',100,'00000000-0000-4000-8000-000000000011','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z');

insert into public.tasks(
  id,household_id,title,owner_member_id,visibility,status,due_at,source,area,project,priority,
  classification,tags,notes,next_action,created_at,updated_at
) values
  ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Confirm transport','00000000-0000-4000-8000-000000000011','household','open',now()+interval '1 day','pepper_medical_coordination','Family','Medical coordination','P0','Medical coordination','{medical,coordination}','Synthetic','Confirm ride','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Future school release','00000000-0000-4000-8000-000000000011','household','open',now()+interval '14 days','pepper_medical_coordination','Family','Medical coordination','P0','Medical coordination','{medical,coordination}','Synthetic','Coordinate school release','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Bring forms','00000000-0000-4000-8000-000000000011','household','open',now()+interval '14 days','pepper_medical_coordination','Family','Medical coordination','P0','Medical coordination','{medical,coordination}','Synthetic','Prepare paperwork','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000304','00000000-0000-4000-8000-000000000001','[PEPPER TEST] Old manuscript','00000000-0000-4000-8000-000000000011','private','open',now()-interval '120 days','pepper','Work','Manuscript','P2','Open','{}','Synthetic','Review later','2026-01-01T12:00:00Z','2026-01-01T12:00:00Z');

insert into private.appointment_bridge_deliveries(
  event_id,capture_id,household_id,normalized_payload,aegis_status,google_status,
  attempt_count,last_error,created_at,updated_at
) values
  ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','{"synthetic":true,"state":"complete"}','synced','synced',1,null,'2026-09-16T12:00:00Z','2026-09-16T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000001','{"synthetic":true,"state":"pending"}','pending','pending',2,'Synthetic pending delivery','2026-09-16T12:00:00Z','2026-09-16T12:00:00Z');
