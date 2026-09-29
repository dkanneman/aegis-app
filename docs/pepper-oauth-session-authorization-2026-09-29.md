# OAuth initiating-session repair

## Scope and root cause

Local-only continuation of the 70-file restoration candidate, base
`d555fee1c4b5a9ade0d48c4d64b2fcd064207406`, patch
`755fb98379578baf9998f295bbd6df47fa60911c5d1beb82a0be0f083da52819`.
No real provider, production, deployment, commit or push is involved.

Fresh reproduction against the original staged handler: start OAuth, revoke the
initiating session, submit its callback. The provider double counted one token
exchange and the callback returned `oauth_exchange_failed`. The security test
failed as intended; a revoked initiator should never reach exchange.

OAuth state previously carried only member and household identity. It now also
stores the existing stable `member_sessions.session_id`, never the bearer token.
Migration `20260929173234_bind_calendar_oauth_initiator_session.sql` adds that
nullable foreign key and its index. Existing states are deliberately not backfilled:
unbound states fail closed and require a fresh start. Session deletion nulls the
binding; another session for the same adult cannot substitute for it.

The real callback atomically consumes the state once, then rechecks the exact
session, member and household, active/not-removed membership, adult role,
revocation and current expiry before token exchange. It repeats the check before
pending connection persistence and before activation/token/audit persistence.
Shared row locks serialize protected operations with session revocation/member
changes. A revocation already committed is rejected; a concurrent revocation
waits for an already-authorized protected operation to finish. No claim is made
that an in-flight remote request can be retroactively canceled. Provider calls
retain their 20-second timeout. Expiry is checked using the database clock after
lock acquisition, and again after calendar creation before its pending write.

PKCE, nonce, state expiry, atomic single use, redirect restrictions, exact narrow
scopes, installation marker, identity and probe/JSONB checks are unchanged.
CalendarList is not used. Mid-probe revocation prevents activation and token/audit
success; the newly created calendar follows the existing failure cleanup path.

## Verification and reproducibility

The staged-only export and sanitized evidence are outside the repository at
this chat's visualization workspace, `pepper-auth-repair/`. Its fingerprint JSON
contains the final patch hash; this document avoids a self-referential hash.

`PEPPER_LOCAL_GATE_SLOT=auth-repair` selects loopback 54339 and a separate internal
Docker network/worker. The existing preview on 4189/54329 is not stopped. The
authorization entrypoint is a test-only wrapper, not imported by production code.
It runs the real callback and PostgreSQL, generates an ephemeral RSA key, signs
dummy OIDC claims, and doubles provider HTTP responses. All actual external fetches
are blocked, with Docker internal networking as a second boundary. The configured
dummy redirect remains the reviewed 54329 callback; tests directly submit to the
separate 54339 worker and never follow a provider authorization URL.

Required checks are recorded in `endpoints.json`, `checks.json`, `migration.json`,
`lint-triage.json` and `preview.json` with detailed output alongside them.
The full fast suite requires a built `dist/server/index.js`; run the build before
the final full-suite pass. Database tests are separate mandatory gates, not skipped
tests in the fast suite.

Regression coverage includes revoked (despite another active session), deleted,
expired, inactive/removed, child-role, wrong-member, wrong-household and unbound
initiators; duplicate callback consumption; valid signed-identity/probe activation;
revocation after exchange before calendar creation; and revocation during the
probe before activation. Rejections before exchange preserve connection/token/
audit counts. Synthetic success audit history is retained, not erased for hashes.

Fresh production-shaped replay uses the reviewed version mappings and excludes
Gmail and the sandbox-only migration. It applies 56 migrations. Local `pg_cron`
is installed as the documented lint prerequisite; no job is enabled. OAuth-state
RLS remains enabled and anon/authenticated table privileges remain false.

Final local results: authorization HTTP/database 11/11; existing OAuth
HTTP/database 14/14; focused fast suite 104/104; full fast suite 203/203; zero
skipped tests. TypeScript, strict focused ESLint, timeout-bounded production build,
artifact validation and both Git whitespace checks pass. Fresh database lint and
security/performance advisors return empty warning/error result sets. Parent
(1440px) and child (390px) preview logins, Today, chores, meals and groceries pass
with no page errors or external requests. The browser harness must wait for client
hydration before filling the form; its first premature fill timed out and was not
counted as a successful smoke check.

New migration SHA-256:
`26a5365e826d8cc911f0fa07305d45a0654fee83d08ae6cebbc527256e6ba60b`.
Rollback SHA-256:
`0d07286e2f7d2b4c587f0c858a0478aac69b672a05477854d821fc5ef8449919`.
Baseline and restored schema hash:
`c0d5d776b3c624c256c3e316dc594a56018b22a3e04374f5f07e85902fcafbb9`.
Baseline and restored deterministic table-data hash:
`2c95b3767296bb7e40e7877d8261cfd396e79819119abeecc6b6e944c0379ed1`.
Reapplication and guarded replay match their post-apply hashes. These are the
new migration's local hashes, not proof of exact whole-release rollback.

Verdict: READY for a separately authorized external sandbox evidence run;
NOT approved for deployment or a controlled household beta. The working local
preview remains available at http://127.0.0.1:4189/pepper with its existing
synthetic parent/child access. It intentionally does not expose a real OAuth path.

## Lint triage

| Three existing server handlers | Errors | Warnings |
| --- | ---: | ---: |
| Base commit | 186 | 1 |
| Starting 70-file candidate | 203 | 2 |
| This repair | 203 | 2 |

The family API contains 183 explicit-any findings and one unused `_headers`
warning. The older family-beta handler contains 18 explicit-any findings, two
prefer-const findings and one unused-variable warning. Tell-v2 has none. Compared
with base, the earlier candidate adds a net 17 explicit-any errors and one warning.
Source-line/rule/message multiset comparison identifies 35 added or changed
findings and 17 removed/replaced findings; line shifts alone are not counted.
This repair introduces zero findings. Strict focused lint, including the Calendar
handler and new harness/tests, is required to pass without suppressions.

Explicit-any debt weakens compile-time protection in parsing, authorization and
mutation code; runtime authorization/HTTP/database tests provide direct evidence
but do not eliminate that debt. Prefer-const and unused variables are maintainability
findings, not demonstrated access-control failures. No sweeping cleanup or lint
waiver is included. These findings alone do not block an isolated evidence-only
sandbox run; they remain an explicit review item before a family beta deployment.

## Rollback contract

There are two distinct contracts, not interchangeable claims:

1. This additive migration has an exact local rollback before any bound state
   exists. `calendar_oauth_initiator_rollback.sql` refuses outstanding bindings.
   Rehearsal compares schema and deterministic public/private table-data hashes,
   then reapplies and replays the migration. Audit rows are not deleted.
2. Whole-release rollback is compensating operational recovery, not byte-identical
   restoration. Prior rehearsal differences of six task-ledger rows, twenty
   state-change rows, three responsibility timestamps and sequence advancement
   are consistent with preserved audit history. They meet a compensating-history
   contract, NOT an exact full-database restoration contract. They must not be
   removed merely to make hashes match. This repair does not claim a new complete
   whole-release rollback rehearsal.

For later production recovery: stop intake/schedulers/writers first, preserve
delivery/audit evidence, reconcile any remote writes by recorded immutable IDs,
and use reviewed compensation or a separately approved backup/PITR restoration
with post-backup-write reconciliation. Do not revert to the vulnerable callback;
disable connection setup if no secure compatible runtime is available. Retain the
additive session-binding schema during operational recovery. Recurring-chore
rollback still refuses after successor occurrences exist, requiring reconciliation.
These limitations do not block disposable sandbox evidence, but an approved
production recovery procedure and backup capability remain deployment gates.

## Next separately authorized tests

1. Recompute the final base, staged count/hash and config blob. Reconstruct only
   the index; preserve Gmail and the unrelated CSS overlap. Keep this local preview
   private. Do not use its dummy provider wrapper for external evidence.
2. In a separate sandbox runtime with synthetic household identities, request only
   `openid`, `email`, `https://www.googleapis.com/auth/calendar.app.created`.
   Real OAuth requires new explicit authorization. Do not read Gmail, adopt any
   existing calendar, or use production AEGIS. Keep the return page running.
3. Test a revoked initiating Pepper session at callback: no provider exchange,
   calendar creation, connection or success record. Then use a fresh authorized
   adult session and create exactly one app-owned `Pepper Sandbox`; record IDs,
   installation/identity fingerprints and granted scopes immediately. Validate
   via Calendars.get and complete the activation probe/JSONB persistence.
4. Test Danielle and Matt in separate sessions/devices, child proposal isolation,
   one `[PEPPER TEST]` event, revision-aware updates, stale/simultaneous 409s,
   idempotent retry, cancellation and shared readback. No attendees/invitations or
   personal-calendar delivery. AEGIS remains excluded unless separately authorized.
5. Cleanup by exact recorded IDs, never title. Verify probe/event deletion by
   404/410 or matching non-recurring canceled tombstone. Delete only the new
   calendar; poll Calendars.get with bounded backoff to 404/410 before revoking
   sandbox OAuth (or record bounded cleanup failure first). Clear only run-owned
   tokens/state and stop disposable services; preserve sanitized evidence.

Physical-device gates remain: iPhone viewport/keyboard/safe areas, native callback
return, parent/child session isolation, sleep/resume, intermittent connectivity,
and two-device shared revisions. Desktop local tests are not physical-device proof.
Google/AEGIS delivery and the controlled household beta are not approved by local
verification. New sandbox evidence must refer to the new fingerprint.
