import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { calendarProposalResponse, replyForPlan, ADULT_CALENDAR_REVIEW_REQUIRED } from '../supabase/functions/pepper-tell-v2/logic.ts'

import {
  authorizeCalendarContribution,
  calendarMutationActionKey,
  calendarMutationKind,
  parseExpectedEventRevision,
} from '../supabase/functions/_shared/calendar-contribution.ts'

const familyApi = await readFile(new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url),'utf8')
const tell = await readFile(new URL('../supabase/functions/pepper-tell-v2/index.ts', import.meta.url),'utf8')
const calendar = await readFile(new URL('../supabase/functions/pepper-calendar/index.ts', import.meta.url),'utf8')
const migration = await readFile(new URL('../supabase/migrations/20260917211929_authorize_household_calendar_contributions.sql', import.meta.url),'utf8')

const actor = {
  id:'member-matt',household_id:'household-a',role:'adult',session_id:'session-matt',
  active:true,removed_at:null,
}
const event = {household_id:'household-a',visibility:'household'}
const connection = {household_id:'household-a'}

test('an active adult may contribute to the reviewed Calendar for the same household',()=>{
  assert.deepEqual(authorizeCalendarContribution(actor,event,connection),{allowed:true})
})

test('child additions require review and cannot invoke an adult Calendar write',()=>{
  assert.deepEqual(
    authorizeCalendarContribution({...actor,role:'child'},event,connection),
    {allowed:false,state:'needs_review',reason:'adult_approval_required'},
  )
  assert.match(tell,/requireAdultCalendarReview/)
  assert.match(ADULT_CALENDAR_REVIEW_REQUIRED,/An active family adult must approve this shared Calendar change/)
  assert.match(tell,/appointments: \[\]/)
})

test('review feedback cannot claim a calendar write or ask for a missing detail',()=>{
  const response=calendarProposalResponse()
  assert.equal(response.mode,'review')
  assert.match(response.reply,/awaiting review by a family adult/)
  assert.match(response.reply,/No calendar event has been added, changed, or canceled/)
  assert.equal(response.clarification,undefined)
  assert.equal(response.undoable,false)
  assert.doesNotMatch(replyForPlan('needs_review',['Event added to the calendar.']),/Done|added to the calendar/)
  assert.match(replyForPlan('applied',['Event added to the calendar.']),/^Done\./)
})

test('inactive and removed members are rejected',()=>{
  assert.equal(authorizeCalendarContribution({...actor,active:false,removed_at:'2026-09-17T00:00:00Z'},event,connection).allowed,false)
  assert.match(familyApi,/m\.active=true and m\.removed_at is null/)
  assert.match(tell,/m\.active=true and m\.removed_at is null/)
  assert.match(calendar,/m\.active = true[\s\S]*m\.removed_at is null/)
})

test('event and Calendar connection must belong to the authenticated member household',()=>{
  assert.deepEqual(
    authorizeCalendarContribution(actor,{...event,household_id:'household-b'},connection),
    {allowed:false,state:'forbidden',reason:'event_household_mismatch'},
  )
  assert.deepEqual(
    authorizeCalendarContribution(actor,event,{household_id:'household-b'}),
    {allowed:false,state:'forbidden',reason:'calendar_household_mismatch'},
  )
  assert.match(calendar,/request\.household_id=\$\{event\.household_id\}/)
})

test('private events never fall through to the shared external Calendar',()=>{
  assert.deepEqual(
    authorizeCalendarContribution(actor,{...event,visibility:'private'},connection),
    {allowed:false,state:'needs_review',reason:'private_event_not_publishable'},
  )
  assert.match(familyApi,/private_event_not_publishable/)
})

test('action identities are deterministic and operation-specific',()=>{
  const input={eventId:'event-1',action:'create',actorMemberId:'member-matt',sessionId:'session-matt',requestId:'capture-1:0'}
  assert.equal(calendarMutationActionKey(input),calendarMutationActionKey(input))
  assert.notEqual(calendarMutationActionKey(input),calendarMutationActionKey({...input,action:'cancel'}))
  assert.equal(calendarMutationKind('event.create'),'create')
  assert.equal(calendarMutationKind('cancel'),'cancel')
  assert.equal(calendarMutationKind('edit'),'update')
})

test('family event changes use the authenticated session and optimistic version',()=>{
  const updateFamilyItem = familyApi.slice(
    familyApi.indexOf('async function updateFamilyItem'),
    familyApi.indexOf('async function sectionState'),
  )
  assert.match(familyApi,/select m\.id,m\.household_id[\s\S]*s\.session_id/)
  assert.match(familyApi,/parseExpectedEventRevision\(body\.expected_revision\)/)
  assert.match(familyApi,/revision=\$\{expectedRevision\}::bigint/)
  assert.match(familyApi,/last_calendar_action_id=\$\{actionRows\[0\]\.id\}::uuid/)
  assert.match(familyApi,/last_modified_by_member_id=\$\{member\.id\}/)
  assert.match(familyApi,/last_modified_session_id=\$\{member\.session_id\}/)
  assert.match(familyApi,/revision=revision\+1/)
  assert.doesNotMatch(updateFamilyItem,/public\.events[\s\S]*updated_at=\$\{expectedUpdatedAt\}/)
  assert.doesNotMatch(updateFamilyItem,/body\.(member_id|actor_member_id)/)
})

test('event revisions reject missing, fractional, string, negative, and unsafe values',()=>{
  assert.equal(parseExpectedEventRevision(1),1)
  for(const value of [undefined,null,'1',0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>parseExpectedEventRevision(value),/Refresh this event/)
  }
})

test('editable event payloads expose revision and updated_at only as metadata',()=>{
  assert.match(familyApi,/e\.sync_attempt_count,e\.revision,e\.updated_at/)
  assert.match(familyApi,/expected_revision:expectedRevision/)
  assert.match(familyApi,/Number\.isSafeInteger\(revision\)/)
  assert.match(familyApi,/events\.map\(eventWithRevision\)/)
  assert.doesNotMatch(familyApi,/expected_updated_at_input/)
})

test('create, update, cancellation, retry and replay use immutable mutation evidence',()=>{
  assert.match(migration,/create table if not exists private\.calendar_event_mutation_requests/)
  assert.match(migration,/Calendar mutation evidence is immutable/)
  assert.match(migration,/on conflict \(action_key\) do nothing/)
  assert.match(migration,/expected_revision bigint/)
  assert.match(migration,/before_revision=expected_revision/)
  assert.match(migration,/after_revision=expected_revision\+1/)
  assert.match(tell,/recordAppliedCalendarMutations/)
  assert.match(tell,/select id from private\.calendar_event_mutation_requests where action_key=/)
  assert.match(calendar,/last_calendar_action_id/)
  assert.match(calendar,/calendar_event_revision_mismatch/)
  assert.match(calendar,/calendar_cancel_evidence_missing/)
})

test('the family API records evidence and changes one canonical revision atomically',()=>{
  const updateFamilyItem = familyApi.slice(
    familyApi.indexOf('async function updateFamilyItem'),
    familyApi.indexOf('async function sectionState'),
  )
  const evidenceIndex=updateFamilyItem.indexOf('private.pepper_record_calendar_event_mutation')
  const conditionalUpdateIndex=updateFamilyItem.indexOf('update public.events set',evidenceIndex)
  const auditIndex=updateFamilyItem.indexOf('insert into public.audit_log',conditionalUpdateIndex)
  assert.ok(evidenceIndex>0)
  assert.ok(conditionalUpdateIndex>evidenceIndex)
  assert.ok(auditIndex>conditionalUpdateIndex)
  assert.match(updateFamilyItem,/and revision=\$\{expectedRevision\}::bigint/)
  assert.match(updateFamilyItem,/revision=revision\+1/)
  assert.match(updateFamilyItem,/if\(priorActions\[0\]\)[\s\S]*idempotent_replay:true/)
  assert.match(updateFamilyItem,/result\.idempotent_replay/)
})

test('the Calendar worker rechecks the adult and household boundary before Google access',()=>{
  const authIndex=calendar.indexOf('const contribution = await authorizePublishedEvent')
  const refreshIndex=calendar.indexOf('accessToken = await refreshAccessToken',authIndex)
  assert.ok(authIndex>0)
  assert.ok(refreshIndex>authIndex)
  assert.match(calendar,/calendar_mutation_evidence_missing/)
  assert.match(calendar,/calendar_actor_mismatch/)
  assert.match(calendar,/calendar_session_mismatch/)
  assert.match(calendar,/status: 'needs_review'/)
})

test('Google credentials stay server-side and no invitations are introduced',()=>{
  assert.doesNotMatch(familyApi,/refresh_token|access_token|client_secret/)
  assert.doesNotMatch(tell,/refresh_token|access_token|client_secret/)
  assert.match(calendar,/refresh_token/)
  assert.match(calendar,/sendUpdates=none/)
  assert.doesNotMatch(calendar,/sendUpdates=(all|externalOnly)/)
  assert.doesNotMatch(calendar,/attendees\s*:/)
})

test('the migration preserves least privilege and does not trust user metadata',()=>{
  assert.match(migration,/enable row level security/)
  assert.match(migration,/revoke all on private\.calendar_event_mutation_requests from public, anon, authenticated/)
  assert.match(migration,/member\.role in \('adult_admin','adult'\)/)
  assert.match(migration,/session\.member_id=actor_member_id_input/)
  assert.match(migration,/column_name='source_capture_id'/)
  assert.match(migration,/extensions\.digest\(request_input::text,'sha256'\)/)
  assert.match(migration,/calendar_event_mutation_actor_idx/)
  assert.match(migration,/events_last_calendar_action_idx/)
  assert.doesNotMatch(migration,/user_meta_data|raw_user_meta_data|auth\.jwt/)
  assert.doesNotMatch(migration,/token text|refresh_token|access_token/)
})

test('shared events created through Tell Pepper are published without exposing Google to the client',()=>{
  assert.match(tell,/syncSharedCalendarEvents/)
  assert.match(tell,/action: 'publish_event'/)
  assert.match(tell,/authorization: `Bearer \$\{SERVICE_ROLE_KEY\}`/)
  assert.match(tell,/shared_calendar_complete/)
  assert.match(tell,/Saved in Pepper\. Shared Calendar delivery still needs attention\./)
})

test('the Calendar destination remains the one reviewed Pepper-created household calendar',()=>{
  assert.match(calendar,/validateStoredCalendarAccess/)
  assert.match(calendar,/event\.external_calendar_id \|\| connection\.provider_calendar_id/)
  assert.match(calendar,/connectionForHousehold\(event\.household_id\)/)
  assert.doesNotMatch(calendar,/calendarList/i)
})
