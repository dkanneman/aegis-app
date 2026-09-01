import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  minutesInTimeZone,
  pepperAtmosphereAt,
} from '../app/pepper/pepper-atmosphere.ts'

const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)
const migrationPath = new URL(
  '../supabase/migrations/20260901090000_harden_private_runtime_rls.sql',
  import.meta.url,
)
const taskBridgePath = new URL(
  '../supabase/migrations/20260831211249_home_brain_task_sync_bridge.sql',
  import.meta.url,
)
const integrationsPath = new URL(
  '../supabase/functions/pepper-integrations/index.ts',
  import.meta.url,
)
const healthIngestPath = new URL(
  '../supabase/functions/pepper-health-ingest/index.ts',
  import.meta.url,
)
const calendarPath = new URL(
  '../supabase/functions/pepper-calendar/index.ts',
  import.meta.url,
)

test('family API targets its own Supabase environment instead of production', async () => {
  const api = await readFile(apiPath, 'utf8')
  assert.match(api, /Deno\.env\.get\('SUPABASE_URL'\)/)
  assert.doesNotMatch(api, /olgyfgqlqrhfaujkfjtj/)
  assert.match(api, /action==='member_state'/)
  assert.match(api, /action==='item_update'/)
})

test('member pages remain household and privacy scoped', async () => {
  const api = await readFile(apiPath, 'utf8')
  assert.match(api, /household_id=\$\{member\.household_id\}/)
  assert.match(api, /e\.visibility='household' or e\.owner_member_id=\$\{member\.id\}/)
  assert.match(api, /t\.visibility='household' or t\.owner_member_id=\$\{member\.id\}.*t\.creator_member_id=\$\{member\.id\}/s)
  assert.match(api, /That task is private/)
  assert.match(api, /That event is private/)
})

test('canonical mutations enforce roles and preserve actor context', async () => {
  const api = await readFile(apiPath, 'utf8')
  assert.match(api, /sql\.begin/)
  assert.match(api, /set_config\('pepper\.actor_member_id'/)
  assert.match(api, /Only an adult can assign a family task/)
  assert.match(api, /role in \('adult_admin','adult'\)/)
  assert.match(api, /update public\.tasks set owner_member_id=/)
  assert.match(api, /update public\.events set transport_owner_member_id=/)
  assert.match(api, /update public\.tasks set status=/)
  assert.match(api, /update public\.events set status=/)
  assert.match(api, /insert into public\.audit_log/)
})

test('Pepper UI includes the complete Home-to-member action path', async () => {
  const client = await readFile(clientPath, 'utf8')
  assert.match(client, /NEXT_PUBLIC_PEPPER_API_URL/)
  assert.match(client, /"family" \| "member" \| "connections"/)
  assert.match(client, /action: "member_state"/)
  assert.match(client, /action: "item_update"/)
  assert.match(client, /Complete/)
  assert.match(client, /Cancel/)
  assert.match(client, /Restore/)
  assert.match(client, /member\.slug === "elle" \? "Danielle"/)
  assert.doesNotMatch(client, /\/api\/aegis\/state/)
})

test('connections remain evidence inputs with explicit security boundaries', async () => {
  const [api, client, integrations, health, calendar] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(clientPath, 'utf8'),
    readFile(integrationsPath, 'utf8'),
    readFile(healthIngestPath, 'utf8'),
    readFile(calendarPath, 'utf8'),
  ])
  assert.match(api, /SUPABASE_ANON_KEY/)
  assert.match(api, /action==='email_start'/)
  assert.match(api, /action==='health_pair'/)
  assert.match(client, /Google Calendar/)
  assert.match(client, /Gmail/)
  assert.match(client, /Apple Health/)
  assert.match(client, /Pepper remains the source of truth/)
  assert.match(integrations, /code_challenge_method','S256'/)
  assert.match(integrations, /gmail\.readonly/)
  assert.match(integrations, /token_hash/)
  assert.match(health, /x-pepper-health-token/)
  assert.doesNotMatch(health, /authorization\.startsWith\('Bearer '/)
  assert.match(calendar, /Deno\.env\.get\('PEPPER_APP_URL'\)/)
  assert.doesNotMatch(calendar, /olgyfgqlqrhfaujkfjtj/)
})

test('the isolated API accepts only the scoped Vercel preview host family', async () => {
  const api = await readFile(apiPath, 'utf8')
  assert.match(api, /pepper-family-beta-\[a-z0-9-\]\+-dkanneman-8936s-projects/)
  assert.doesNotMatch(api, /Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/)
})

test('atmosphere interpolation is continuous and timezone based', () => {
  const before = pepperAtmosphereAt(16 * 60 + 59)
  const after = pepperAtmosphereAt(17 * 60 + 1)
  assert.notDeepEqual(before, after)
  for (const key of ['top', 'middle', 'bottom', 'glow']) {
    assert.match(before[key], /^#[0-9A-F]{6}$/)
    assert.match(after[key], /^#[0-9A-F]{6}$/)
  }
  assert.equal(minutesInTimeZone('America/Los_Angeles', new Date('2026-09-01T19:30:00Z')), 750)
})

test('private runtime tables receive defense-in-depth RLS', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /calendar_tokens/)
  assert.match(sql, /member_ritual_preferences/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /revoke all on table private/)
})

test('task changes remain exportable from canonical One Brain state', async () => {
  const sql = await readFile(taskBridgePath, 'utf8')
  assert.match(sql, /create table if not exists private\.home_brain_task_ledger/)
  assert.match(sql, /current_setting\('pepper\.actor_member_id'/)
  assert.match(sql, /after insert or update or delete on public\.tasks/)
  assert.match(sql, /create or replace view private\.home_brain_task_snapshot/)
})
