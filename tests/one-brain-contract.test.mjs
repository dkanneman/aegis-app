import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildPlan,
  classifyPiece,
  dateFromText,
  delegatedIntent,
  isComplexTrainingPlan,
  questionIntent,
  replyForPlan,
  splitCapture,
} from '../supabase/functions/pepper-tell-v2/logic.ts'

const migrationPath = new URL(
  '../supabase/migrations/20260824204510_add_one_brain_capture_reconciliation.sql',
  import.meta.url,
)
const tellPath = new URL('../supabase/functions/pepper-tell-v2/index.ts', import.meta.url)
const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const legacyApiPath = new URL('../supabase/functions/pepper-family-beta-01/index.ts', import.meta.url)
const previewCaptureGuardPath = new URL(
  '../supabase/preview/20260908223000_require_capture_pipeline.sql',
  import.meta.url,
)
const previewCaptureDenyPath = new URL(
  '../supabase/preview/20260909033633_restore_capture_direct_access_deny.sql',
  import.meta.url,
)

test('migration defines the explicit capture state and removes pending from the final constraint', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /aegis_sync_status in \('captured', 'synced', 'needs_review', 'failed', 'not_applicable'\)/)
  assert.match(sql, /status_input[\s\S]+<> 'needs_review'/)
  assert.doesNotMatch(
    sql.match(/add constraint captures_aegis_sync_status_check[\s\S]+?;/)?.[0] || '',
    /pending/,
  )
})

test('migration exposes one atomic, idempotent plan mechanism with trace context', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /create or replace function private\.apply_capture_plan/)
  assert.match(sql, /unique \(capture_id, idempotency_key\)/)
  assert.match(sql, /for update/)
  assert.match(sql, /set_config\('pepper\.capture_id'/)
  assert.match(sql, /new\.capture_id := coalesce\(new\.capture_id, context_capture_id\)/)
  assert.match(sql, /new\.actor_member_id := coalesce\(new\.actor_member_id, context_actor_id\)/)
  assert.match(sql, /resolution' = 'existing_records_verified'/)
  assert.match(sql, /where c\.status <> 'dismissed'[\s\S]+aegis_sync_status in \('captured','needs_review','failed'\)/)
})

test('only declared safe subsets can be partially applied', async () => {
  const full = buildPlan(['Buy milk'], [{ operation: 'task.create' }], [])
  assert.equal(full.outcome, 'applied')
  assert.equal(full.safe_subset_declared, false)

  const partial = buildPlan(
    ['Buy milk', 'maybe change Saturday'],
    [{ operation: 'task.create' }],
    ['maybe change Saturday'],
  )
  assert.equal(partial.outcome, 'partially_applied')
  assert.equal(partial.safe_subset_declared, true)
  assert.match(replyForPlan(partial.outcome, ['Milk added.']), /saved the rest/i)
})

test('Chloe running-plan narrative remains ambiguous and reviewable', () => {
  const text = 'Chloe is starting a six week running plan with easy days and mileage; schedule long runs after we confirm her pace'
  const facts = splitCapture(text)
  assert.equal(isComplexTrainingPlan(text), true)
  const plan = buildPlan(facts, [], facts)
  assert.equal(plan.outcome, 'needs_review')
  assert.deepEqual(plan.writes, [])
})

test('existing delegated-task and simple V5.1 intents remain recognized', () => {
  assert.deepEqual(delegatedIntent('Matt needs me to call the doctor tomorrow'), {
    subjectSlug: 'matt',
    action: 'call the doctor tomorrow',
  })
  assert.equal(classifyPiece('add milk to groceries', '2026-08-24').type, 'grocery')
  assert.equal(classifyPiece('I need to return the library books', '2026-08-24').type, 'task')
  assert.equal(classifyPiece('Elle is getting Chloe at 5 pm', '2026-08-24').type, 'ride.assign')
})

test('Tell Pepper routes explicit tasks and needs instead of shelving them', () => {
  assert.deepEqual(classifyPiece('Add new work task - review Spectrum billing', '2026-09-10'), {
    type: 'task',
    title: 'Review Spectrum billing',
    private: true,
    category: 'work',
    ownerSlug: null,
  })
  assert.deepEqual(classifyPiece('Need: replace Chloe\'s running shoes', '2026-09-10'), {
    type: 'task',
    title: "Replace Chloe's running shoes",
    private: true,
    category: 'need',
    ownerSlug: null,
  })
  assert.deepEqual(classifyPiece('What time is Lyra rehearsal?', '2026-09-10'), {
    type: 'question',
    query: {
      type: 'schedule',
      date: '2026-09-10',
      dateLabel: 'today',
      personSlug: 'lyra',
    },
  })
})

test('Ask Pepper recognizes useful family-state questions without turning them into work', () => {
  assert.deepEqual(questionIntent('What are we having for dinner tomorrow?', '2026-09-10'), {
    type: 'meal',
    date: '2026-09-11',
    dateLabel: 'tomorrow',
  })
  assert.deepEqual(questionIntent('Who is picking up Chloe today?', '2026-09-10'), {
    type: 'ride',
    date: '2026-09-10',
    dateLabel: 'today',
    personSlug: 'chloe',
  })
  assert.deepEqual(questionIntent('What chores does Posey have?', '2026-09-10'), {
    type: 'chores',
    personSlug: 'posey',
  })
  assert.deepEqual(questionIntent('What are my work priorities?', '2026-09-10'), {
    type: 'work',
  })
  assert.deepEqual(questionIntent('Who has the front seat today?', '2026-09-10'), {
    type: 'front_seat',
    date: '2026-09-10',
    dateLabel: 'today',
  })
  assert.deepEqual(questionIntent('How many steps do I have?', '2026-09-10'), {
    type: 'health',
  })
})

test('polite Pepper commands remain actions even when phrased as questions', () => {
  assert.equal(questionIntent('Could you add milk to groceries?', '2026-09-10'), null)
  assert.deepEqual(classifyPiece('Could you add milk to groceries?', '2026-09-10'), {
    type: 'grocery',
    item: 'milk',
  })
})

test('Tell Pepper parses household events and requests missing event details', () => {
  assert.equal(dateFromText('next Thursday at 5 pm', '2026-09-10')?.date, '2026-09-17')
  assert.deepEqual(classifyPiece('Add event: Lyra rehearsal tomorrow at 5 pm', '2026-09-10'), {
    type: 'event.create',
    title: 'Lyra rehearsal',
    personSlug: 'lyra',
    time: '2026-09-12T00:00:00.000Z',
    private: false,
  })
  assert.deepEqual(classifyPiece('Dan Eriksen arrives to visit', '2026-09-10'), {
    type: 'ambiguous',
    text: 'Dan Eriksen arrives to visit',
  })
})

test('natural dinner updates are promoted into the meal plan', () => {
  assert.deepEqual(
    classifyPiece('Tonight we are having leftovers you can update the plan', '2026-09-10'),
    { type: 'meal', mealName: 'Leftovers', time: null },
  )
})

test('capture task categories are persisted through canonical source routing', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260910193000_route_pepper_capture_tasks.sql', import.meta.url),
    'utf8',
  )
  assert.match(migration, /pepper_capture_work/)
  assert.match(migration, /new\.area := 'Work'/)
  assert.doesNotMatch(migration, /pepper_capture_question/)
  assert.match(migration, /pepper_capture_event_follow_up/)
})

test('current API routes tell and member review actions through the transactional function', async () => {
  const [tell, api, legacyApi] = await Promise.all([
    readFile(tellPath, 'utf8'),
    readFile(apiPath, 'utf8'),
    readFile(legacyApiPath, 'utf8'),
  ])
  assert.match(tell, /private\.apply_capture_plan/)
  assert.match(tell, /private\.list_capture_reviews/)
  assert.match(tell, /private\.resolve_capture_review/)
  assert.match(tell, /action === 'review_retry'/)
  assert.match(tell, /clarification_text/)
  assert.match(tell, /action === 'undo'/)
  assert.match(tell, /undoCapture/)
  assert.match(tell, /answeredQuestionResponse/)
  assert.match(tell, /questionIntent\(text\)/)
  assert.match(tell, /mode: 'answer'/)
  assert.match(tell, /remaining_ambiguities/)
  assert.match(tell, /body\.resolution !== 'no_change_required'/)
  assert.match(tell, /\$\{sql\.json\(plan\)\}::jsonb/)
  assert.match(tell, /\$\{sql\.json\(reviewPlan\)\}::jsonb/)
  assert.doesNotMatch(tell, /JSON\.stringify\((plan|reviewPlan)\)/)
  assert.doesNotMatch(tell, /JSON\.stringify\(body\.plan\)/)
  assert.doesNotMatch(tell, /pepper-family-beta-01/)
  assert.match(api, /action==='capture_reviews'/)
  assert.match(api, /action==='capture_review_retry'/)
  assert.match(api, /action==='capture_undo'/)
  assert.match(api, /action==='capture_review_resolve'/)
  assert.match(legacyApi, /from\('captures'\)[\s\S]*?\.eq\('member_id',m\.id\)/)
})

test('private preview fails closed when canonical capture migrations are skipped', async () => {
  const [guard, tell] = await Promise.all([
    readFile(previewCaptureGuardPath, 'utf8'),
    readFile(tellPath, 'utf8'),
  ])
  assert.match(guard, /20260816203301_complete_aegis_capture_pipeline\.sql/)
  assert.match(guard, /20260824204510_add_one_brain_capture_reconciliation\.sql/)
  assert.match(guard, /to_regprocedure\('private\.apply_capture_plan\(uuid,uuid,text,jsonb\)'\)/)
  assert.match(tell, /function publicFailureMessage/)
  assert.match(tell, /No changes were made\./)
  assert.doesNotMatch(
    tell.match(/return json\(\{ error: publicFailureMessage\(error\) \}, 500\)/)?.[0] || '',
    /error\.message/,
  )
})

test('private preview restores its no-direct-capture-access boundary', async () => {
  const sql = await readFile(previewCaptureDenyPath, 'utf8')
  assert.match(sql, /drop policy if exists captures_member_insert on public\.captures/)
  assert.match(sql, /revoke all on table public\.captures from anon, authenticated/)
  assert.match(sql, /notify pgrst, 'reload schema'/)
})
