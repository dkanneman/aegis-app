# Pepper Production Appointment Contract

Prepared: 2026-09-17

This document prepares production configuration. It is not deployment approval and contains no secret values.

## Calendar contract

- Runtime mode: `PEPPER_CALENDAR_MODE=production`
- Protected account identifier: `PEPPER_GOOGLE_ACCOUNT_EMAIL`
- Required calendar name: `Pepper Family`
- Required creation rule: Pepper creates the calendar with `Calendars.insert`; it never adopts a manual or existing same-name calendar
- Required ID rule: the requested ID must exactly equal the immutable ID returned by `Calendars.insert` and stored on the connection
- Required OAuth scopes only: `openid email https://www.googleapis.com/auth/calendar.app.created`
- Required callback: `https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-calendar/callback`
- Identity rule: the signed Google OIDC token must have the expected issuer, OAuth client audience, unexpired timestamp, request nonce, verified email, immutable subject, and an email matching `PEPPER_GOOGLE_ACCOUNT_EMAIL` case-insensitively
- Persistence rule: one transaction stores the returned ID, exact title, random installation UUID and description marker, verified OIDC email and subject, returned `dataOwner`, exact scopes, creation time, and runtime mode before validation
- Probe-evidence binding rule: Postgres.js must bind the sanitized probe object with its `sql.json(...)`/transaction `.json(...)` helper. Passing `JSON.stringify(...)` as a generic parameter stores a JSON string and is rejected by `calendar_connections_active_probe_check`; activation remains inactive on every persistence or constraint error
- Metadata rule: before activation and before every create, update, cancellation, retry, replay, or scan, `Calendars.get` on the exact stored ID must return the exact ID, title, description marker, and `dataOwner`; current OIDC identity, stored identity, scopes, and mode must also match
- Activation rule: a direct private `[PEPPER CONNECTION TEST]` event must be created with a deterministic ID and no attendees, read back, deleted with `sendUpdates=none`, and verified absent before `status=connected` is permitted
- Probe deletion rule: absence is confirmed only by HTTP 404, HTTP 410, or HTTP 200 containing the exact deterministic event ID with `status=cancelled` and neither `recurringEventId` nor `originalStartTime`, from a request against the exact stored Pepper-created calendar ID. The canceled tombstone may contain only `id` and `status`. Every mismatch, malformed body, active status, recurring exception, authorization error, rate limit, or server error fails closed
- Rejected destinations: `primary`, the authenticated account email (case-insensitive exact match), manually created calendars, existing same-name calendars, missing creation proof, missing IDs or metadata, title/marker/owner/identity/mode mismatches, incomplete probes, and every ID that differs from the stored app-created ID
- Payload rule: no attendees or guests
- Update rule: use the stored external calendar ID and Google event ID; never create a replacement for a stale or deleted linked event
- Cancellation rule: delete/cancel the stored Google event with `sendUpdates=none`
- Cancellation verification boundary: the connection-probe tombstone helper remains probe-only. Ordinary appointment cancellation retains its reviewed exact stored calendar/event DELETE behavior; recurring-event semantics are not changed by this remediation
- Fallback rule: none

Sandbox mode remains separate:

- `PEPPER_CALENDAR_MODE=sandbox`
- `PEPPER_GOOGLE_ACCOUNT_EMAIL=<protected sandbox OAuth account email>`
- Exact calendar name `Pepper Sandbox`
- Pepper must create and store the sandbox calendar through the same controlled setup flow; a manually created sandbox calendar is not eligible
- Synthetic event prefix `[PEPPER TEST]`

## AEGIS production contract

- Runtime mode: `AEGIS_MODE=production`
- Workbook ID: `10v670z9ajMof7lR2mngmGbD4zwnDMjuAYzX8cG_C7y4`
- Tab: `Pepper Appointments`
- Protected credential secret: `AEGIS_GOOGLE_SERVICE_ACCOUNT_JSON`
- Protected identity allowlist: `AEGIS_PRODUCTION_SERVICE_ACCOUNT_EMAIL`
- Permission boundary: the production-specific service account receives Editor access to this spreadsheet only
- Prohibited permissions: production folder, shared drive, domain-wide delegation, Gmail, Calendar, or unrelated Drive files
- The sandbox writer must not be shared on the production workbook

The exact header row is:

```text
record_id,event_id,capture_id,status,title,starts_at,ends_at,timezone,appointment_type,patient_member_id,patient_slug,clinician,facility,location,preparation_instructions,original_source_text,dedupe_key,updated_at,source
```

Identity rules:

- `record_id`: `pepper-event:<event UUID>`; stable canonical appointment identity
- `dedupe_key`: `pepper-delivery:<event UUID>`; stable delivery identity across update, replay, reschedule, and cancellation
- `event_id`: Pepper canonical event UUID
- `capture_id`: current preserved source capture UUID

The writer scans `record_id`. Zero matches appends once, one match updates that row, and multiple matches fail as `needs_review`. A write is not `synced` until an exact 19-cell readback matches the attempted row.

### Legacy Calendar Events

`Pepper Appointments` is Pepper's sole AEGIS appointment projection. Pepper must not dual-write to the legacy `Calendar Events` tab. The legacy tab remains unchanged.

If legacy reporting later requires these appointments, use a read-only formula, query, or separately reviewed one-way reconciliation keyed by `record_id`. That consumer must never become a second canonical writer and must reject duplicate `record_id` values.

## Migration reconciliation

Production already contains the first two logical migrations under different versions:

| Local source | Production version | Result |
| --- | --- | --- |
| `20260915164500_harden_appointment_intake_and_bridge.sql` | `20260915203426` | Structurally equivalent at the 2026-09-16 preflight; map without reapplying |
| `20260915175808_prioritize_daily_plan_tasks.sql` | `20260915203431` | Structurally equivalent at the 2026-09-16 preflight; map without reapplying |

The remote migration SQL body was not available for byte comparison. Equivalence is therefore structural, based on the required columns, constraints, indexes, triggers, RPCs, and sampled production state. The production manifest records this limitation.

Final production order:

1. Existing `20260915203426` mapped to local `20260915164500`; do not reapply
2. Existing `20260915203431` mapped to local `20260915175808`; do not reapply
3. Apply `20260916120000_sync_published_appointments.sql` after backup and preflight
4. Apply `20260916150000_production_appointment_delivery.sql`

Exclude `20260916143000_fail_closed_aegis_sandbox_delivery.sql` from production.

Use `supabase/tests/appointment_release_production_rollback.sql` for production rollback. It restores the prior medical-coordination behavior and disables the scheduler while retaining additive delivery columns, RPCs, indexes, and the backup table so audit evidence is not destroyed. The older `appointment_release_rollback.sql` remains a destructive preview-only rehearsal.

The sync migration now refuses to schedule when the Vault secret is absent, refuses duplicate jobs, leaves an already-correct job untouched, and provides a guarded disable RPC. It no longer creates or rotates secrets implicitly.

## Environment manifest

### Supabase Edge Functions

| Variable | Required value or rule | Read-only inventory |
| --- | --- | --- |
| `SUPABASE_URL` | Platform project URL | Present/platform-provided |
| `SUPABASE_DB_URL` | Production database connection | Present |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service credential | Present/platform-provided |
| `SUPABASE_ANON_KEY` | Pepper API browser authorization | Unverifiable |
| `PEPPER_DB_SSL` | Omit or `require` in production | Unverifiable |
| `PEPPER_APP_URL` | `https://pepper-family-beta.vercel.app/pepper` | Present but incorrect |
| `PEPPER_APP_ORIGIN` | `https://pepper-family-beta.vercel.app` | Unverifiable |
| `GOOGLE_CLIENT_ID` | Existing Google OAuth client | Present |
| `GOOGLE_CLIENT_SECRET` | Existing Google OAuth client secret | Present |
| `GOOGLE_REDIRECT_URI` | Exact production callback above | Unverifiable |
| `PEPPER_CALENDAR_MODE` | `production` | Missing/new contract |
| `PEPPER_GOOGLE_ACCOUNT_EMAIL` | Exact OAuth account email verified from signed OIDC claims | Missing/manual setup |
| `AEGIS_MODE` | `production` | Missing/new contract |
| `AEGIS_PRODUCTION_SPREADSHEET_ID` | Exact production workbook ID above | Missing/new contract |
| `AEGIS_PRODUCTION_SHEET_NAME` | `Pepper Appointments` | Missing/new contract |
| `AEGIS_PRODUCTION_SERVICE_ACCOUNT_EMAIL` | Exact production writer email | Missing/manual setup |
| `AEGIS_GOOGLE_SERVICE_ACCOUNT_JSON` | Production writer JSON, secret store only | Missing/manual setup |

### Vercel

| Variable | Required value | Inventory |
| --- | --- | --- |
| `NEXT_PUBLIC_PEPPER_API_URL` | `https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-family-api` | Unverifiable through available read-only tooling |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production anon key | Unverifiable through available read-only tooling |

The reviewed client contains production fallbacks for both Vercel values. The variables should still be explicitly configured to avoid an implicit environment contract.

### Calendar authorization resolution and remaining gate

The local candidate requests only `openid`, `email`, and `https://www.googleapis.com/auth/calendar.app.created`. Pepper uses `Calendars.insert` to create its own destination and `Calendars.get` against that stored exact ID before every Calendar operation. Ownership is proven by the exact installation marker, returned `dataOwner`, and matching OIDC identity. Secondary status is established by Pepper-controlled creation plus rejection of `primary` and the account-email ID; generic ID shape is never used.

The prior external sandbox attempt established that `CalendarList.get` returns `401 Invalid Credentials` under this exact narrow grant. The candidate therefore makes no CalendarList request and does not add `calendar.calendarlist.readonly`, `calendar.events`, broad Calendar, or Calendar readonly. Write capability is proven by the reversible direct connection probe and by fail-closed handling of every later API write.

The second sandbox attempt proved that consent, OIDC identity verification, `Calendars.insert`, exact `Calendars.get` metadata validation, probe creation/readback/deletion, and canceled-tombstone absence verification all succeeded. Activation then failed closed because the runtime interpolated `JSON.stringify(probeEvidence)` into a JSONB parameter, producing a JSON string instead of an object. The database constraint correctly rejected the malformed value, no token or active connection persisted, and no appointment or AEGIS delivery was created. The local remediation uses Postgres.js's supported transaction `.json(probeEvidence)` binding and verifies the object contract against real disposable PostgreSQL. The rehearsal also found and closed PostgreSQL's nullable-`CHECK` gap by requiring evidence to be non-null and `jsonb_typeof(...)='object'` before containment is evaluated.

Production remains blocked until the remediated staged-only candidate completes real external sandbox verification through calendar creation, `Calendars.get` proof, persisted activation, event create/update/retry/replay/cancel, cleanup, and OAuth disconnection. Before that retest, the clean staged-only full suite must reach zero failures without staging the unrelated Gmail configuration currently co-located in the untracked `supabase/config.toml`. If `calendar.app.created` fails any part of that lifecycle, stop. Do not silently fall back or broaden scopes.

### Vault

| Secret | State |
| --- | --- |
| `pepper_calendar_cron_secret` | Missing |

## Manual setup after separate authorization

### Create the production Calendar

Do not create `Pepper Family` manually. After deployment is separately approved, an adult starts the Pepper Google Calendar setup flow in the approved Google account. Pepper requests the three documented scopes, verifies the signed identity, creates `Pepper Family` through `Calendars.insert`, stores the returned ID and proof fields, verifies it with `Calendars.get`, completes the reversible connection probe, and only then marks the connection active. No Calendar ID is entered as a secret.

### Confirm Google OAuth

1. Open Google Cloud Console for the Pepper OAuth project.
2. Open **APIs & Services**, then **Credentials**.
3. Open the reviewed OAuth 2.0 Web client.
4. Under **Authorized redirect URIs**, confirm the exact production callback URL above.
5. Confirm the consent configuration permits only `openid`, `email`, and `calendar.app.created` for this flow.
6. Do not add Gmail, Contacts, Drive, general Calendar, Calendar readonly, CalendarList, or other Google scopes.
7. After deployment approval, reconnect through Pepper and confirm the consent screen matches the reviewed scope set.

### Create the production AEGIS destination

1. Open the production AEGIS workbook by the exact spreadsheet ID above.
2. Add one tab named `Pepper Appointments` exactly.
3. Paste the exact 19 headers into row 1 in the documented order.
4. Freeze row 1 if desired; do not add, remove, rename, or reorder columns.
5. Leave `Calendar Events` unchanged.
6. In Google Cloud IAM, create a production-specific Sheets service account. Do not reuse the sandbox writer.
7. Create its JSON key and store it outside the repository.
8. Share only the production workbook with the service-account email as Editor.
9. Do not share the workbook folder, shared drive, or domain.
10. Later enter the email in `AEGIS_PRODUCTION_SERVICE_ACCOUNT_EMAIL` and the JSON in `AEGIS_GOOGLE_SERVICE_ACCOUNT_JSON` through Supabase secret management.

### Configure and rotate the retry secret

Generate a cryptographically random value outside SQL and enter it directly into Vault. Do not paste it into shell history or this document.

Create:

```sql
select vault.create_secret(
  '<generated-secret>',
  'pepper_calendar_cron_secret',
  'Authenticates Pepper Calendar import and appointment retry jobs.'
);
```

Rotate:

```sql
select vault.update_secret(
  (select id from vault.secrets where name='pepper_calendar_cron_secret'),
  '<new-generated-secret>',
  'pepper_calendar_cron_secret',
  'Authenticates Pepper Calendar import and appointment retry jobs.'
);
```

Detect duplicates before enabling:

```sql
select jobid,jobname,schedule,active
from cron.job
where jobname='pepper-calendar-sync';
```

Enable only after the query returns zero rows and the Vault query returns exactly one named secret:

```sql
select private.pepper_schedule_calendar_sync(
  'https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-calendar'
);
```

Disable or roll back:

```sql
select private.pepper_disable_calendar_sync();
```

## Production routing values

- `PEPPER_APP_URL=https://pepper-family-beta.vercel.app/pepper`
- `PEPPER_APP_ORIGIN=https://pepper-family-beta.vercel.app`
- `NEXT_PUBLIC_PEPPER_API_URL=https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-family-api`
- OAuth callback: `https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-calendar/callback`

No value in this document authorizes entering those settings or mutating production.
