import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  minutesInTimeZone,
  pepperAtmosphereAt,
} from '../app/pepper/pepper-atmosphere.ts'

const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)
const pepperStylesPath = new URL('../app/pepper/pepper.module.css', import.meta.url)
const botanicalPath = new URL('../public/pepper-eucalyptus.png', import.meta.url)
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
const horizonPath = new URL(
  '../supabase/functions/pepper-horizon/index.ts',
  import.meta.url,
)
const schoolMigrationPath = new URL(
  '../supabase/migrations/20260901183232_normalize_school_schedules.sql',
  import.meta.url,
)
const schoolSeedPath = new URL(
  '../supabase/preview/20260901184500_preview_eriksen_school_schedules.sql',
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
  assert.match(client, /type View =[\s\S]*?"family"[\s\S]*?"member"[\s\S]*?"connections"/)
  assert.match(client, /action: "member_state"/)
  assert.match(client, /action: "item_update"/)
  assert.match(client, /Complete/)
  assert.match(client, /Cancel/)
  assert.match(client, /Restore/)
  assert.match(client, /member\.slug === "elle" \? "Danielle"/)
  assert.doesNotMatch(client, /\/api\/aegis\/state/)
})

test('chores use canonical household tasks with delegation and lifecycle controls', async () => {
  const [api, client, styles] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(clientPath, 'utf8'),
    readFile(pepperStylesPath, 'utf8'),
  ])

  assert.match(api, /action==='chore_create'/)
  assert.match(api, /capabilities:\['chore_create'/)
  assert.match(api, /code:'unknown_action'/)
  assert.match(api, /classification[^\n]*'Chore'/)
  assert.match(api, /array\['home','chores'\]/)
  assert.match(api, /insert into public\.audit_log/)
  assert.match(client, /type View =[\s\S]*?"chores"/)
  assert.match(client, /action: "chore_create"/)
  assert.match(client, /This Pepper preview is out of date/)
  assert.match(client, /Family chores/)
  assert.match(client, /Today[\s\S]*Week[\s\S]*All/)
  assert.match(client, /Add a chore/)
  assert.match(client, /function isChore[\s\S]*classification/)
  assert.doesNotMatch(client, /Boolean\(task\.recurrence && task\.recurrence !== "none"\)/)
  assert.match(styles, /\.choreList/)
  assert.match(styles, /\.choreOwner/)
})

test('adult navigation includes a priority-organized canonical Work view', async () => {
  const [client, work, styles] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(new URL('../app/pepper/pepper-work.ts', import.meta.url), 'utf8'),
    readFile(pepperStylesPath, 'utf8'),
  ])

  assert.match(client, /\["work", "Work", Briefcase\]/)
  assert.match(client, /view === "work" && actorIsAdult/)
  assert.match(client, /state\.familyTasks[\s\S]*state\.privateTasks/)
  assert.match(client, /function WorkPage/)
  assert.match(client, /setSelectedItem\(\{ type: "task", item: task \}\)/)
  assert.match(work, /export function isWorkTask/)
  assert.match(work, /export function workPriority/)
  assert.match(work, /critical[\s\S]*high[\s\S]*planned[\s\S]*later[\s\S]*unprioritized/)
  assert.match(styles, /--pepper-tab-count/)
  assert.match(styles, /\.workPrioritySection/)
  assert.match(styles, /\.workTaskRow/)
})

test('attention cards resolve canonical rides and conflicts instead of remaining static prose', async () => {
  const [api, consequences, horizon, calendar, client, styles] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(new URL('../supabase/functions/pepper-consequences/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/pepper-horizon/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/pepper-calendar/index.ts', import.meta.url), 'utf8'),
    readFile(clientPath, 'utf8'),
    readFile(pepperStylesPath, 'utf8'),
  ])

  assert.match(consequences, /event_id: c\.event_id/)
  assert.match(consequences, /related_event_id: c\.related_event_id/)
  assert.match(consequences, /primary_event:/)
  assert.match(horizon, /primary_event:/)
  assert.match(horizon, /related_event:/)
  assert.match(api, /action==='conflict_resolve'/)
  assert.match(api, /recompute_household_consequences/)
  assert.match(api, /canonical_status_override='canceled'/)
  assert.match(calendar, /coalesce\(canonical_status_override, \$\{status\}\)/)
  assert.match(client, /function AttentionCard/)
  assert.match(client, /function ConflictResolutionSheet/)
  assert.match(client, /function SchoolTransportationSummary/)
  assert.match(client, /function SchoolTransportGroup/)
  assert.match(client, /function HorizonSchoolTransportGroup/)
  assert.match(client, /item\.kind === "school_dropoff"/)
  assert.match(client, /item\.kind === "school_pickup"/)
  assert.match(client, /event\.source !== "routine"/)
  assert.match(client, /School drop-off/)
  assert.match(client, /School pickup/)
  assert.match(client, /function revealWeekDecisions/)
  assert.match(client, /id="week-decisions"/)
  assert.match(client, /scrollIntoView/)
  assert.match(client, /action: "conflict_resolve"/)
  assert.match(client, /Cancel event and open email draft/)
  assert.match(client, /mailto:/)
  assert.match(styles, /\.noticeButton/)
  assert.match(styles, /\.conflictChoice/)
  assert.match(calendar, /organizer\?:/)
  assert.match(calendar, /external_organizer_email/)
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
  assert.match(api, /action==='calendar_start'/)
  assert.match(api, /action:'start',session_token:token/)
  assert.match(api, /action:'sync',session_token:token,force:true/)
  assert.doesNotMatch(api, /Calendar reconnect is waiting/)
  assert.match(api, /action==='health_pair'/)
  assert.match(client, /Google Calendar/)
  assert.match(client, /Gmail/)
  assert.match(client, /Apple Health/)
  assert.match(client, /Pepper remains the source of truth/)
  assert.match(client, /Setup pending/)
  assert.match(integrations, /code_challenge_method','S256'/)
  assert.match(integrations, /gmail\.readonly/)
  assert.match(integrations, /token_hash/)
  assert.match(health, /x-pepper-health-token/)
  assert.doesNotMatch(health, /authorization\.startsWith\('Bearer '/)
  assert.match(calendar, /Deno\.env\.get\('PEPPER_APP_URL'\)/)
  assert.doesNotMatch(calendar, /olgyfgqlqrhfaujkfjtj/)
})

test('the approved Pepper visual language wraps the real connection pathways', async () => {
  const [client, styles, botanical] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(pepperStylesPath, 'utf8'),
    readFile(botanicalPath),
  ])
  assert.match(client, /Connection center/)
  assert.match(client, /Email and calendars/)
  assert.match(client, /Schools and activities/)
  assert.match(client, /Health and personal/)
  assert.match(client, /Built into One Brain/)
  assert.match(client, /ConnectionDetailDrawer/)
  assert.match(styles, /var\(--atmosphere-top\).*var\(--atmosphere-middle\).*var\(--atmosphere-bottom\)/s)
  assert.match(styles, /background: url\("\/pepper-eucalyptus\.png"\)/)
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.tabs \{[\s\S]*position: fixed/)
  assert.ok(botanical.byteLength > 10_000)
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

test('One Brain resolves official school schedules in explicit precedence order', async () => {
  const [migration, seed, horizon, api, client] = await Promise.all([
    readFile(schoolMigrationPath, 'utf8'),
    readFile(schoolSeedPath, 'utf8'),
    readFile(horizonPath, 'utf8'),
    readFile(apiPath, 'utf8'),
    readFile(clientPath, 'utf8'),
  ])
  assert.match(migration, /private\.school_profiles/)
  assert.match(migration, /private\.school_schedule_rules/)
  assert.match(migration, /private\.school_schedule_exceptions/)
  assert.match(migration, /exception_row\.exception_type = 'no_school' then 400/)
  assert.match(migration, /exception_row\.id is not null then 300/)
  assert.match(migration, /rule_row\.rule_kind = 'recurring_early_release' then 200/)
  assert.match(seed, /date '2026-09-07', 'Labor Day'/)
  assert.match(seed, /date '2026-09-04', 'minimum_day'/)
  assert.match(seed, /date '2026-11-04', 'finals'/)
  assert.match(horizon, /schedule\?\.schedule_kind === 'no_school'/)
  assert.match(horizon, /routine\.kind === 'school_pickup' && schedule\?\.dismissal_at/)
  assert.match(horizon, /resolution_level === 'dated_exception'/)
  assert.match(api, /private\.resolve_school_schedule/)
  assert.match(client, /Normal dismissal/)
  assert.match(client, /School schedule change/)
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
