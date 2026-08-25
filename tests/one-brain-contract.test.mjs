import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildPlan,
  classifyPiece,
  delegatedIntent,
  isComplexTrainingPlan,
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

test('current API routes tell and member review actions through the transactional function', async () => {
  const [tell, api, legacyApi] = await Promise.all([
    readFile(tellPath, 'utf8'),
    readFile(apiPath, 'utf8'),
    readFile(legacyApiPath, 'utf8'),
  ])
  assert.match(tell, /private\.apply_capture_plan/)
  assert.match(tell, /private\.list_capture_reviews/)
  assert.match(tell, /private\.resolve_capture_review/)
  assert.match(tell, /body\.resolution !== 'no_change_required'/)
  assert.doesNotMatch(tell, /JSON\.stringify\(body\.plan\)/)
  assert.doesNotMatch(tell, /pepper-family-beta-01/)
  assert.match(api, /action==='capture_reviews'/)
  assert.match(api, /action==='capture_review_resolve'/)
  assert.match(legacyApi, /from\('captures'\)[\s\S]*?\.eq\('member_id',m\.id\)/)
})
