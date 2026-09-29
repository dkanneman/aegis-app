# Calendar OAuth canonical schema repair

## Cause and contract

Commit `44c91d0a06817329bb63e51b6cd35bed037f3cd6` added the
`return_target` runtime dependency and its DDL together, but placed the DDL in
`supabase/preview/20260903152000_harden_testflight_auth_and_oauth_return.sql`.
Canonical bootstrap does not execute preview files. Existing fast tests checked
source contracts and Calendar logic without executing OAuth start against a
fresh canonical database, so they did not detect this missing column.

The client emits `web` or `pepper_ios`; the family API forwards the value.
`beginOAuth` preserves only exact `pepper_ios` and normalizes every other value,
including missing, null, malformed and external URLs, to `web`. The database
column is text, NOT NULL, default `web`, constrained to those two values.
Callback redirects only to the configured application URL or `pepper://oauth`.
No request-provided URL becomes a redirect destination.

Forward migration `20260928230029` follows household authorization migration
`20260917211929`. Existing rows receive `web` without changing their ID, verifier,
member, household, timestamps or consumption state. A preview-installed column
and valid native values are preserved. Incompatible values fail reconciliation
instead of being silently replaced. No historical migration is edited.

Private-schema grants, RLS, ten-minute state expiry, PKCE and single-use atomic
state consumption are unchanged. No OAuth scope or Calendar guard changes.

## Fixture and evidence boundary

The synthetic legacy Calendar fixture is disconnected with sync status `never`.
It has no installation/probe proof and must not claim to be active. The rehearsal
verification's successful and unsuccessful probe objects are explicitly local
test doubles, not externally verified Google evidence.

`calendar_oauth_local_worker.mjs` imports the actual handler unchanged and uses
the pinned real PostgreSQL driver. It forces dummy OAuth configuration, replaces
provider fetch with a labeled token-failure double, and denies all other fetches.
Run it only in a disposable internal Docker network with the local database.
Never deploy this wrapper. Never supply real tokens or credentials to it.

## Mandatory preflight before external testing

The reproducible offline launcher is `supabase/tests/calendar_oauth_local_launcher.mjs`.
Use a clean staged-only export named `pepper-oauth-local-gate` and its synthetic
local database. Start the database with the cached Supabase CLI, load only the
rehearsal fixtures, and supply the verified `postgres-3.4.7` tarball (SHA-512 is
enforced by the launcher). It performs no downloads and accepts only a local
Docker socket and the specifically named disposable database. The harness
directory must be new, outside the export, and visible to Colima bind mounts.

```sh
node supabase/tests/calendar_oauth_local_launcher.mjs start /absolute/disposable-harness /absolute/postgres-3.4.7-verified.tgz
PEPPER_TEST_CALENDAR_URL=http://127.0.0.1:54329/functions/v1/pepper-calendar/ \
PEPPER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
PSQL_BIN=/absolute/disposable-harness/psql-local \
node --test supabase/tests/calendar_oauth_database.test.mjs
node supabase/tests/calendar_oauth_local_launcher.mjs stop /absolute/disposable-harness
```

The launcher injects/asserts dummy environment values because main-worker
`Deno.env.set` is unsupported. It supplies standard Node globals for the pinned
driver, bundles unchanged staged modules within one root, starts on an internal
Docker network, and requires a successful local OPTIONS response before tests.
An exact-destination loopback tunnel over the local Docker socket exposes only
that worker's port 9000; no egress-capable Docker network is attached. Stopping
the launcher verifies and terminates the recorded tunnel process as well.
The callback is `/functions/v1/pepper-calendar/callback`, matching the unchanged
production redirect guard. No provider authorization URL is visited.
After stopping the launcher, stop the named disposable Supabase stack with
`--no-backup`; never use `--all`. A failed launch must still be cleaned up.

1. Reconstruct the exact staged-only candidate and apply canonical migrations.
2. Load the synthetic rehearsal fixtures into the disposable local database.
3. Start the local-only worker with the real cached `postgres@3.4.7` dependency;
   allow no external runtime network. Database host must be `127.0.0.1`,
   `localhost`, or the explicit disposable alias `pepper-oauth-db`.
4. Set `PEPPER_TEST_CALENDAR_URL` to its loopback endpoint and
   `PEPPER_TEST_DATABASE_URL` to the disposable loopback PostgreSQL URL.
   `PSQL_BIN` may point to a local-only Docker psql adapter.
5. Run `node --test supabase/tests/calendar_oauth_database.test.mjs`.
   This is a required separate gate, not an optional/skipped fast-suite test.
   It must fail on the old schema and pass after the forward migration.
6. Run `calendar_oauth_schema_verify.sql`, the probe tests, household policy and
   real two-process revision tests, full suite, types, focused lint, direct
   build, artifact checks, database lint/advisors and whitespace checks.
7. Tear down only this rehearsal's containers, data and dummy runtime files.

If the pinned runtime dependency is unavailable offline, record the endpoint
gate as BLOCKED, not passed. SQL or source-text tests are not substitutes.

## Rollback

Production rollback retains the additive compatibility column and restores the
prior runtime. Do not remove an already-installed preview column or lose native
return targets. No production action is authorized by this document.

For a proven absent-column disposable baseline only, set session setting
`pepper.rehearsal_created_return_target` to `true`, then execute
`supabase/tests/calendar_oauth_return_target_rollback.sql`. It refuses rollback
if any native target would be discarded. This runs first in the pending-release
rollback. Compare schema/data hashes before apply and after rollback, then
reapply and guarded-replay the migration. The marker is a local test assertion,
not production authorization. Existing `pepper_ios` states require retaining the
column or a separately reviewed backup/restoration procedure.

## Additional inspection

The Calendar OAuth path's session/member, connection proof, private token,
Vault, audit and sync-run dependencies are defined in the canonical chain.
The callback binds to the member/household captured at start; it does not perform
a new membership/session-revocation check after state consumption. This is
pre-existing behavior, not changed in this schema repair, and should be reviewed
separately before claiming revocation-during-OAuth coverage.
