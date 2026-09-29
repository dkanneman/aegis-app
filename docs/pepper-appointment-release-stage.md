# Pepper Appointment Repair Release Stage

Date: 2026-09-17
Live beta project: `mfgyeolvfthxacrqwwtc` (not modified)

## Verdict

**LOCAL DATABASE REMEDIATION VERIFIED; NOT READY for another external attempt.** The second app-created-calendar attempt proved the narrow OAuth, calendar creation, metadata, and complete probe lifecycle against Google's real API. Activation then failed closed because the Postgres.js parameter stored `JSON.stringify(probeEvidence)` as a JSON string instead of a JSON object. The binding is repaired and the disposable database rehearsal passes, but the staged-only full suite still exposes one pre-existing release-boundary failure: `tests/family-slice-contract.test.mjs` requires `supabase/config.toml`, while the only working-tree copy mixes the required Apple Health setting with unrelated, unfinished Gmail configuration. Gmail configuration was not staged merely to force a green result.

This is not authorization to deploy. The staged external writers remain intentionally locked to `Pepper Sandbox` and `Pepper Appointment Tests`. Live beta deployment still requires a separate production-destination implementation/configuration review and Danielle's explicit approval.

No commit, push, production migration, Vercel deployment, TestFlight upload, live Calendar write, Gmail access, primary/shared-calendar access, or production AEGIS write occurred.

## Staged Boundary

Exactly 38 appointment-release files are staged in the current local candidate. Unrelated working-tree changes remain unstaged and untouched.

- Pepper UI and appointment actions
- strict appointment parsing and medical scheduling helpers
- Calendar, bridge, family API, and intake Edge Functions
- four migrations, including fail-closed AEGIS delivery
- migration preflight and rollback SQL
- appointment, calendar, AEGIS, and day-planning tests
- this evidence report

## Root Causes And Repairs

- Explicit appointment values could be overwritten by ingestion defaults. Parsing now gives source date, time, meridiem, and timezone first precedence.
- Ambiguous inputs could silently receive fallback values. They now remain `needs_review` with original text and an exact unresolved-field explanation.
- Published edits did not reliably update the existing Google event. Updates now use the stored calendar and event IDs, preserving external identity.
- Stale IDs could lead to duplicate risk. Pepper reconciles by deterministic ID/private property and never creates a replacement during an update.
- A Google PATCH to an externally deleted event can return HTTP 200 with `status=cancelled`. Pepper now checks semantic status and reports `retry_required` instead of falsely reporting success.
- The family API previously trusted Google's status alone after bridge delivery. It now reports `synced` only when Google and AEGIS are both verified; partial states expose destination-specific status.
- Google OAuth now requests only `openid`, `email`, and `https://www.googleapis.com/auth/calendar.app.created`. Pepper must create and store its own calendar; the new flow is locally verified but still externally unverified.
- Connection-probe deletion previously expected `Events.get` to return only 404/410. Google can instead return HTTP 200 with a retained `status=cancelled` tombstone. Probe cleanup now accepts that response only when the requested calendar ID and deterministic event ID match exactly and the event is not a recurring exception.
- Calendar activation passed a validated probe object through `JSON.stringify(...)`, causing Postgres.js to encode it as a JSON string. Activation now uses the driver's transaction `.json(...)` helper so PostgreSQL receives a JSON object.
- The database rehearsal exposed a second fail-closed defect: PostgreSQL accepts a `CHECK` expression that evaluates to `NULL`, so the active-probe constraint needed explicit `calendar_probe_evidence is not null` and `jsonb_typeof(...)='object'` clauses. The constraint now rejects null, scalar, array, stringified, malformed, and incomplete evidence instead of relying on JSON containment alone.
- The previous 36-file candidate was not reproducible from its staged patch alone: one staged day-plan test imported an unstaged Gmail worker, while two appointment expectations and the family-API version expectation existed only as unstaged test edits. Gmail assertions were removed from the appointment release, and only the required appointment/version test updates are included in the repaired boundary.
- Retry constraints/RPCs disagreed with runtime states. The migration aligns retry, reconnect, ledger, and attempt-count behavior.
- Medical coordination was too easily promoted to P0. It is now P0 only when imminent and unresolved, P1 for future coordination, and P2 for routine preparation.
- Canceling an appointment left linked coordination tasks active. Cancellation now closes those tasks and propagates to external destinations.

## Sandbox Inventory

| Boundary | Verified configuration |
| --- | --- |
| Supabase | Isolated localhost project `pepper-appointment-sandbox-20260916`; Edge Runtime 1.74.3 / Deno 2.1.4; PostgreSQL 17.6 |
| Google identity | Danielle's existing account, Calendar-only OAuth |
| Google scope | Historical run: `https://www.googleapis.com/auth/calendar.events`; not evidence for the new app-created scope |
| OAuth callback | `http://127.0.0.1:54321/functions/v1/pepper-calendar/callback` |
| Calendar | Historical run used a manually created `Pepper Sandbox`; the revised candidate must create a new sandbox calendar itself and has not yet been externally retested |
| AEGIS workbook | `AEGIS HOME - PEPPER SANDBOX - 2026-09-16`, spreadsheet `1YkDlsRzNoLZtVMpV1vbPSRE3VLZ1Hae8p-LYMP7-Q7U` |
| AEGIS tab | `Pepper Appointment Tests`, sheet ID `640122929`, exact 19-column schema |
| Sheets writer | Dedicated service account with Editor access only to the sandbox workbook |
| Production AEGIS | Spreadsheet `10v670z9ajMof7lR2mngmGbD4zwnDMjuAYzX8cG_C7y4` hard-rejected and never accessed |

The Calendar allowlist rejects `primary`, the authenticated account's exact email identifier, missing IDs or metadata, and every nonconfigured ID. An email-shaped app-created ID is allowed only when `Calendars.get` returns the exact stored ID, mode-specific title, installation marker, and matching `dataOwner`, and the current OIDC identity still matches the stored proof. CalendarList is not called. Activation also requires a private deterministic `[PEPPER CONNECTION TEST]` create/read/delete/absence probe. Absence means 404, 410, or an exact HTTP 200 non-recurring canceled tombstone from the exact stored calendar; confirmed, tentative, malformed, mismatched, recurring-exception, authorization, rate-limit, and server responses fail closed. Calendar writes use `sendUpdates=none`, contain no guests, and use the `[PEPPER TEST]` prefix. AEGIS writes accept only the exact sandbox workbook/tab and require an exact readback before `synced`.

## Migration Evidence

The sanitized preview preflight reported:

| Check | Result |
| --- | ---: |
| Duplicate active appointment dedupe keys | 0 |
| Malformed appointment timestamps | 0 |
| Invalid appointment types | 0 |
| Orphaned bridge-delivery records | 0 |
| Representative appointments | 7 |
| Existing Google event identifiers | 6 |

- No duplicate was deleted automatically.
- All four staged migrations applied in the isolated environment.
- Backfill produced P0=1, P1=3, and P2=1 for five captured coordination rows.
- Rollback correctly refused while a retry-required ledger row was unresolved.
- After resolving the synthetic guard, rollback restored the exact task data hash `9a22311898eef328810acffc518a679d`.
- The migrations reapplied successfully after rollback.
- Local database lint passed with zero findings once the migration's pg_cron dependency was enabled.

## External Lifecycle Evidence

All operations used the same local public Pepper API path as the app.

The first external attempt using `calendar.app.created` completed consent, identity validation, app-owned `Pepper Sandbox` creation, probe creation, and initial probe readback. Google accepted the probe deletion, then `Events.get` returned its canceled tombstone. The pre-repair candidate rejected that valid tombstone, kept the connection inactive, and cleaned up safely.

The second attempt used the tombstone repair and completed consent, OIDC identity verification, app-owned calendar creation, exact metadata validation, probe create/read/delete, and absence verification. The activation transaction then failed `calendar_connections_active_probe_check` because `calendar_probe_evidence` was a JSON string rather than an object. Pepper stayed inactive, returned `oauth_failed`, created no appointment, bridge delivery, AEGIS row, or audit success, deleted only the newly created calendar, revoked the grant, and removed disposable state. This was a persistence defect, not a Google Calendar or scope failure.

The clean staged-only verification procedure reconstructs a disposable worktree from base `d555fee1c4b5a9ade0d48c4d64b2fcd064207406`, applies only the staged binary patch, installs no unstaged source, and runs the focused/full tests, TypeScript, strict focused ESLint, production build, artifact validation, reconciled migration apply/rollback/reapply/replay, database lint/advisors, and both whitespace checks there. The procedure currently stops the release gate at the missing tracked `supabase/config.toml`; the untracked copy is not a permitted dependency and contains unrelated Gmail configuration that remains excluded.

### Records

| Appointment | Pepper capture | Pepper event | Google event | AEGIS record |
| --- | --- | --- | --- | --- |
| MyChart doctor | `7ecb517a-06d2-4bb7-924b-3b68080b8c50` | `ef6dc8eb-acff-5f17-ae55-56fdaba232db` | `pepperef6dc8ebacff5f17ae5556fdaba232db` | `pepper-event:ef6dc8eb-acff-5f17-ae55-56fdaba232db` |
| Physical therapy | `52b360c8-c4e0-4366-a8e6-3dd769a97c89` | `5c0afe45-eff8-5961-a2a6-1a17e9306fd5` | `pepper5c0afe45eff85961a2a61a17e9306fd5` | `pepper-event:5c0afe45-eff8-5961-a2a6-1a17e9306fd5` |
| Ambiguous doctor text | `036fb56b-6aa2-4adc-b304-a84adabc3f64` | none | none | none |

### Results

| Case | Verified result |
| --- | --- |
| `09/19 at 1:45 PM PDT with Karin Eshagh, MD` | Preserved raw text; initially normalized to `2026-09-19T13:45:00-07:00`; one Pepper event, one Google event, one AEGIS row |
| `Oct 1st at 8am at Two Trees Physical Therapy` | `2026-10-01T08:00:00-07:00`, `physical_therapy`, one record per destination |
| `doctor next Thursday afternoon` | `needs_review`; no canonical appointment or external write; reason says no time could be resolved |
| Reschedule/provider/location/preparation | Same Pepper and Google IDs survived; Google PATCH and AEGIS deterministic-row update read back current canonical data |
| Replay | Same capture/event/ledger/Google/AEGIS IDs; duplicate counts stayed 1 |
| AEGIS permission failure | Pepper+Google succeeded; AEGIS `reconnect_required`; public result `partial_reconnect_required`; retry recovered without duplicates |
| Google authorization failure | Pepper+AEGIS succeeded; Google `needs_reconnect`; public result `reconnect_required`; verified OAuth path restored delivery |
| Transient Google failure | Pepper+AEGIS succeeded; Google `retry_required`; retry returned both destinations to `synced` |
| Stale Google ID | Reconciled to `pepper5c0afe45eff85961a2a61a17e9306fd5`; audit recorded reconciliation; no replacement created |
| Deleted outside Pepper | Returned `partial_retry_required`; audit states Pepper did not create a replacement; explicit test reconciliation restored the same ID |
| Cancel | Pepper status `canceled`, Google status `cancelled`, AEGIS row status `canceled`; IDs remained stable |
| Undo after later edits | HTTP 409 conflict-safe stop: `Someone changed this item after Pepper handled it, so Undo was stopped.` |

Final pre-cleanup duplicate counts were one per Pepper dedupe key, one Google match per Pepper event ID, one AEGIS row per deterministic record ID, and one bridge-ledger row per event.

Ledger transitions observed:

- `synced / synced -> synced`
- `reconnect_required / synced -> partial_reconnect_required`
- `synced / needs_reconnect -> partial_reconnect_required`
- `synced / retry_required -> partial_retry_required`
- retry after each partial state -> `synced / synced -> synced`

## Cleanup Evidence

- Calendar cleanup targeted only the two Google event IDs listed above; no other event was addressed.
- AEGIS cleanup cleared only rows 2 and 3 containing the two deterministic record IDs.
- Independent post-cleanup Sheets readback found `0` matching synthetic rows.
- The sandbox OAuth refresh token was revoked.
- The isolated `calendar_connections` count is `0` after disconnect.
- No copied AEGIS tab was cleared, deleted, anonymized, or restructured.

The cleanup harness completed both external deletions and token revocation, then hit a local empty-output JSON parsing error while deleting the already-disconnected local connection row. The ignored harness was corrected; independent readback confirmed cleanup state. This did not affect product code or staged files.

## Automated Checks

- Clean staged-only full repository tests: **171/172 passed**; the sole failure is the missing tracked `supabase/config.toml` contract described above.
- Focused appointment/calendar/AEGIS/day-plan/readiness tests: **79/79 passed**.
- TypeScript `--noEmit`: passed.
- Production Vinext build: passed.
- Artifact validation: passed.
- Supabase database lint: passed with zero schema errors; advisors reported informational synthetic-foundation findings only and no Error, Critical, or High issue.
- Focused ESLint for the changed pure logic and regression test: passed.
- Staged and unstaged diff checks: passed for whitespace. The final candidate fingerprint must be recomputed after this documentation update.
- Broad repository ESLint is not green: it scans the ignored local sandbox copy and reports longstanding `no-explicit-any` debt across legacy Edge Functions. No new focused lint finding was introduced by this release.

## Next External Sandbox Attempt

Do not begin another external attempt until the staged-only `supabase/config.toml` boundary is resolved without including unfinished Gmail work and the full clean suite reaches zero failures.

1. Start the isolated Supabase functions and keep the local Pepper return page running until the OAuth redirect finishes.
2. Treat the callback result and the return-page render as separate evidence. A callback may complete even if the local UI cannot render; record both outcomes.
3. Immediately after `Calendars.insert`, record the sanitized calendar ID, installation-marker fingerprint, and deterministic probe event ID before any fail-safe cleanup. Never record OAuth codes, tokens, client secrets, service credentials, or unredacted account identifiers.
4. Confirm initial probe readback still requires the complete private probe payload, exact event ID, exact stored calendar ID, installation marker, and no guests.
5. After deletion, accept only 404, 410, or HTTP 200 with the matching event ID, `status=cancelled`, and neither `recurringEventId` nor `originalStartTime` from the exact stored calendar request.
6. Confirm the activation transaction reads back `calendar_probe_evidence` as `jsonb_typeof(...)='object'` with all required boolean fields before reporting connected.
7. Keep ordinary appointment cancellation on its reviewed stored-ID DELETE path. The probe tombstone helper is not reused there because this remediation does not change appointment-cancellation or recurring-event behavior.
8. Run the complete create/update/reschedule/replay/failure/cancel lifecycle only after the connection probe activates successfully.
9. During final cleanup, delete only the app-created sandbox calendar from that run, remove only its labeled synthetic AEGIS rows, verify absence, revoke the sandbox OAuth grant, remove local token state, and stop disposable services.

The OAuth scope set remains exactly `openid email https://www.googleapis.com/auth/calendar.app.created`. No CalendarList, Gmail, Contacts, Drive, broad Calendar, or Calendar readonly permission is allowed.

## Remaining Limitations

- The staged Google and AEGIS writers are deliberately sandbox-locked. They must not be pointed at live destinations by changing secrets alone.
- Production destination policy, credentials, RLS/service-role checks, and rollback execution must be reviewed in the live project before migration.
- The repository's historical clean-start migration order still needs a separate baseline repair; the release migrations themselves passed isolated apply/rollback/reapply verification.
- Google event deletion is represented by Google's retained `cancelled` tombstone. Pepper now detects that state and requires explicit reconciliation rather than silently resurrecting or replacing it.
- Existing broad Edge Function lint debt remains outside this appointment repair.

## Later Production Sequence

Do not begin this sequence without a separate explicit approval.

1. Commit and push only the verified 36-file release after reviewing the staged diff and completing the required external sandbox retest.
2. Create a fresh backup and run the preflight SQL against the live Pepper project; stop on duplicates, malformed timestamps, invalid types, or orphaned ledger rows.
3. Complete a fresh real sandbox lifecycle for Pepper-created Calendar setup under `calendar.app.created`, then review the stored production destination and AEGIS production adapter. Never reuse sandbox flags or `[PEPPER TEST]` data for live writes.
4. Configure live secrets through the platform secret store, including `AEGIS_GOOGLE_SERVICE_ACCOUNT_JSON`; never copy secret values into source or chat.
5. Map production `20260915203426` and `20260915203431` to the two already-applied logical migrations without reapplying them, then apply `20260916120000` followed by `20260916150000`. Exclude sandbox-only `20260916143000`.
6. Deploy `pepper-calendar`, then `aegis-bridge-worker`, then `pepper-tell-v2`, then `pepper-family-api`.
7. Reconnect the approved production account with exactly `openid email calendar.app.created`; verify Pepper creates `Pepper Family`, stores its returned ID and creation proof, revalidates it with `Calendars.get`, and completes the reversible connection probe before the first appointment write.
8. Run one labeled canary appointment through create, update, replay, and cancel; verify Pepper, Google, AEGIS, ledger, and audit before widening access.
9. Deploy the web beta only after canary evidence is clean; build/upload a new TestFlight version afterward.
10. Roll back functions first and run `appointment_release_rollback.sql` only if its safety guards pass.

## Manual Approval Gate

The single next authorization must explicitly approve **production-destination preparation**. It must not be treated as approval to migrate, deploy, write to live Google Calendar, write to production AEGIS, push GitHub, or upload TestFlight.
