# Pepper production backend baseline

Captured read-only from Supabase production on 2026-08-24 for branch `v6-logistics-foundation`. This is a Phase 0 version-control baseline only: no function was deployed, no migration was run, and no production data was changed.

## Edge Functions

| Function | Version | Local source | Deployed bundle SHA-256 | Equivalence |
|---|---:|---|---|---|
| `pepper-family-beta` | 8 | `supabase/functions/pepper-family-beta/index.ts` | `43e9a6649a6a3e4aae2e21cd270a0b7f6091ad7a6f5fb514677ce2328114a597` | Effective (terminal LF only) |
| `pepper-family-beta-01` | 4 | `supabase/functions/pepper-family-beta-01/index.ts` | `0bcab12e9e4d8358fe7be54dae31cb023046db19e68c0acb7db31c7d1bb422e4` | Effective (terminal LF only) |
| `pepper-family-beta-01-web` | 9 | `supabase/functions/pepper-family-beta-01-web/index.ts` | `0be40dab23ba0df58ed790524b168d05501fa74e3d53c99523dbc2caf786e32e` | Byte-for-byte |
| `pepper-calendar` | 6 | `supabase/functions/pepper-calendar/index.ts`<br>`supabase/functions/pepper-calendar/logic.ts` | `627e9ed8707c049686a820e4f3c4bd80bdd6664afdb703316ce9a91dca6c99c8` | Byte-for-byte |
| `pepper-consequences` | 7 | `supabase/functions/pepper-consequences/index.ts` | `270998d61b816a3faf52444c8e0ce72ec509d870ea16a12ef40de8adfd3490ef` | Byte-for-byte |
| `pepper-reflections` | 4 | `supabase/functions/pepper-reflections/index.ts` | `cd2ce81ee090d5eb374b6969de47a11edafa503c3b298f6c82fb90f56213e312` | Effective (terminal LF only) |
| `pepper-horizon` | 7 | `supabase/functions/pepper-horizon/index.ts` | `0161c8bc563fb3afcf82cf49eb42753ee7c777ef8cef9bed88492f88c642e761` | Byte-for-byte |
| `pepper-family-api` | 6 | `supabase/functions/pepper-family-api/index.ts` | `266c38e175d78e60f31b8d36d920a0d5c58255ce2619ba12d2a77463cc77ae62` | Byte-for-byte |
| `pepper-preparation` | 1 | `supabase/functions/pepper-preparation/index.ts` | `98343860c285bbce1a91bd295034b88b7cb29bcf70ff4e208917b1fad2cf24a3` | Byte-for-byte |
| `pepper-rituals` | 1 | `supabase/functions/pepper-rituals/index.ts` | `e7d218875b3dc55f88231caf7c1874300abbd92250764ee85c71ac5c9bd0f253` | Byte-for-byte |
| `pepper-tell-v2` | 1 | `supabase/functions/pepper-tell-v2/index.ts` | `16a4f5e63cd6c36e7d6ebe1f398c364f4fbf33010466edc24da273cc125d1971` | Effective (terminal LF only) |

File-level deployed and local source SHA-256 hashes are recorded in [`baseline/production.json`](baseline/production.json). All 11 active functions reported `verify_jwt = false`; none had an import map.

## Migration baseline

Twenty-two relevant production migration sources are captured under `supabase/migrations/`. Each is byte-for-byte or terminal-LF-only equivalent to the deployed migration text. Full deployed/local hashes are in the JSON manifest.

Two remote-history entries are intentionally not copied:

- `20260814230412_pepper_family_beta_sessions_seed`: mixes session-table DDL with private household seed/authentication data. The deployed SHA-256 is recorded, but the source is not placed in Git.
- `20260822093842_add_internal_product_ops_ledger`: unrelated to the Pepper runtime/V6 foundation; its deployed SHA-256 is recorded for full-history accounting.

## Runtime schema supplement

[`baseline/runtime_schema.sql`](baseline/runtime_schema.sql) is a schema-only reconstruction snapshot for the five runtime-critical tables whose original DDL is absent from the safe migration set:

- `public.member_sessions`
- `public.calendar_connections`
- `private.calendar_oauth_states`
- `private.calendar_tokens`
- `private.calendar_sync_runs`

The snapshot was generated exclusively from PostgreSQL catalogs. It includes columns, defaults, nullability, constraints, indexes, the owned sequence used by calendar sync runs, RLS state, policies, trigger state, ownership, and runtime-relevant grants. It contains no rows, session or OAuth values, sequence state, household identifiers, credentials, or seed data.

The snapshot preserves current security reality for later review: RLS is enabled on both public tables. The three private calendar tables currently have RLS disabled and no policies; their table privileges are limited to the owner.

## Known discrepancies and provenance notes

- Files marked effective rather than byte-for-byte differ only in terminal line-feed normalization. Both deployed and local hashes are recorded.
- The original migration provenance for the five supplemented runtime tables remains unavailable or unsafe to copy. Their current deployed structure is now reproducible from the no-data catalog snapshot.
- At capture time, production had `pepper-family-api` version 6 and the additional active `pepper-tell-v2` version 1. Both are included even though the earlier audit inventory predated them.

## Scope guard

This baseline does not reconcile captures, implement event windows/lifecycle, deploy Edge Functions, apply migrations, or mutate production data.
