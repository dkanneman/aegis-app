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
const editableItemsMigrationPath = new URL(
  '../supabase/migrations/20260902193000_add_editable_family_items.sql',
  import.meta.url,
)
const appManifestPath = new URL('../app/manifest.ts', import.meta.url)
const appLayoutPath = new URL('../app/layout.tsx', import.meta.url)
const appleTouchIconPath = new URL('../public/apple-touch-icon.png', import.meta.url)
const testFlightReviewMigrationPath = new URL(
  '../supabase/preview/20260903090333_add_testflight_review_household.sql',
  import.meta.url,
)
const privacyPagePath = new URL('../app/privacy/page.tsx', import.meta.url)
const iosWebViewPath = new URL('../ios/Pepper/Pepper/PepperWebView.swift', import.meta.url)
const iosBrowserModelPath = new URL('../ios/Pepper/Pepper/PepperBrowserModel.swift', import.meta.url)
const iosInfoPath = new URL('../ios/Pepper/Pepper/Info.plist', import.meta.url)
const iosPrivacyManifestPath = new URL('../ios/Pepper/Pepper/PrivacyInfo.xcprivacy', import.meta.url)
const gmailCallbackPath = new URL('../supabase/functions/pepper-gmail-callback/index.ts', import.meta.url)
const nativeOAuthMigrationPath = new URL(
  '../supabase/preview/20260903152000_harden_testflight_auth_and_oauth_return.sql',
  import.meta.url,
)

test('family API targets its own Supabase environment instead of production', async () => {
  const api = await readFile(apiPath, 'utf8')
  assert.match(api, /Deno\.env\.get\('SUPABASE_URL'\)/)
  assert.doesNotMatch(api, /olgyfgqlqrhfaujkfjtj/)
  assert.match(api, /action==='member_state'/)
  assert.match(api, /action==='item_update'/)
})

test('TestFlight reviewer access is isolated from the real family household', async () => {
  const migration = await readFile(testFlightReviewMigrationPath, 'utf8')

  assert.match(migration, /'pepper-review'/)
  assert.match(migration, /'reviewer', 'Alex', 'adult_admin'/)
  assert.match(migration, /pin_input[\s\S]*\^\[0-9\]\{10\}\$/)
  assert.match(migration, /'pepper-review', 'reviewer', pin_input/)
  assert.match(migration, /'eriksen', member_slug_input, pin_input/)
  assert.match(migration, /reviewer PIN is provisioned out of band/i)
  assert.doesNotMatch(migration, /Danielle|Matt|Chloe|Lyra|Posey|La Mariposa|Las Colinas|Rancho Campana/)
  assert.doesNotMatch(migration, /pin_hash\s*=\s*crypt\('[0-9]+/)
})

test('pre-authentication UI keeps household identities private and masks the PIN', async () => {
  const [client, api, migration] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(apiPath, 'utf8'),
    readFile(nativeOAuthMigrationPath, 'utf8'),
  ])

  assert.doesNotMatch(client, /const FAMILY_CHOICES/)
  assert.doesNotMatch(client, /action: "login_members"/)
  assert.match(client, /Profile name/)
  assert.match(client, /type="password"/)
  assert.doesNotMatch(api, /action==='login_members'/)
  assert.match(migration, /lower\(m\.display_name\)/)
  assert.match(migration, /'danielle'/)
})

test('native Google authorization returns to Pepper instead of remaining in Safari', async () => {
  const [client, api, integrations, calendar, gmailCallback, webView, browserModel, info, migration] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(apiPath, 'utf8'),
    readFile(integrationsPath, 'utf8'),
    readFile(calendarPath, 'utf8'),
    readFile(gmailCallbackPath, 'utf8'),
    readFile(iosWebViewPath, 'utf8'),
    readFile(iosBrowserModelPath, 'utf8'),
    readFile(iosInfoPath, 'utf8'),
    readFile(nativeOAuthMigrationPath, 'utf8'),
  ])

  assert.match(client, /isPepperIOS/)
  assert.match(client, /return_target: isPepperIOS \? "pepper_ios" : "web"/)
  assert.match(api, /return_target:b\.return_target/)
  assert.match(integrations, /return_target/)
  assert.match(calendar, /return_target/)
  assert.match(gmailCallback, /pepper:\/\/oauth/)
  assert.match(webView, /startAuthentication/)
  assert.match(browserModel, /ASWebAuthenticationSession/)
  assert.match(info, /CFBundleURLSchemes[\s\S]*pepper/)
  assert.match(migration, /return_target text/)
})

test('account deletion is available in-app and privacy disclosures match collection', async () => {
  const [client, api, privacy, manifest] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(apiPath, 'utf8'),
    readFile(privacyPagePath, 'utf8'),
    readFile(iosPrivacyManifestPath, 'utf8'),
  ])

  assert.match(client, /Delete my Pepper account/)
  assert.match(client, /action: "account_delete"/)
  assert.match(client, /DELETE MY ACCOUNT/)
  assert.match(api, /action==='account_delete'/)
  assert.match(api, /delete from public\.household_members/)
  assert.doesNotMatch(privacy, /request account or household deletion through TestFlight feedback/)
  assert.match(manifest, /NSPrivacyCollectedDataTypeName/)
  assert.match(manifest, /NSPrivacyCollectedDataTypeHealthFitness/)
  assert.match(manifest, /NSPrivacyCollectedDataTypeOtherUserContent/)
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

test('tasks and appointments support audited edits, holds, and soft deletion', async () => {
  const [api, client, calendar, migration] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(clientPath, 'utf8'),
    readFile(calendarPath, 'utf8'),
    readFile(editableItemsMigrationPath, 'utf8'),
  ])

  assert.match(migration, /'on_hold'/)
  assert.match(migration, /deleted_at timestamptz/)
  assert.match(migration, /deleted_by_member_id uuid/)
  assert.match(migration, /canonical_content_override jsonb/)
  assert.match(api, /\['assign','edit','complete','cancel','delete','reopen'\]/)
  assert.match(api, /operation==='edit'/)
  assert.match(api, /operation==='delete'/)
  assert.match(api, /status.*on_hold/s)
  assert.match(api, /deleted_at=now\(\)/)
  assert.match(api, /event_edit/)
  assert.match(api, /task_edit/)
  assert.match(client, /Edit task/)
  assert.match(client, /Edit appointment/)
  assert.match(client, /On hold/)
  assert.match(client, /Delete from Pepper/)
  assert.match(calendar, /canonical_content_override/)
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

test('Looking Ahead excludes tasks and remains a family events horizon', async () => {
  const [client, horizon] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(horizonPath, 'utf8'),
  ])

  assert.match(client, /futureWatch\.filter\(\(item\) => item\.type !== "task"\)/)
  assert.match(client, /appointments, holidays, school changes and important family dates/)
  assert.doesNotMatch(horizon, /aheadTasks/)
  assert.match(horizon, /\.\.\.schoolAhead\.map/)
  assert.match(horizon, /\.\.\.aheadWatch\.map/)
  assert.match(horizon, /\.\.\.aheadItems\.map/)
})

test('family member pages include privacy-scoped medical appointments', async () => {
  const [api, client, calendarLogic] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(clientPath, 'utf8'),
    readFile(new URL('../supabase/functions/pepper-calendar/logic.ts', import.meta.url), 'utf8'),
  ])

  assert.match(api, /const \[events,appointments,tasks,profiles,schoolChanges,setup\]/)
  assert.match(api, /lower\(coalesce\(e\.kind,''\)\)='appointment'/)
  assert.match(api, /e\.person_slug=\$\{member\.slug\}/)
  assert.match(api, /new Map\(\[\.\.\.events,\.\.\.appointments\]/)
  assert.match(client, /const appointments = activeEvents\.filter\(isMedicalAppointment\)/)
  assert.match(client, /title="Appointments & care"/)
  assert.match(client, /const careTasks = activeTasks\.filter\(isMedicalCareTask\)/)
  assert.match(api, /String\(target\.display_name\)\.toLowerCase\(\)/)
  assert.match(client, /showDate/)
  assert.match(calendarLogic, /return 'appointment'/)
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
  assert.match(client, /const nextDecision = coordination\[0\]/)
  assert.match(client, /openAttention\(nextDecision\)/)
  assert.doesNotMatch(client, /Prepare \/ decide/)
  assert.match(client, /action: "conflict_resolve"/)
  assert.match(client, /Cancel event and open email draft/)
  assert.match(client, /mailto:/)
  assert.match(styles, /\.noticeButton/)
  assert.match(styles, /\.conflictChoice/)
  assert.match(calendar, /organizer\?:/)
  assert.match(calendar, /external_organizer_email/)
})

test('showcase views suppress duplicate decisions and use progressive disclosure', async () => {
  const [client, consequences] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(new URL('../supabase/functions/pepper-consequences/index.ts', import.meta.url), 'utf8'),
  ])

  assert.match(client, /function visibleConsequences/)
  assert.match(client, /function visibleReadiness/)
  assert.match(client, /function uniqueHorizonItems/)
  assert.match(client, /group\.tasks\.length > initialCount/)
  assert.match(client, /Show all \$\{group\.tasks\.length\}/)
  assert.match(client, /Show all \$\{weekGroceries\.length\} groceries/)
  assert.match(client, /window\.setTimeout\(\(\) => setMessage\(""\), 7000\)/)
  assert.match(consequences, /function displayKey/)
  assert.match(consequences, /const seen = new Set<string>/)
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
  assert.match(client, /Google email/)
  assert.match(client, /Gmail or Google Workspace/)
  assert.match(client, /Apple Health/)
  assert.match(client, /Pepper remains the source of truth/)
  assert.match(client, /Setup pending/)
  assert.match(integrations, /code_challenge_method','S256'/)
  assert.match(integrations, /gmail\.readonly/)
  assert.match(integrations, /'adult_admin','adult','teen'/)
  assert.match(integrations, /for their own account/)
  assert.doesNotMatch(integrations, /Only an adult can connect family email/)
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

test('the isolated API accepts the production beta and scoped preview host family', async () => {
  const api = await readFile(apiPath, 'utf8')
  assert.match(api, /https:\/\/pepper-family-beta\.vercel\.app/)
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

test('Pepper installs as a branded iPhone web app', async () => {
  const [manifest, layout, icon] = await Promise.all([
    readFile(appManifestPath, 'utf8'),
    readFile(appLayoutPath, 'utf8'),
    readFile(appleTouchIconPath),
  ])
  assert.match(manifest, /name: "Pepper Family Concierge"/)
  assert.match(manifest, /start_url: "\/pepper"/)
  assert.match(manifest, /display: "standalone"/)
  assert.match(manifest, /pepper-icon-maskable-512\.png/)
  assert.match(layout, /appleWebApp:/)
  assert.match(layout, /apple-touch-icon\.png/)
  assert.match(layout, /viewportFit: "cover"/)
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.ok(icon.byteLength > 1_000)
})

test('TestFlight has a public Pepper privacy notice without exposed contact credentials', async () => {
  const privacy = await readFile(privacyPagePath, 'utf8')

  assert.match(privacy, /Information Pepper uses/)
  assert.match(privacy, /does not sell personal information/)
  assert.match(privacy, /calendar events, relevant email content, or Apple Health summaries/)
  assert.match(privacy, /through the Feedback option in TestFlight/)
  assert.doesNotMatch(privacy, /@[a-z0-9.-]+\.[a-z]{2,}/i)
})
