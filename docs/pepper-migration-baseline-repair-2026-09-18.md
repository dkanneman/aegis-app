# Pepper migration baseline repair

Date: 2026-09-18

Scope: local disposable Supabase/PostgreSQL only. No hosted project, OAuth provider, Calendar, AEGIS workbook, Vercel deployment, Git remote, or production credential is used by this procedure.

## Root causes

The two reported failures were separate baseline defects:

1. `household_members.pin_hash` belonged to production migration ledger version `20260814230412_pepper_family_beta_sessions_seed`. Its source combined required runtime DDL with private household seed and authentication material, so it was intentionally excluded from Git. The next captured migration, `20260814230550_pepper_verify_family_pin.sql`, therefore referenced a column that a fresh repository replay had not created.
2. `public.groceries` is authentically created by `20260814230349_pepper_family_beta_core_tables.sql`. The production-shaped rehearsal failed because its synthetic foundation replaced the canonical history and omitted that table. The production migration history itself was not missing the groceries definition.

The fresh replay also established that production event/calendar compatibility columns predated the safely captured migration set. Those catalog-backed definitions are included in the same seed-free runtime reconstruction so later historical migrations can replay without hand-created objects.

## Dependency map

| Object | First definition | First reference or behavior | Later modification |
| --- | --- | --- | --- |
| `household_members.pin_hash` | `20260814230412_pepper_family_beta_runtime_schema.sql` | `20260814230550_pepper_verify_family_pin.sql` | `20260904183754_add_first_time_member_pin_setup.sql`, `20260904191133_require_first_time_pin_for_family.sql`, `20260904191323_restrict_family_session_rpc.sql`, `20260904193500_accept_danielle_family_login.sql` |
| `member_sessions` and session indexes | `20260814230412_pepper_family_beta_runtime_schema.sql` | session helper functions in the same version | hardened by `20260901090000_harden_private_runtime_rls.sql`; session identity extended by `20260917211929_authorize_household_calendar_contributions.sql` |
| PIN/session helper functions and grants | `20260814230412_pepper_family_beta_runtime_schema.sql` | same version | replaced or restricted by the four September 4 PIN migrations |
| `public.groceries`, base constraints, indexes and RLS | `20260814230349_pepper_family_beta_core_tables.sql`; RLS in `20260814230355_pepper_family_beta_rls.sql` | owner-reference hardening in `20260815032407_harden_household_owner_references.sql` | meal/owner columns and indexes in `20260901214500_connect_meals_groceries_and_family_needs.sql`; origin constraint and open-item dedupe index in `20260908213000_normalize_open_groceries.sql` |
| event/calendar runtime tables and event compatibility columns | `20260814230412_pepper_family_beta_runtime_schema.sql` (catalog-backed reconstruction) | housekeeping event normalization first requires `events.notes` in `20260823220231_v51_normalize_housekeeping_event_kind.sql` | appointment and delivery migrations beginning `20260915164500_harden_appointment_intake_and_bridge.sql` |

## Production-history compatibility

The canonical runtime migration uses version `20260814230412`, the version already present in the reviewed production ledger. A hosted production migration runner therefore treats it as applied and does not execute it. Fresh databases execute only the schema reconstruction. It contains no household rows, member rows, PIN values, sessions, OAuth tokens, credentials, or copied production data.

The immutable catalog snapshot in `supabase/baseline/runtime_schema.sql` remains the provenance source. The executable migration is the canonical bootstrap source.

## Rehearsal modes

Fresh bootstrap applies `supabase/migrations` in version order.

Production-shaped rehearsal uses `supabase/tests/build_production_shaped_migrations.sh` to derive its migration set from the same canonical directory. It maps:

- local `20260915164500` to production ledger version `20260915203426`;
- local `20260915175808` to production ledger version `20260915203431`.

It excludes unfinished Gmail work and sandbox-only `20260916143000`. Baseline mode stops before the pending release migrations. Release mode additionally applies, in order:

1. `20260916120000_sync_published_appointments.sql`
2. `20260916150000_production_appointment_delivery.sql`
3. `20260917211929_authorize_household_calendar_contributions.sql`

The retired synthetic foundation must not be restored or used for release verification.

Before production-shaped preflight, the disposable local database applies
`supabase/tests/local_supabase_platform_prerequisites.sql`. It enables only the
platform-managed `pg_cron` extension that hosted Supabase already provides; it
does not create Pepper tables, columns, rows, policies, or fixtures. The
application migration chain remains the sole source for Pepper schema.
