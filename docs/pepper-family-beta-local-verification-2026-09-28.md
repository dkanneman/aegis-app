# Pepper family beta: local verification

## Scope and baseline

Local code, synthetic PostgreSQL/HTTP and mocked-browser verification only.
No real OAuth, Google Calendar, Gmail, AEGIS, production, deployment, commit or push.
The starting index was 59 files, not the brief's older 58-file snapshot:
`09bf31a51fbbfec1ab072c7912bdd66fcdf183b49bbc82b249a58916ca57c911`.
Base remains `d555fee1c4b5a9ade0d48c4d64b2fcd064207406`.

The endpoint repair checkpoint was independently retained before product changes:
59 files, patch `a78b1f775aa29eb8a43dcb981e3005b0548e6e63b977801dfb1dde0a680502e8`.
The launcher uses the exact local callback path, a verified cached postgres 3.4.7
archive, dummy values and an internal-only Docker network. Provider fetches are
blocked. The expiry test compares database clocks rather than host and VM clocks.
The old-schema gate ran: 2 passed and 12 failed as expected. After the forward
migration, all 14 HTTP/database tests passed, rather than merely starting a worker.

## Capability audit

| Capability | Existing implementation | Current evidence/status |
| --- | --- | --- |
| Member sessions, role/household boundaries | PIN/session model, member roster, canonical action RPCs | Implemented and locally verified for tested adult/child/outsider/inactive cases; database authorization transaction passes |
| Shared event updates and revision conflicts | Staged appointment/member release | Existing local tests; no new external evidence |
| Natural pickup/cancellation | Existing parser and capture pipeline | Repaired and locally verified for configured names, one exact target, ambiguous targets, retained event times, cancellation, pending delivery |
| Driver state | Assignment previously normalized to confirmed | Assignment stays assigned; the assigned adult explicitly accepts; tested through HTTP/database |
| Schedule/transport consequences | Existing trigger-based consequence engine | Overlap and cancellation resolution tested; missing driver is needs_attention, not an emergency |
| Voice | Browser speech recognition existed | Draft-before-send, lifecycle cleanup, text fallback and failed-send retry tested with a speech double; actual iPhone dictation remains unverified |
| Chores | Adult creation, child own completion, shared status and Undo existed | HTTP/database completion/readback/Undo tested; added separate idempotent recurring occurrences |
| Meals | Shared plan, saved member needs, variations, owners and editor existed | Leftovers preserves known dinner time and does not invent an event; Tonight loaded directly on Today; owner/variation editors not exhaustively reverified |
| Groceries | Add, attach, assign, complete/reopen existed | Added adult name edit preserving associations; HTTP/database edit/checkoff/reopen tested |
| Parent/child screens | Tasks, Chores, Meals, family directory existed | Synthetic Today/Chores/Meals rendered at 390 and 1440 widths; child Today omits adult rhythm/health prompts |
| Time-of-day atmosphere | Existing atmosphere calculation and botanical assets | One continuous background gradient, stable content surfaces and reduced-motion styling; screenshots inspected |
| Dinner consequences/preparation | Existing preparation/meal logic | Partial: no fresh end-to-end proof of schedule-to-dinner suggestion or every preparation rule |
| Automatic menus, nutrition, pantry, shopping integrations | Some menu-generation code already existed | Not expanded or verified as part of the lightweight beta; remaining automatic-menu UI is outside this verification |

## Product changes

- `pepper-tell-v2/logic.ts`: household-configured aliases for ride/cancel,
  ambiguous-name rejection, exact-one event matching, Pacific day boundaries,
  possessive cancellation and explicit leftovers interpretation.
- `pepper-tell-v2/index.ts`: active members, visible/nonterminal targets,
  pickup assignment without changing appointment time, honest failed delivery,
  meal updates without a fabricated time.
- `pepper-family-api/index.ts`: inactive-member/assignment rejection, guarded
  legacy mutation routing, recurrence date requirement, grocery edit, explicit
  driver acceptance and dinner in progressive Today state. Optional source
  provenance uses row JSON projection so the release does not depend on excluded
  Gmail schema additions.
- `pepper-family-beta-01/index.ts`: inactive sessions rejected and task/grocery
  writes forwarded to the canonical authorization path. Legacy runtime dispatch
  verified with a dependency double; its Supabase-client transport was not run.
- `pepper-client.tsx`: voice drafts, busy/listening guards, retry identity,
  delivery-pending notices, grocery editor, ride acceptance, dinner summary,
  simpler child Today.
- `pepper.module.css`: continuous atmosphere, microphone/edit controls,
  reduced-motion behavior and required pre-existing action/source styles.
- New recurring-chore migration/rollback, offline family worker/database tests,
  coordination/legacy-route tests and release manifest/builder updates.

## Fresh verification

- Fast staged-only suite: 203 tests, zero skipped.
- Family HTTP/database: 7 tests, zero skipped, actual handlers and PostgreSQL.
- Calendar HTTP/database: 14 tests, zero skipped, actual handler and PostgreSQL.
- Household calendar authorization SQL: both DO assertions passed in a rollback
  transaction.
- TypeScript, focused client/logic/test ESLint, direct Vite production build,
  artifact validation and both Git whitespace checks passed.
- Broader strict ESLint of the three server handlers FAILED: 203 errors and two
  warnings (201 explicit-any errors, two prefer-const errors, two unused warnings).
  This result is not waived or called green. A broad typing refactor was not mixed
  into this release to hide that failure.
- Database lint and security/performance advisors at warn/error level reported
  no issues on the fresh canonical local chain with the documented pg_cron
  platform prerequisite. This is not a production schema inspection.
- Browser checks used synthetic API responses and isolated headless contexts,
  blocked all non-loopback requests, and tested 4 role/viewport combinations.
  They prove rendering and voice/retry UI behavior, not real multi-device sync.

## Migration evidence and rollback limits

Clean local reset replayed through `20260928230029` successfully. The new migration
`20260929002346_materialize_recurring_chore_occurrences.sql` then passed apply,
exact rollback, reapply and guarded replay with synthetic pre-existing records.
Existing task JSON was identical before/after. Post-apply dump text changes because
the new nullable column is included; rollback restores both complete hashes.

| Hash | Before / exact restoration | Applied / reapplied / replayed |
| --- | --- | --- |
| Public/private schema | `1d5cbcaebd209ed2cf091a58b5f3a1e8adbc45247a732dbe8703add052fed5ed` | `c0d5d776b3c624c256c3e316dc594a56018b22a3e04374f5f07e85902fcafbb9` |
| Public/private data dump | `74185687d76cabd6812a9f698ef7bd2db95d104a660496f7d4cb6337657c3c72` | `212158941ccdf7e6b98a47e4c4af55e7bef77b6ebbef03bf4015d8d29dffce5b` |

New migration SHA-256: `56591b994bbcd24a2b0cebe8df66619085b663a8807529a93d74e892c7d1c05d`.
Rollback SHA-256: `9d433fa01fd17b6511e70124e6242d8d48de2e5a5b098c26f778b011c8c91d04`.
Once recurring occurrences exist, rollback deliberately refuses to discard their
lineage. It must run before older pending-release rollback, after explicit review;
the older rollback script does not automatically include this new migration.

The earlier whole-release rollback discrepancy is real. Task/event changes fire
the `20260820014523` family-state triggers and the `20260831211249` home-brain
ledger trigger. Backfill and compensating rollback append ledger/state-change
entries and update responsibility timestamps; sequences can also advance. Restoring
task fields is not an exact database restore. Do not delete immutable audit history
to force hashes to match. A reviewed backup/restore or compensating-rollback policy
is required before production. This does not prevent disposable local testing.

## Remaining limitations and decision

PARTIAL / NOT READY for a complete family beta or an all-gates-passed external run.
The original OAuth endpoint blocker is repaired and locally proven, but:

1. Resolve or explicitly review the broader server lint gate without weakening
   authorization or mixing in unfinished Gmail work.
2. Complete integrated browser/backend coverage of progressive state, meal
   variations/preparation and all visible actions. Current browser fixtures do not
   prove every proxy dependency. Real Safari/iPhone voice and separate physical
   device behavior remain untested.
3. Complete meal schedule-conflict suggestions and review existing auto-menu UI
   against the agreed lightweight beta. General legacy family-name assumptions
   outside the new ride/cancel path remain.
4. Monthly recurrence uses calendar-month addition (month-end clamping); only daily
   recurrence/DST/replay was exercised through HTTP. Review monthly anchoring before
   relying on month-end schedules. No historical recurrence backfill was performed.
5. Review the whole-release rollback policy, then fingerprint the accepted candidate.
6. Obtain separate authorization for exact-candidate external sandbox evidence.
   Only after that may separately authorized read-only production readiness and
   controlled canary preparation be considered. No deployment is authorized here.

## Preserved boundaries

Config index blob remains `5f5ec76724c596fc76c7ff05ea9cfc4e33ea367e`.
Working config remains `aed6555f9ed5dd8a83f4d2bc7c93ec02688b237cca80f89d57ca5e5d64fe64d6`.
Gmail implementation/migrations/tests and multi-member email architecture remain
unstaged. Config retains its intentional three-insertion/two-deletion difference.
CSS has an additional intentional boundary: required beta styles are staged while
the pre-existing unrelated 57-line health-setup deletion remains unstaged.
No other candidate file should have unstaged edits at the final fingerprint.
Final machine-readable fingerprint and sanitized logs are retained outside Git in
the `pepper-beta-local-evidence` directory under this chat's visualization workspace.
