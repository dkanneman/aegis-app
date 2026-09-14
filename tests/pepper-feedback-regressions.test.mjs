import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)
const cssPath = new URL('../app/pepper/pepper.module.css', import.meta.url)
const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const consequencePath = new URL('../supabase/functions/pepper-consequences/index.ts', import.meta.url)
const legacyPath = new URL('../supabase/functions/pepper-family-beta-01/index.ts', import.meta.url)
const migrationPath = new URL(
  '../supabase/migrations/20260914164459_add_trusted_household_drivers.sql',
  import.meta.url,
)

test('trusted drivers are household-scoped, adult-managed, and resolve ride consequences', async () => {
  const [api, consequences, legacy, migration] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(consequencePath, 'utf8'),
    readFile(legacyPath, 'utf8'),
    readFile(migrationPath, 'utf8'),
  ])

  assert.match(migration, /create table if not exists public\.trusted_drivers/)
  assert.match(migration, /alter table public\.trusted_drivers enable row level security/)
  assert.match(migration, /revoke all on table public\.trusted_drivers from anon, authenticated/)
  assert.match(migration, /events_one_transport_driver_check/)
  assert.match(migration, /update of transport_owner_member_id, trusted_driver_id, transport_status, household_id/)
  assert.match(migration, /driver\.active = true/)
  assert.match(api, /Only an adult can manage trusted drivers/)
  assert.match(api, /action==='trusted_driver_save'/)
  assert.match(api, /action==='trusted_driver_remove'/)
  assert.match(api, /transport_consequence_resolved:transportConsequenceResolved/)
  assert.match(api, /consequence_type='missing_transport' and status='open'/)
  assert.match(consequences, /Trusted drivers are also available to assign/)
  assert.match(legacy, /!x\.transport_owner_member_id&&!x\.trusted_driver_id/)
})

test('driver assignment and family settings expose trusted people without creating accounts', async () => {
  const [client, css] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  assert.match(client, /<optgroup label="Family adults">/)
  assert.match(client, /<optgroup label="Trusted drivers">/)
  assert.match(client, /action: "trusted_driver_save"/)
  assert.match(client, /action: "trusted_driver_remove"/)
  assert.match(client, /Add friends or relatives who may handle a family ride without giving them a Pepper account/)
  assert.match(client, /consequence\.type === "missing_transport"/)
  assert.match(client, /result\.transport_consequence_resolved !== true/)
  assert.match(css, /\.trustedDriverSection/)
  assert.match(css, /\.trustedDriverForm/)
})

test('item actions keep the organized day open and update its rows in place', async () => {
  const client = await readFile(clientPath, 'utf8')

  assert.match(client, /function patchDailyPlanItem/)
  assert.match(client, /\["complete", "cancel", "delete"\]\.includes\(operation\)/)
  assert.match(client, /setDayPlan\(\(current\) => patchDailyPlanItem\(current, saved, operation\)\)/)
  assert.match(client, /void load\(token\)/)
  assert.doesNotMatch(client, /preserveDayPlan/)
  assert.doesNotMatch(
    client,
    /setSelectedItem\(null\);\s*setDayPlan\(null\);\s*if \(item\.type === "event"\)/,
  )
})
