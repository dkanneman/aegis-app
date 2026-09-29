# Pepper Appointment Release: Local Migration Rehearsal

Date: 2026-09-16

> Superseded for future rehearsals on 2026-09-18: the synthetic production-shaped foundation described below has been retired. Fresh and production-shaped verification now replay the canonical migration chain, including the seed-free schema reconstruction at production ledger version `20260814230412`. Historical results remain below for audit provenance only.

Scope: disposable local Supabase/PostgreSQL only, using synthetic `[PEPPER TEST]` data. No hosted Supabase project, production credential, Google Calendar, AEGIS workbook, Vercel deployment, Git remote, or OAuth connection was accessed or changed.

Verdict: **READY for a fresh external sandbox attempt.** This is not approval to configure or mutate production.

## Toolchain

| Tool | Version | Installation or source |
| --- | --- | --- |
| Homebrew | 7.0.3 | Existing local installation |
| Colima | 0.10.3 | Existing local installation |
| Docker client/server | 29.8.1 / 29.5.2 | Existing Colima Docker runtime |
| Supabase CLI | 2.117.0 | Official `supabase/tap/supabase` Homebrew formula |
| PostgreSQL client | 18.6 | Homebrew `libpq` formula |
| Node.js | 24.19.0 | Bundled Codex workspace runtime |

The CLI ran with `HOME=/private/tmp/pepper-supabase-home` and telemetry disabled, so existing Supabase profiles and credentials were not visible to the rehearsal. Docker used the local Colima socket. Commands and flags were checked with the installed CLI's `--help` before use.

Official references consulted before installation and execution:

- <https://supabase.com/changelog?types=breaking-change>
- <https://supabase.com/docs/guides/local-development/cli/getting-started>
- <https://supabase.com/docs/guides/local-development/cli-workflows>
- <https://github.com/supabase/cli/releases>

## Reconciled Baseline

The latest disposable project was `/private/tmp/pepper-calendar-guard-rehearsal.rCtj3X`. Its clean baseline contained only:

| Local rehearsal version | Meaning |
| --- | --- |
| `20260915000000` | Historical synthetic production-shaped test foundation; retired on 2026-09-18 |
| `20260915203426` | Production-applied equivalent of local `20260915164500_harden_appointment_intake_and_bridge.sql` |
| `20260915203431` | Production-applied equivalent of local `20260915175808_prioritize_daily_plan_tasks.sql` |

The rehearsal then applied, in order:

1. `20260916120000_sync_published_appointments.sql`
2. `20260916150000_production_appointment_delivery.sql`

`20260915164500`, `20260915175808`, and sandbox-only `20260916143000` never appeared in the local migration ledger.

Synthetic baseline counts were 1 household, 2 members, 7 captures, 7 appointments, 4 tasks, and 2 bridge deliveries. Fixtures covered published and unpublished appointments, completed and incomplete delivery states, retry state, a stale synthetic Google ID, all six medical appointment types, and duplicate-prevention paths.

Preflight findings:

- Duplicate appointment dedupe keys: 0
- Malformed timestamps: 0
- Invalid appointment types: 0
- Orphaned bridge deliveries: 0
- Calendar retry jobs without configuration: 0
- Calendar Vault secrets: 0
- Required mapped-baseline columns present: 22/22

## Apply, Rollback, Reapply, Replay

| Check | Result |
| --- | --- |
| Dry-run pending set | Exactly `20260916120000`, then `20260916150000` |
| Clean apply | PASS |
| Post-apply structural and behavior assertions | PASS |
| Exact rollback | PASS after repairing two defects described below |
| Reapply after local ledger reconciliation | PASS |
| Second guarded application | PASS; zero duplicate objects and zero row changes |
| Missing Calendar Vault configuration | Failed closed; no cron job created |
| Browser-role access to private release tables | Denied |
| Retry/replay duplicate delivery count | 0 |

Final accepted hashes:

| State | Schema SHA-256 | Synthetic-data SHA-256 |
| --- | --- | --- |
| Reconciled baseline | `d0f2bcf1e156087956eeea7d75143d3db7dd801d0bc7c42ee3eee65c502faf83` | `718a06438ef7157e5d399d3cf1b42e9e4c3743d9faac26c03478c63a754f44ca` |
| After exact rollback | `d0f2bcf1e156087956eeea7d75143d3db7dd801d0bc7c42ee3eee65c502faf83` | `718a06438ef7157e5d399d3cf1b42e9e4c3743d9faac26c03478c63a754f44ca` |
| Applied release | `449d68feb66136a62190d426a2766cbf6d655b110a219514c9ad5bf4662db08b` | `a1d13441fb2b533a4184eb86c21f2688fdbc4f63456281b7cfba0eec6713286a` |
| After guarded replay | `449d68feb66136a62190d426a2766cbf6d655b110a219514c9ad5bf4662db08b` | `a1d13441fb2b533a4184eb86c21f2688fdbc4f63456281b7cfba0eec6713286a` |

## Defects Found and Repaired

1. The functional rollback restored task fields while the new medical-priority trigger was still active. The trigger recalculated and overwrote the backed-up values. The rollback now drops that trigger before restoring task rows.
2. Replaying the sync migration rewrote `calendar_connections.updated_at` even when the required reconnect state was already identical. The update now uses `IS DISTINCT FROM` guards and affects zero rows on replay.
3. Calendar connection state had no exact rollback backup. The migration now captures status, sync status, error, and timestamp in a private browser-inaccessible backup table, and rollback restores them.
4. The test-only exact rollback recreated the prior bridge RPC with equivalent behavior but different stored source text, preventing an exact schema hash match. It now restores the original function definition exactly.
5. A full replay of all historical repository migrations originally failed before the appointment baseline at `20260814230550_pepper_verify_family_pin.sql`, which referenced `household_members.pin_hash` before the safe repository history restored the seed-bearing production migration's schema. The 2026-09-18 repair adds a seed-free reconstruction at the already-applied production ledger version and retires the synthetic foundation for future runs.
6. The exact narrow Google grant does not authorize `CalendarList.get`. The Calendar guard now uses only the app-created calendar's immutable stored ID, installation marker, `dataOwner`, current OIDC identity, runtime mode, and `Calendars.get`, followed by a reversible direct event create/read/delete/absence probe before activation.

Changed by this rehearsal:

- `supabase/migrations/20260916120000_sync_published_appointments.sql`
- `supabase/tests/appointment_release_production_rollback.sql`
- `supabase/tests/appointment_release_pending_rollback.sql`
- The former `supabase/tests/appointment_release_rehearsal_foundation.sql` was removed on 2026-09-18; future rehearsals use the canonical migration chain.
- `supabase/tests/appointment_release_rehearsal_fixtures.sql`
- `supabase/tests/appointment_release_rehearsal_verify.sql`
- `supabase/tests/appointment_release_rehearsal_hash.sql`
- `tests/pepper-production-readiness.test.mjs`

## Verification Results

| Verification | Result |
| --- | --- |
| Focused appointment tests | 78/78 passed |
| Full repository tests | 193/193 passed |
| TypeScript | PASS |
| Strict focused ESLint | PASS |
| Production build | PASS |
| Artifact validation | PASS |
| Supabase database lint | PASS, no schema errors |
| Supabase advisors | No Error, Critical, or High findings; informational synthetic-foundation notices only |
| Unstaged Git whitespace check | Recorded separately after final staging |
| Staged Git whitespace check | Recorded separately after final staging |

A broader staged-file ESLint invocation returned 177 existing `no-explicit-any` errors and one existing unused-variable warning in `supabase/functions/pepper-family-api/index.ts`. The strict focused lint for the appointment modules and tests passed, and the full TypeScript check passed. The legacy typing debt was not rewritten during this migration-only remediation.

## Command Ledger

Every mutation-capable command below targeted the disposable local environment. Read-only `git status`, `git diff`, `find`, `ls`, `sed`, and `rg` inspections completed with exit 0.

| Command or command group | Exit | Result |
| --- | ---: | --- |
| `brew tap supabase/tap` | 0 | Official tap added |
| `brew install supabase/tap/supabase` | 0 | Supabase CLI installed |
| `brew install libpq` | 0 | PostgreSQL client installed |
| Supabase top-level and relevant subcommand `--help` calls | 0 | Version-sensitive syntax verified |
| `colima start --runtime docker --cpu 4 --memory 8` | 0 | Local Docker runtime started |
| `supabase init --yes --workdir <temp>` | 0 | Disposable project initialized |
| First `supabase db start` with all repository migrations | 1 | Stopped at pre-existing `pin_hash` ordering defect |
| `supabase stop --no-backup --workdir <temp>` | 0 | Failed attempt stopped |
| Build reconciled migration directory with `find`/`cp` | 0 | Three-version baseline prepared |
| `supabase db start --workdir <temp>` | 0 | Reconciled baseline applied |
| `supabase migration list --local` | 0 | Mapped versions verified |
| First sandboxed `psql -f ...fixtures.sql` | 2 | Local TCP blocked by process sandbox; no DB change |
| Approved local `psql -f ...fixtures.sql` retry | 0 | Synthetic fixtures loaded |
| `psql -f ...appointment_release_preflight.sql` | 0 | All four issue counts zero |
| Baseline hash query | 0 | Data hash captured |
| First `pg_dump --restrict-key=pepper_rehearsal` | 1 | PostgreSQL rejected invalid key format; no dump |
| `pg_dump` with fixed 64-hex restrict key | 0 | Schema hash captured |
| `supabase db push --local --dry-run --skip-vault` | 0 | Only two pending migrations listed |
| First `supabase db push --local --skip-vault` | 0 | Ordered apply succeeded |
| First post-apply assertion script | 0 | Assertions passed |
| First test-only rollback SQL | 0 | SQL completed, but acceptance hashes exposed rollback defects |
| First post-rollback hash comparison | 1 acceptance | Schema and data hashes differed; candidate rejected and repaired |
| `supabase db reset --local --no-seed` | 0 | Clean mapped baseline rebuilt |
| Reload fixtures and capture final baseline hashes | 0 | Final baseline established |
| Corrected pending apply | 0 | Both migrations applied |
| Corrected exact rollback | 0 | Rollback completed |
| Corrected schema/data comparison | 0 | Both hashes exactly matched baseline |
| Delete two pending rows from local migration ledger | 0 | Local-only reapply preparation |
| Reapply pending migrations | 0 | Both migrations reapplied |
| Post-reapply assertion script | 0 | Assertions passed |
| Direct second application of `20260916120000` | 0 | Existing objects skipped; calendar update affected 0 rows |
| Direct second application of `20260916150000` | 0 | Existing objects skipped; no duplicate data |
| Post-replay schema/data comparison | 0 | Both hashes unchanged |
| Final post-replay assertion script | 0 | Assertions passed |
| `supabase db lint --local --level warning --fail-on error` | 0 | No schema errors |
| `supabase db advisors --local --type all --level info --fail-on error` | 0 | Informational findings only |
| Focused appointment tests before new contract test | 0 | 60/60 passed |
| Full tests before new contract test | 0 | 175/175 passed |
| New rollback/idempotency contract test | 0 | 5/5 file tests passed |
| `tsc --noEmit` | 0 | Passed |
| Broad staged-file ESLint | 1 | Existing legacy family API lint debt |
| Strict focused appointment ESLint | 0 | Passed |
| `vinext build` | 0 | Production build passed |
| `scripts/validate-artifact.sh` | 0 | Artifact passed |
| Calendar-guard focused tests | 0 | 45/45 passed |
| Final focused appointment tests | 0 | 78/78 passed |
| Final full test suite | 0 | 193/193 passed |
| Final migration list and synthetic counts | 0 | Five expected versions; 1/2/7/7/4/2 records; zero cron jobs |
| Final staged and unstaged Git whitespace checks | 0 | No whitespace errors |
| `supabase stop --no-backup --workdir <temp>` | 0 | Disposable project stopped and discarded |
| `colima stop` | Not run | Safety review prevented directly stopping a potentially shared runtime |
| `colima status` | 1 | Confirmed Colima was no longer running after disposable-service shutdown |

## Remaining Manual Boundaries

Local database rehearsal is complete. Production remains untouched. The next allowed step is a separately reviewed external sandbox retest of this exact candidate. Separate authorization is still required before Pepper creates the `Pepper Family` production secondary calendar through its controlled OAuth setup flow, creates the `Pepper Appointments` AEGIS tab and dedicated writer identity, enters protected configuration, reconnects production OAuth, creates the Vault retry secret, enables the scheduler, applies migrations, deploys functions, deploys Vercel, or performs a live canary. A manually created Calendar is not an eligible production destination.

The disposable Supabase project is stopped and discarded. A final `colima status` check confirmed Colima is not running, so no Pepper rehearsal database, container, or VM remains active.
