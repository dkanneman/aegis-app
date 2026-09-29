# Pepper Appointment Release: Production Readiness

Historical read-only audit baseline. Preserve this evidence alongside the remediation contract in `docs/pepper-production-remediation-contract.md`; the newer contract controls the remediated candidate.

Date: 2026-09-16

Status: **NOT READY**. This is a preparation runbook, not deployment approval.

## Authorized release candidate

- Base commit: `d555fee1c4b5a9ade0d48c4d64b2fcd064207406`
- Staged files: 24
- Staged patch SHA-256: `074d32687c646a21ff3ece8830d80d1b77624b980a8e4e09121f466d9c548e89`
- Preserve unrelated staged, unstaged, and untracked work.
- Recompute both the file count and patch SHA-256 immediately before any later approval.

## Production destinations

### Supabase

- Project name: `pepper-v6-private-preview`
- Project ref: `mfgyeolvfthxacrqwwtc`
- API URL: `https://mfgyeolvfthxacrqwwtc.supabase.co`
- Region: `ca-central-1`
- OAuth callback: `https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-calendar/callback`

### Vercel

- Team: `dkanneman-8936's projects`
- Team ID: `team_3rWNRDxVKHU8lfZ14FxhbzqO`
- Project: `pepper-family-beta`
- Project ID: `prj_Uh7AsLklzGzeHgKcnQ9J7HEHh5WH`
- Stable production URL: `https://pepper-family-beta.vercel.app/pepper`
- Git repository: `dkanneman/aegis-app`
- Current deployment commit: `d555fee1c4b5a9ade0d48c4d64b2fcd064207406`

### Google Calendar

- Current connection count: 1
- Current destination: connected Google account's primary calendar ID, redacted
- Non-secret destination fingerprint (MD5): `0a3c9cc3c88fb1e4d05014d910f7b39d`
- Current stored authorization: read-only; the reviewed app-created scope is absent
- Required Calendar scope: `https://www.googleapis.com/auth/calendar.app.created`
- Required identity scopes: `openid email`
- Human action after an approved deployment: reconnect Google Calendar through Pepper so Pepper can verify the account and create its own `Pepper Family` calendar.

The staged writer rejects the existing primary destination. It accepts only an exact ID returned by Pepper's own `Calendars.insert` setup flow, backed by stored installation-marker, `dataOwner`, mode, scope, and OIDC identity proof and revalidated with `Calendars.get` before every operation. Manually created and same-name calendars are never adopted. A reversible direct event probe must complete before activation.

### AEGIS

- Workbook: `AEGIS HOME - Master Control Database`
- Spreadsheet ID: `10v670z9ajMof7lR2mngmGbD4zwnDMjuAYzX8cG_C7y4`
- Logical destination inspected: `Calendar Events`, sheet ID `107`
- Existing destination columns: 8
- Staged canonical writer columns: 19

The existing `Calendar Events` tab is not schema-compatible with the staged writer. No production tab or reviewed column mapping exists. Do not write until a dedicated production tab or an explicit adapter has been implemented and reviewed.

The available service account is the sandbox writer `pepper-aegis-sandbox-writer@pepper-aegis-sync.iam.gserviceaccount.com`. It must not be given production workbook access as an accidental substitute. Production access must be limited to the one approved destination spreadsheet/tab and require no Drive, folder, shared-drive, or domain-wide permission.

## Migration order

1. `20260915164500_harden_appointment_intake_and_bridge.sql`
2. `20260915175808_prioritize_daily_plan_tasks.sql`
3. `20260916120000_sync_published_appointments.sql`
4. `20260916143000_fail_closed_aegis_sandbox_delivery.sql`

Production already records the first two logical migrations under versions `20260915203426` and `20260915203431`. Do not rerun the local first two files. Before release, either align the reviewed files with the existing ledger or perform a separately approved migration-history repair after exact SQL/schema equivalence is documented. Migrations 3 and 4 are absent. Migration 4 is sandbox-specific and must not be applied to production unchanged.

## Edge Function order

1. `pepper-calendar` (`verify_jwt=false`; custom callback, cron, and service authorization)
2. `aegis-bridge-worker` (`verify_jwt=false`; custom producer/service authorization)
3. `pepper-tell-v2` (`verify_jwt=true`)
4. `pepper-family-api` (`verify_jwt=true`)

Current deployed versions are respectively 10, 4, 5, and 29. Preserve their source bundles and deployment metadata before replacement.

## Configuration inventory

Present or platform-provided:

- `SUPABASE_URL`
- `SUPABASE_DB_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `PEPPER_APP_URL` (present but incorrect: it points to an obsolete protected preview URL)

Required but not independently verified:

- `SUPABASE_ANON_KEY`
- `PEPPER_DB_SSL`
- `PEPPER_APP_ORIGIN`
- `GOOGLE_REDIRECT_URI`
- `NEXT_PUBLIC_PEPPER_API_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Absent or not production-ready:

- Vault secret `pepper_calendar_cron_secret`
- Production Calendar mode and expected Google account identity
- Production AEGIS destination tab/mapping
- Production AEGIS scoped writer authorization
- Production AEGIS mode/configuration in code

The exact AEGIS credential secret name is `AEGIS_GOOGLE_SERVICE_ACCOUNT_JSON`. Its value must be entered only in the Supabase secret store; never place it in Git, Vercel client variables, logs, or chat.

The following names are proposals and are not consumed by the staged code yet:

```dotenv
PEPPER_CALENDAR_MODE=production
PEPPER_GOOGLE_ACCOUNT_EMAIL=<exact-approved-google-account-email>
AEGIS_MODE=production
AEGIS_PRODUCTION_SPREADSHEET_ID=10v670z9ajMof7lR2mngmGbD4zwnDMjuAYzX8cG_C7y4
AEGIS_PRODUCTION_SHEET_NAME=<unresolved>
AEGIS_GOOGLE_SERVICE_ACCOUNT_JSON=<secret-store-only>
```

## Read-only baseline

| Check | Result |
| --- | ---: |
| Active events | 162 |
| Active appointments | 7 |
| Typed appointments | 7 |
| Fixed-priority appointments | 7 |
| Appointments retaining original source text | 2 |
| Events linked to Google | 85 |
| Active tasks | 181 |
| Actionable tasks | 118 |
| Ambiguous high-ranking tasks | 0 |
| Raw captures | 209 |
| Calendar connections | 1 |
| Bridge deliveries | 2 |
| Duplicate appointment dedupe keys | 0 |
| Malformed timestamps | 0 |
| Invalid appointment types | 0 |
| Orphaned bridge deliveries | 0 |

RLS is enabled on the public appointment tables and no browser-role grants were found on the private token, review-queue, or delivery-ledger tables. The security advisor reported informational `rls_enabled_no_policy` notices only. The performance advisor reported informational items, including an unindexed `appointment_bridge_deliveries.household_id` foreign key.

## Release sequence after separate approval

### 1. Freeze and fingerprint

```bash
git rev-parse HEAD
git diff --cached --name-only | wc -l
git diff --cached --full-index --binary | shasum -a 256
git status --short
```

Abort unless the approved base commit, staged file count, and patch fingerprint match the release authorization.

### 2. Back up before mutation

Confirm a restorable Supabase Dashboard backup or PITR point immediately before deployment. Also create Supabase-compatible logical dumps to an encrypted local release directory:

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f schema.sql
supabase db dump --db-url "$SUPABASE_DB_URL" -f data.sql --use-copy --data-only
```

Export the current four Edge Function bundles/metadata, Vercel deployment ID, migration ledger, scheduler rows, connection status, and the baseline counts above. Verify that a clean isolated restore of the dump succeeds before continuing.

### 3. Resolve release blockers

1. Complete real sandbox verification of the app-created Calendar flow using only `openid email calendar.app.created`.
2. Confirm the production account manually, but do not create a production Calendar; Pepper creates and stores it during the later approved setup flow.
3. Implement a production AEGIS adapter for a dedicated 19-column tab, or approve and test an exact mapping to an existing tab.
4. Replace the sandbox-specific fourth migration with a reviewed production migration.
5. Reconcile the first two migration versions without reapplying their DDL/data changes.
6. Correct `PEPPER_APP_URL` to `https://pepper-family-beta.vercel.app/pepper` and verify `PEPPER_APP_ORIGIN`.
7. Validate all required secret names by presence only.
8. Re-run local, preview, and real sandbox create/update/replay/partial-failure/cancel tests.
9. Produce and authorize a new staged fingerprint because blocker fixes will change this candidate.

### 4. Database migration

On the approved candidate, run the preflight SQL and compare results to the captured baseline. Use `supabase db push --dry-run --linked` and review every statement. Apply only the reconciled production migration set. Never use `--include-all` until the duplicate migration-version issue is resolved.

After migration, verify columns, constraints, RPCs, triggers, row counts, RLS, grants, and rollback backup rows before deploying functions.

### 5. Configure server-side secrets

Enter approved server-only values through Supabase secret management. Never echo them. Confirm names and presence, not values. Keep Calendar and AEGIS writers disabled until their exact destination allowlists pass a read-only configuration check.

### 6. Deploy functions

```bash
supabase functions deploy pepper-calendar --project-ref mfgyeolvfthxacrqwwtc --no-verify-jwt
supabase functions deploy aegis-bridge-worker --project-ref mfgyeolvfthxacrqwwtc --no-verify-jwt
supabase functions deploy pepper-tell-v2 --project-ref mfgyeolvfthxacrqwwtc
supabase functions deploy pepper-family-api --project-ref mfgyeolvfthxacrqwwtc
```

Verify each deployed digest against the approved bundle before proceeding.

### 7. Configure OAuth and scheduler

1. Confirm the Google OAuth client authorizes the exact callback URL above.
2. Manually reconnect the production account and grant only `openid`, `email`, and `https://www.googleapis.com/auth/calendar.app.created`.
3. Verify Pepper creates `Pepper Family`, stores the exact returned ID and ownership proof, validates it with `Calendars.get`, completes the private create/read/delete/absence probe, and reports connected/write-capable.
4. Create `pepper_calendar_cron_secret` in Vault.
5. Call `private.pepper_schedule_calendar_sync()` with the exact production function URL.
6. Verify exactly one active `pepper-calendar-sync` job exists and that its secret is never exposed.

### 8. Deploy Vercel

Deploy the exact approved Git commit to the existing `pepper-family-beta` project. Do not promote a preview with a different commit or environment. Verify the stable production alias resolves to the approved deployment.

### 9. Smoke test

Use one clearly labeled, reversible production canary only after separate approval. Verify capture preservation, one Pepper appointment, Pacific time/UTC normalization, one Google event, one AEGIS record, one delivery ledger, stable external IDs through edit/reschedule, idempotent replay, visible incomplete-delivery state, cancellation, and precise cleanup. Stop immediately on any unexpected destination or duplicate.

### 10. Monitor

For at least one scheduler interval, watch Edge Function errors, delivery-ledger retries, Calendar API 401/403/404/409 responses, AEGIS verification failures, duplicate counts, queue depth, and scheduler run history. Never report `One Brain updated` while either required delivery remains incomplete.

## Rollback sequence

1. Disable only the new `pepper-calendar-sync` cron job.
2. Disable external writer execution without deleting credentials or data.
3. Redeploy the captured previous versions: calendar 10, bridge 4, tell 5, family API 29.
4. Restore the prior Vercel deployment alias if the UI was promoted.
5. Resolve all `retry_required`, `reconnect_required`, and `needs_review` deliveries; the rollback script intentionally refuses to narrow constraints while such rows remain.
6. Run `supabase/tests/appointment_release_rollback.sql` only after reviewing its task-field restoration and destructive column/table drops against the backup.
7. Re-run counts, dedupe, orphan, RLS, grants, scheduler, and connection checks.
8. If data/schema validation fails, restore the verified pre-release backup or PITR point and redeploy the captured previous functions.
9. Reconcile only the specific canary Calendar event and AEGIS row by recorded external IDs; never bulk-delete.

## Current blockers

1. The app-created Calendar flow has not completed real external sandbox verification.
2. Current Google connection lacks `calendar.app.created`; manual reconnect is required later.
3. Current Calendar destination is the primary account calendar and is ineligible; Pepper must create a new dedicated destination during the approved setup flow.
4. No schema-compatible production AEGIS tab or adapter exists.
5. The available AEGIS writer is sandbox-scoped; production access is not configured.
6. Migration 4 is sandbox-specific.
7. The first two local migration versions conflict with the production migration ledger.
8. Calendar retry scheduler and Vault secret are absent.
9. `PEPPER_APP_URL` points to an obsolete protected preview URL.
10. Vercel environment-variable presence was not independently enumerable in this read-only audit.
