// Required offline HTTP/database gate. Run with family_beta_local_worker.mjs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const endpoint = new URL(process.env.PEPPER_TEST_FAMILY_URL || '')
const database = new URL(process.env.PEPPER_TEST_DATABASE_URL || '')
for (const url of [endpoint, database]) assert.equal(url.hostname, '127.0.0.1')
function query(statement) {
  return execFileSync(process.env.PSQL_BIN, [database.href, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim()
}
const adult = randomUUID(), child = randomUUID(), other = randomUUID(), mattSession = randomUUID()
const member = randomUUID(), adultMember = randomUUID(), otherMember = randomUUID(), matt = randomUUID()
const teen = randomUUID(), teenMember = randomUUID()
const household = randomUUID(), otherHousehold = randomUUID()
const q = value => `'${String(value).replaceAll("'", "''")}'`
query(`insert into public.households(id,slug,name) values
  (${q(household)},${q(household)},'[PEPPER TEST] HTTP household'),
  (${q(otherHousehold)},${q(otherHousehold)},'[PEPPER TEST] Other household');
  insert into public.household_members(id,household_id,slug,display_name,role) values
  (${q(member)},${q(household)},'child','Test Child','child'),
  (${q(teenMember)},${q(household)},'teen','Test Teen','teen'),
  (${q(adultMember)},${q(household)},'adult','Test Adult','adult_admin'),
  (${q(matt)},${q(household)},'matt','Test Matt','adult'),
  (${q(otherMember)},${q(otherHousehold)},'other','Test Other','adult_admin');
  insert into public.member_sessions(token,member_id,expires_at) values
  (${q(adult)},${q(adultMember)},now()+interval '1 day'),
  (${q(child)},${q(member)},now()+interval '1 day'),
  (${q(teen)},${q(teenMember)},now()+interval '1 day'),
  (${q(mattSession)},${q(matt)},now()+interval '1 day'),
  (${q(other)},${q(otherMember)},now()+interval '1 day');`)
async function call(body, session = adult) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pepper-session': session }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  const data = await response.json()
  assert.ok(!JSON.stringify(data).includes('pepper-local-dummy-service'))
  return { status: response.status, data }
}
async function success(body, session = adult) {
  const result = await call(body, session)
  assert.equal(result.status, 200, JSON.stringify(result.data))
  return result.data
}

const proposalSessions = [['child', child], ['teen', teen]]
const failedReleaseRequest = 'Create a shared family event titled [PEPPER TEST] Release verification 20260929 at 4:00 PM on October 15, 2026 in America/Los_Angeles. Location: Synthetic test room.'
test('release regression: exact family event request creates one event, never a task', async () => {
  const result = await success({action:'tell',text:failedReleaseRequest,idempotency_key:randomUUID()})
  assert.equal(query(`select count(*) from public.state_changes where capture_id=${q(result.capture_id)} and entity_type='task'`),'0')
  const events=JSON.parse(query(`select coalesce(json_agg(json_build_object('title',title,'starts_at',starts_at,'location',location,'visibility',visibility)),'[]') from public.events where id::text in (select entity_id from public.state_changes where capture_id=${q(result.capture_id)} and entity_type='event')`))
  assert.equal(events.length,1)
  assert.equal(events[0].title,'[PEPPER TEST] Release verification 20260929')
  assert.equal(new Date(events[0].starts_at).toISOString(),'2026-10-15T23:00:00.000Z')
  assert.equal(events[0].location,'Synthetic test room')
  assert.equal(events[0].visibility,'household')
})
test('release regression: exact failed capture can be undone and replayed', async () => {
  await fetch(new URL('/__test/publisher',endpoint),{method:'POST',body:JSON.stringify({mode:'success'})})
  try {
  const result=await success({action:'tell',text:failedReleaseRequest,idempotency_key:randomUUID()})
  const id=query(`select entity_id from public.state_changes where capture_id=${q(result.capture_id)} and entity_type='event' limit 1`)
  const before=JSON.parse(await (await fetch(new URL('/__test/publisher',endpoint))).text()).calls.length
  const undo=await success({action:'capture_undo',capture_id:result.capture_id})
  assert.equal(undo.status,'undone')
  assert.equal(query(`select status='canceled' and sync_status='synced' from public.events where id=${q(id)}`),'t')
  assert.equal((await success({action:'capture_undo',capture_id:result.capture_id})).idempotent_replay,true)
  const calls=(await (await fetch(new URL('/__test/publisher',endpoint))).json()).calls
  assert.equal(calls.length,before+1)
  assert.equal(calls.at(-1).event_id,id)
  } finally {await fetch(new URL('/__test/publisher',endpoint),{method:'POST',body:JSON.stringify({mode:'unavailable'})})}
})
test('release regression: failed Calendar reversal remains pending and retries without another local mutation', async () => {
  const result=await success({action:'tell',text:failedReleaseRequest,idempotency_key:randomUUID()})
  const id=query(`select entity_id from public.state_changes where capture_id=${q(result.capture_id)} and entity_type='event' limit 1`)
  const undo=await success({action:'capture_undo',capture_id:result.capture_id})
  assert.equal(undo.status,'retry_required')
  assert.equal(undo.delivery_complete,false)
  assert.equal(undo.undoable,true)
  assert.equal(undo.local_reversal_confirmed,true)
  const revision=query(`select revision from public.events where id=${q(id)}`)
  await fetch(new URL('/__test/publisher',endpoint),{method:'POST',body:JSON.stringify({mode:'success'})})
  try {
    assert.equal((await success({action:'capture_undo',capture_id:result.capture_id})).status,'undone')
    assert.equal(query(`select revision from public.events where id=${q(id)}`),revision)
  } finally {await fetch(new URL('/__test/publisher',endpoint),{method:'POST',body:JSON.stringify({mode:'unavailable'})})}
})
test('release regression: legitimate task Undo is exact, authorized and repeatable', async () => {
  const result=await success({action:'tell',text:'Create a checklist for the family outing',idempotency_key:randomUUID()})
  const id=query(`select entity_id from public.state_changes where capture_id=${q(result.capture_id)} and entity_type='task' limit 1`)
  assert.ok(id)
  assert.equal((await call({action:'capture_undo',capture_id:result.capture_id},other)).status,404)
  assert.equal((await call({action:'capture_undo',capture_id:result.capture_id},child)).status,404)
  const undo=await success({action:'capture_undo',capture_id:result.capture_id})
  assert.equal(undo.status,'undone')
  assert.equal(query(`select status='canceled' and deleted_at is not null from public.tasks where id=${q(id)}`),'t')
  assert.equal((await success({action:'capture_undo',capture_id:result.capture_id})).idempotent_replay,true)
  assert.equal(query(`select count(*) from public.audit_log where capture_id=${q(result.capture_id)} and event_type='capture_undone'`),'1')
})
test('release regression: a changed task fails reversal without false success', async () => {
  const result=await success({action:'tell',text:'Create a checklist for another family outing',idempotency_key:randomUUID()})
  const id=query(`select entity_id from public.state_changes where capture_id=${q(result.capture_id)} and entity_type='task' limit 1`)
  query(`update public.tasks set title='Newer authorized change',updated_at=clock_timestamp() where id=${q(id)}`)
  assert.equal((await call({action:'capture_undo',capture_id:result.capture_id})).status,409)
  assert.equal(query(`select title from public.tasks where id=${q(id)}`),'Newer authorized change')
  assert.equal(query(`select count(*) from public.audit_log where capture_id=${q(result.capture_id)} and event_type='capture_undone'`),'0')
})
for (const [role, child] of proposalSessions) {
test(`${role} calendar proposals and their retries never claim a saved event`, async () => {
  const key = randomUUID()
  const text = 'Create event [PEPPER TEST] family proposal on October 12 at 4pm'
  const before = query(`select count(*) from public.events where household_id=${q(household)}`)
  const mutationsBefore = query(`select count(*) from private.calendar_event_mutation_requests where household_id=${q(household)}`)
  const proposal = await success({ action: 'tell', text, idempotency_key: key }, child)
  const replay = await success({ action: 'tell', text, idempotency_key: key }, child)
  const retry = await success({ action: 'capture_review_retry', capture_id: proposal.capture_id, clarification_text: 'October 12 at 5pm', idempotency_key: randomUUID() }, child)
  for (const result of [proposal, replay, retry]) {
    assert.equal(result.status, 'needs_review')
    assert.equal(result.mode, 'review')
    assert.match(result.reply, /review/i)
    assert.doesNotMatch(result.reply, /\bDone\b|added to the calendar|already handled/i)
    assert.deepEqual(result.applied_changes, [])
    assert.equal(result.undoable, false)
    assert.equal(result.clarification, undefined)
  }
  assert.equal(replay.capture_id, proposal.capture_id)
  assert.equal(query(`select count(*) from public.events where household_id=${q(household)}`), before)
  assert.equal(query(`select count(*) from private.calendar_event_mutation_requests where household_id=${q(household)}`), mutationsBefore)
})

test(`parent decides ${role} proposals once, with household isolation and persistent status`, async () => {
  const title = `[PEPPER TEST] ${role} review approval`
  const proposal = await success({ action:'tell',text:`Create event ${title} on October 13 at 4pm`,idempotency_key:randomUUID() },child)
  const id=proposal.capture_id
  assert.equal((await call({action:'capture_review_resolve',capture_id:id,resolution:'no_change_required',idempotency_key:randomUUID()},child)).status,403)
  const reviews=await success({action:'capture_reviews'})
  assert.ok(reviews.reviews.some(r=>r.id===id&&r.can_review&&r.proposal_decision==='pending'))
  assert.ok(!(await success({action:'capture_reviews'},other)).reviews.some(r=>r.id===id))
  assert.equal((await call({action:'capture_review_decide',capture_id:id,decision:'approved'},child)).status,403)
  assert.equal((await call({action:'capture_review_decide',capture_id:id,decision:'approved'},other)).status,404)
  const approved=await success({action:'capture_review_decide',capture_id:id,decision:'approved'})
  assert.equal(approved.proposal_decision,'approved')
  assert.equal(approved.delivery_complete,false)
  assert.match(approved.reply,/pending|attention/)
  const replay=await success({action:'capture_review_decide',capture_id:id,decision:'approved'},mattSession)
  assert.equal(replay.idempotent_replay,true)
  assert.equal((await call({action:'capture_review_decide',capture_id:id,decision:'declined'})).status,409)
  assert.equal(query(`select count(*) from public.events where household_id=${q(household)} and title=${q(title)}`),'1')
  assert.equal(query(`select count(*) from public.audit_log where capture_id=${q(id)} and event_type='proposal_approved'`),'1')
  assert.equal((await success({action:'capture_reviews'},child)).reviews.find(r=>r.id===id).proposal_decision,'approved')
  // Isolated completion double: the offline publisher fails above; model its
  // later durable success without invoking a real Google service.
  query(`update public.events set sync_status='synced' where household_id=${q(household)} and title=${q(title)}`)
  assert.equal((await success({action:'capture_reviews'},child)).reviews.find(r=>r.id===id).delivery_complete,true)
  assert.equal((await success({action:'capture_review_decide',capture_id:id,decision:'approved'})).delivery_complete,true)
  const conflictTitle=`[PEPPER TEST] ${role} review decline`
  const declined=await success({action:'tell',text:`Create event ${conflictTitle} on October 14 at 4pm`,idempotency_key:randomUUID()},child)
  const decisions=await Promise.all(['approved','declined'].map(decision=>call({action:'capture_review_decide',capture_id:declined.capture_id,decision})))
  assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409])
  const winner=decisions.find(r=>r.status===200).data.proposal_decision
  assert.equal(query(`select count(*) from public.events where household_id=${q(household)} and title=${q(conflictTitle)}`),winner==='approved'?'1':'0')
  const no=await success({action:'tell',text:'Create event [PEPPER TEST] declined outing on October 15 at 4pm',idempotency_key:randomUUID()},child)
  await success({action:'capture_review_decide',capture_id:no.capture_id,decision:'declined'})
  assert.equal((await success({action:'capture_reviews'},child)).reviews.find(r=>r.id===no.capture_id).proposal_decision,'declined')
  assert.equal(query(`select count(*) from public.events where household_id=${q(household)} and title='[PEPPER TEST] declined outing'`),'0')
  query(`update public.household_members set active=false,removed_at=now() where id=${q(matt)}`)
  try { assert.equal((await call({action:'capture_review_decide',capture_id:no.capture_id,decision:'approved'},mattSession)).status,401) }
  finally { query(`update public.household_members set active=true,removed_at=null where id=${q(matt)}`) }
})
}

test('child completes own recurring chore; parent reads it; Undo/replay preserves one successor', async () => {
  const result = await success({ action: 'chore_create', title: '[PEPPER TEST] Feed test pet', owner_member_id: member, due_date: '2026-10-31', recurrence: 'daily' })
  const id = result.chore.id
  for (const operation of ['complete', 'reopen', 'complete']) await success({ action: 'item_update', item_type: 'task', id, operation }, child)
  assert.equal(query(`select status from public.tasks where id=${q(id)}`), 'completed')
  assert.equal(query(`select count(*) from public.tasks where recurrence_previous_task_id=${q(id)}`), '1')
  assert.equal(query(`select due_at at time zone 'America/Los_Angeles' from public.tasks where recurrence_previous_task_id=${q(id)}`), '2026-11-01 17:00:00')
  const view = await success({ action: 'section_state', section: 'chores' })
  assert.ok(JSON.stringify(view).includes(id))
  assert.equal((await call({ action: 'item_update', item_type: 'task', id, operation: 'reopen' }, other)).status, 404)
})

for (const [role, child] of proposalSessions) {
test(`approved ${role} update uses the existing event and rejects stale proposals`, async () => {
  const id=randomUUID()
  query(`insert into public.events(id,household_id,title,person_slug,starts_at,ends_at,kind,visibility)
    values(${q(id)},${q(household)},'[PEPPER TEST] Practice',${q(role)},now(),now()+interval '1 hour','activity','household')`)
  const proposal=await success({action:'tell',text:`Matt is picking up ${role}.`,idempotency_key:randomUUID()},child)
  const review=(await success({action:'capture_reviews'})).reviews.find(r=>r.id===proposal.capture_id)
  assert.equal(review.proposed_changes[0].title,'[PEPPER TEST] Practice')
  await success({action:'capture_review_decide',capture_id:proposal.capture_id,decision:'approved'})
  const revision=query(`select revision from public.events where id=${q(id)}`)
  assert.equal(query(`select transport_owner_member_id from public.events where id=${q(id)}`),matt)
  await success({action:'capture_review_decide',capture_id:proposal.capture_id,decision:'approved'},mattSession)
  assert.equal(query(`select revision from public.events where id=${q(id)}`),revision)
  const stale=await success({action:'tell',text:`${role}'s Practice is canceled.`,idempotency_key:randomUUID()},child)
  query(`update public.events set revision=revision+1 where id=${q(id)}`)
  assert.equal((await call({action:'capture_review_decide',capture_id:stale.capture_id,decision:'approved'})).status,409)
  assert.notEqual(query(`select status from public.events where id=${q(id)}`),'canceled')
  query(`update public.events set status='canceled' where id=${q(id)}`)
})
}

test('repeat requires a date and removed members cannot receive chores', async () => {
  assert.equal((await call({ action: 'chore_create', title: '[PEPPER TEST] Repeat', recurrence: 'weekly' })).status, 400)
  query(`update public.household_members set active=false,removed_at=now() where id=${q(member)}`)
  try {
    assert.equal((await call({ action: 'chore_create', title: '[PEPPER TEST] Invalid owner', owner_member_id: member })).status, 400)
    assert.equal((await call({ action: 'section_state', section: 'chores' }, child)).status, 401)
  } finally { query(`update public.household_members set active=true,removed_at=null where id=${q(member)}`) }
})

test('shared grocery edit/checkoff persists and another household cannot edit', async () => {
  const added = await success({ action: 'grocery_create', item: `[PEPPER TEST] Apples ${randomUUID()}` })
  const id = added.grocery?.id || added.id
  assert.ok(id, JSON.stringify(added))
  await success({ action: 'grocery_update', id, operation: 'edit', item: '[PEPPER TEST] Green apples' })
  assert.equal(query(`select item from public.groceries where id=${q(id)}`), '[PEPPER TEST] Green apples')
  assert.equal((await call({ action: 'grocery_update', id, operation: 'edit', item: 'Changed' }, child)).status, 403)
  assert.equal((await call({ action: 'grocery_update', id, operation: 'complete' }, other)).status, 404)
  await success({ action: 'grocery_update', id, operation: 'complete' }, child)
  assert.equal(query(`select status from public.groceries where id=${q(id)}`), 'completed')
  await success({ action: 'grocery_update', id, operation: 'reopen' })
  assert.equal(query(`select status from public.groceries where id=${q(id)}`), 'open')
})

test('conversational leftovers preserves scheduled dinner and never invents a new event', async () => {
  const date = query("select (now() at time zone 'America/Los_Angeles')::date")
  await success({ action: 'meal_upsert', meal_date: date, meal_name: '[PEPPER TEST] Initial dinner' })
  query(`update public.meal_plan set eat_at=(${q(date)}::date+time '19:00') at time zone 'America/Los_Angeles' where household_id=${q(household)} and meal_date=${q(date)}`)
  const before = query(`select count(*) from public.events where household_id=${q(household)} and kind='meal'`)
  const key = randomUUID()
  const result = await success({ action: 'tell', text: "We're having leftovers tonight.", idempotency_key: key })
  assert.equal(result.status, 'applied', JSON.stringify(result))
  await success({ action: 'tell', text: "We're having leftovers tonight.", idempotency_key: key })
  assert.equal(query(`select meal_name||'|'||to_char(eat_at at time zone 'America/Los_Angeles','HH24:MI') from public.meal_plan where household_id=${q(household)} and meal_date=${q(date)}`), 'Leftovers|19:00')
  assert.equal(query(`select count(*) from public.events where household_id=${q(household)} and kind='meal'`), before)
  assert.equal(query(`select count(*) from public.captures where household_id=${q(household)} and dedupe_key=${q(key)}`), '1')
})

test('pickup update targets one event, preserves time, and reports unavailable external delivery honestly', async () => {
  const id = randomUUID()
  query(`insert into public.events(id,household_id,title,person_slug,starts_at,ends_at,kind,source)
    values(${q(id)},${q(household)},'[PEPPER TEST] Practice','child',(date_trunc('day',now() at time zone 'America/Los_Angeles')+interval '15 hours') at time zone 'America/Los_Angeles',(date_trunc('day',now() at time zone 'America/Los_Angeles')+interval '16 hours') at time zone 'America/Los_Angeles','activity','pepper')`)
  const before = query(`select starts_at from public.events where id=${q(id)}`)
  const result = await success({ action: 'tell', text: 'Matt is picking up child.', idempotency_key: randomUUID() })
  assert.equal(query(`select transport_status from public.events where id=${q(id)}`), 'assigned', JSON.stringify(result))
  assert.equal(query(`select starts_at from public.events where id=${q(id)}`), before)
  assert.equal(result.shared_calendar_complete, false, JSON.stringify(result))
  const revision = Number(query(`select revision from public.events where id=${q(id)}`))
  assert.equal((await call({ action: 'item_update', item_type: 'event', id, operation: 'accept', expected_revision: revision, mutation_id: randomUUID() })).status, 403)
  await success({ action: 'item_update', item_type: 'event', id, operation: 'accept', expected_revision: revision, mutation_id: randomUUID() }, mattSession)
  assert.equal(query(`select transport_status from public.events where id=${q(id)}`), 'confirmed')
  const second = randomUUID()
  query(`insert into public.events(id,household_id,title,person_slug,starts_at,kind) values(${q(second)},${q(household)},'[PEPPER TEST] Rehearsal','child',now(),'activity')`)
  const unclear = await success({ action: 'tell', text: 'Matt is picking up child.', idempotency_key: randomUUID() })
  assert.equal(unclear.status, 'needs_review', JSON.stringify(unclear))
  assert.equal(query(`select count(*) from public.events where id=${q(second)} and transport_owner_member_id is not null`), '0')
})

test('possessive cancellation persists and repeat cannot resurrect the activity', async () => {
  const text = "child's Rehearsal is canceled."
  const result = await success({ action: 'tell', text, idempotency_key: randomUUID() })
  assert.equal(query(`select status from public.events where household_id=${q(household)} and title='[PEPPER TEST] Rehearsal'`), 'canceled', JSON.stringify(result))
  const repeated = await success({ action: 'tell', text, idempotency_key: randomUUID() })
  assert.equal(repeated.status, 'needs_review')
  assert.equal(query(`select count(*) from public.events where household_id=${q(household)} and title='[PEPPER TEST] Rehearsal' and status<>'canceled'`), '0')
})

test('schedule consequences identify overlapping rides without treating an unassigned ride as an emergency', () => {
  const ride=randomUUID(), meeting=randomUUID()
  query(`insert into public.events(id,household_id,title,person_slug,starts_at,ends_at,kind,status,visibility,source)
    values (${q(ride)},${q(household)},'[PEPPER TEST] Pickup','child',now()+interval '1 hour',now()+interval '2 hours','transport','confirmed','household','pepper')`)
  assert.equal(query(`select severity from public.consequences where event_id=${q(ride)} and consequence_type='missing_transport' and status='open'`),'needs_attention')
  query(`insert into public.events(id,household_id,title,person_slug,starts_at,ends_at,kind,status,visibility,source)
    values (${q(meeting)},${q(household)},'[PEPPER TEST] Meeting','matt',now()+interval '1 hour',now()+interval '2 hours','appointment','confirmed','household','pepper');
    update public.events set transport_owner_member_id=${q(matt)} where id=${q(ride)}`)
  assert.equal(query(`select count(*) from public.consequences where event_id=${q(ride)} and related_event_id=${q(meeting)} and consequence_type='driver_conflict' and status='open'`),'1')
  query(`update public.events set status='canceled' where id=${q(meeting)}`)
  assert.equal(query(`select count(*) from public.consequences where event_id=${q(ride)} and related_event_id=${q(meeting)} and status='open'`),'0')
})
