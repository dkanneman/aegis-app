import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('OAuth return target is a canonical forward migration and mandatory database gate', async () => {
  const manifest = JSON.parse(await text('supabase/production-appointment-release.json'))
  const migration = await text('supabase/migrations/20260928230029_persist_calendar_oauth_return_target.sql')
  const gate = await text(manifest.requiredLocalOAuthGate)
  assert.match(migration, /return_target text not null default 'web'/)
  assert.match(migration, /return_target in \('web', 'pepper_ios'\)/)
  assert.doesNotMatch(migration, /delete\s+from|disable row level security|grant\s/i)
  assert.match(gate, /canonical OAuth schema preflight is mandatory/)
  assert.match(gate, /response.status/)
  assert.match(gate, /code_challenge_method/)
})

async function text(path) {
  return readFile(new URL(path, root), 'utf8')
}

test('hosted transport prerequisite is repaired before event-write acceptance', async () => {
  const manifest = JSON.parse(await text('supabase/production-appointment-release.json'))
  const repair = await text('supabase/migrations/20260929225018_reconcile_transport_schema_prerequisite.sql')
  const chore = await text('supabase/migrations/20260929002346_materialize_recurring_chore_occurrences.sql')
  const normalize = (sql) => sql.match(/create or replace function public\.normalize_parent_transport_assignment\(\)[\s\S]*?\$\$;/)[0]
  assert.equal(normalize(repair), normalize(chore))
  assert.match(repair, /create table if not exists public\.trusted_drivers/)
  assert.match(repair, /add column if not exists trusted_driver_id uuid/)
  assert.match(repair, /enable row level security/)
  assert.match(repair, /revoke all on table public\.trusted_drivers from anon, authenticated/)
  assert.doesNotMatch(repair, /disable row level security|delete from public\.|truncate /i)
  const gate = await text(manifest.requiredHostedSchemaTransportGate)
  assert.match(gate, /insert into public\.events/)
  assert.match(gate, /cross-household driver accepted/)
  assert.match(gate, /rollback;/)
})

test('production migration manifest maps existing history without reapplying it', async () => {
  const manifest = JSON.parse(await text('supabase/production-appointment-release.json'))
  assert.deepEqual(manifest.logicalMappings.map((item) => ({
    local: item.localVersion,
    production: item.productionVersion,
    action: item.productionAction,
  })), [
    {
      local: '20260915164500',
      production: '20260915203426',
      action: 'map_without_reapply',
    },
    {
      local: '20260915175808',
      production: '20260915203431',
      action: 'map_without_reapply',
    },
  ])
  assert.deepEqual(manifest.productionOrder.map((item) => item.version), [
    '20260915203426',
    '20260915203431',
    '20260916120000',
    '20260916150000',
    '20260917211929',
    '20260928230029',
    '20260929002346',
    '20260929173234',
    '20260929191406',
    '20260929225018',
  ])
  assert.deepEqual(manifest.excludedFromProduction.map((item) => item.version), ['20260916143000'])
  assert.deepEqual(manifest.calendarAuthorization, {
    calendarScope: 'https://www.googleapis.com/auth/calendar.app.created',
    identityScopes: ['openid', 'email'],
    creationMethod: 'google_calendars_insert_v1',
    calendarName: 'Pepper Family',
    destinationSource: 'stored_calendars_insert_response_id',
    metadataValidation: 'calendars_get_exact_stored_id_marker_data_owner_and_oidc_identity',
    activationProbe: 'direct_event_create_read_delete_absence_verification',
    externalSandboxVerificationRequired: true,
  })
  assert.deepEqual(manifest.householdCalendarContributions.writeRoles,['adult_admin','adult'])
  assert.equal(manifest.householdCalendarContributions.childBehavior,'proposal_needs_review_no_external_write')
  assert.equal(manifest.householdCalendarContributions.teenBehavior,'proposal_needs_review_no_external_write')
  assert.equal(manifest.householdCalendarContributions.oauthTokenExposure,'server_only')
})

test('canonical bootstrap restores omitted production schema without private seed data', async () => {
  const [manifestText, runtime, core] = await Promise.all([
    text('supabase/production-appointment-release.json'),
    text('supabase/migrations/20260814230412_pepper_family_beta_runtime_schema.sql'),
    text('supabase/migrations/20260814230349_pepper_family_beta_core_tables.sql'),
  ])
  const manifest = JSON.parse(manifestText)

  assert.deepEqual(manifest.canonicalBootstrap, {
    productionLedgerVersion: '20260814230412',
    productionMigrationName: 'pepper_family_beta_sessions_seed',
    localSchemaSource: 'supabase/migrations/20260814230412_pepper_family_beta_runtime_schema.sql',
    productionAction: 'already_applied_do_not_reapply',
    equivalence: 'schema_only_catalog_reconstruction_private_seed_omitted',
    freshBootstrap: 'apply_canonical_migrations_in_version_order',
    productionShapedReconstruction: 'use_same_canonical_chain_with_reviewed_version_mappings',
    productionShapedBuilder: 'supabase/tests/build_production_shaped_migrations.sh',
    containsPrivateSeedData: false,
  })
  assert.match(runtime, /add column if not exists pin_hash text/)
  assert.match(runtime, /create table if not exists public\.member_sessions/)
  assert.match(runtime, /create table if not exists public\.calendar_connections/)
  assert.match(runtime, /add column if not exists notes text null/)
  assert.doesNotMatch(runtime, /insert\s+into\s+public\.(?:households|household_members)/i)
  assert.doesNotMatch(runtime, /crypt\('[0-9]+/)
  assert.match(core, /create table public\.groceries/)
})

test('production-shaped rehearsal is derived from canonical migrations', async () => {
  const [builder, prerequisites] = await Promise.all([
    text('supabase/tests/build_production_shaped_migrations.sh'),
    text('supabase/tests/local_supabase_platform_prerequisites.sql'),
  ])

  assert.match(builder, /20260915203426_harden_appointment_intake_and_bridge\.sql/)
  assert.match(builder, /20260915203431_prioritize_daily_plan_tasks\.sql/)
  assert.match(builder, /20260916143000/)
  assert.match(builder, /20260915195726/)
  assert.match(builder, /Pending release migration is missing/)
  const pending = builder.match(/pending_versions=\(([\s\S]*?)\)/)[1]
  assert.match(pending, /20260929191406/)
  assert.doesNotMatch(builder, /appointment_release_rehearsal_foundation/)
  assert.match(prerequisites, /create extension if not exists pg_cron/)
  assert.doesNotMatch(prerequisites, /create\s+table|alter\s+table|insert\s+into/i)
})

test('scheduler migration fails closed on missing Vault configuration and duplicates', async () => {
  const migration = await text('supabase/migrations/20260916120000_sync_published_appointments.sql')
  assert.match(migration, /Vault secret pepper_calendar_cron_secret must be created before scheduling/)
  assert.match(migration, /Duplicate pepper-calendar-sync jobs must be reconciled before scheduling/)
  assert.match(migration, /Existing pepper-calendar-sync job does not match the reviewed configuration/)
  assert.match(migration, /create or replace function private\.pepper_disable_calendar_sync\(\)/)
  assert.doesNotMatch(migration, /vault\.create_secret/)
})

test('production AEGIS migration is separate, generic, and rollback-addressable', async () => {
  const [production, sandbox, rollback] = await Promise.all([
    text('supabase/migrations/20260916150000_production_appointment_delivery.sql'),
    text('supabase/migrations/20260916143000_fail_closed_aegis_sandbox_delivery.sql'),
    text('supabase/tests/appointment_release_production_rollback.sql'),
  ])
  assert.match(production, /AEGIS appointment write completed and exact readback verified/)
  assert.match(production, /cannot be marked synced without write and readback timestamps/i)
  assert.match(production, /appointment_bridge_deliveries_household_idx/)
  assert.doesNotMatch(production, /AEGIS sandbox delivery remains incomplete/)
  assert.match(sandbox, /AEGIS sandbox write completed and readback verified/)
  assert.match(rollback, /private\.pepper_disable_calendar_sync\(\)/)
  assert.match(rollback, /Retain additive delivery columns, indexes, RPCs/)
  assert.doesNotMatch(rollback, /drop column|drop table/)
})

test('appointment release rollback restores exact state and migration replay is data-idempotent', async () => {
  const [migration, rollback, exactRollback, hashQuery] = await Promise.all([
    text('supabase/migrations/20260916120000_sync_published_appointments.sql'),
    text('supabase/tests/appointment_release_production_rollback.sql'),
    text('supabase/tests/appointment_release_pending_rollback.sql'),
    text('supabase/tests/appointment_release_rehearsal_hash.sql'),
  ])

  assert.match(migration, /appointment_release_calendar_connection_backup/)
  assert.match(migration, /calendar_connections_app_created_proof_check/)
  assert.match(migration, /calendar_connections_active_probe_check/)
  assert.match(migration, /pepper_calendar_marker/)
  assert.match(migration, /google_data_owner/)
  assert.match(migration, /google_calendars_insert_v1/)
  assert.match(migration, /status is distinct from 'reconnect_required'/)
  assert.match(migration, /sync_status is distinct from 'error'/)
  assert.ok(
    rollback.indexOf('drop trigger if exists zz_tasks_medical_coordination_priority')
      < rollback.indexOf('update public.tasks task'),
    'rollback must disable reprioritization before restoring backed-up task fields',
  )
  assert.match(rollback, /appointment_release_calendar_connection_backup/)
  assert.match(exactRollback, /drop table if exists private\.appointment_release_calendar_connection_backup/)
  assert.match(exactRollback, /case when excluded\.google_status = 'pending' then 1 else 0 end/)
  assert.match(hashQuery, /digest\(/)
  assert.match(hashQuery, /private\.appointment_bridge_deliveries/)
})

test('runtime configuration exposes explicit production contracts without Gmail scope', async () => {
  const [calendar, bridge] = await Promise.all([
    text('supabase/functions/pepper-calendar/index.ts'),
    text('supabase/functions/aegis-bridge-worker/index.ts'),
  ])
  assert.match(calendar, /PEPPER_CALENDAR_MODE/)
  assert.match(calendar, /PEPPER_GOOGLE_ACCOUNT_EMAIL/)
  assert.match(calendar, /GOOGLE_OAUTH_SCOPE/)
  assert.match(calendar, /verifyGoogleIdToken/)
  assert.match(calendar, /calendar\/v3\/calendars'/)
  assert.match(calendar, /openidconnect\.googleapis\.com\/v1\/userinfo/)
  assert.match(calendar, /validateCalendarResource/)
  assert.match(calendar, /probePepperCalendar/)
  assert.doesNotMatch(calendar, /users\/me\/calendarList|calendarList\?/)
  assert.doesNotMatch(calendar, /PEPPER_PRODUCTION_CALENDAR_ID/)
  assert.doesNotMatch(calendar, /GOOGLE_CALENDAR_EVENTS_SCOPE/)
  assert.doesNotMatch(calendar, /gmail\.googleapis|auth\/gmail/)
  assert.match(bridge, /AEGIS_MODE/)
  assert.match(bridge, /AEGIS_PRODUCTION_SPREADSHEET_ID/)
  assert.match(bridge, /AEGIS_PRODUCTION_SHEET_NAME/)
  assert.match(bridge, /AEGIS_PRODUCTION_SERVICE_ACCOUNT_EMAIL/)
  assert.match(bridge, /AEGIS_GOOGLE_SERVICE_ACCOUNT_JSON/)
})
