# Pepper Household Calendar Contributions

## Beta authorization model

- Every request starts with the member's own `x-pepper-session` token.
- Edge Functions resolve that token to one active `household_members` row and a stable, non-secret `member_sessions.session_id`.
- Only `adult_admin` and `adult` members may create, update, or cancel shared Calendar events.
- Child and teen event submissions are retained as Pepper capture review proposals. They do not create an event or invoke Google Calendar.
- The canonical event, mutation actor, and configured Pepper-created Calendar connection must all belong to the same household.
- Google access and refresh tokens remain in server-side Vault-backed storage. No token is returned to the browser.
- Google writes continue to use the one stored Pepper-created Calendar ID. There is no primary-calendar or alternate-calendar fallback.
- Google payloads do not contain attendees and every write uses `sendUpdates=none`.

## Durable evidence

`public.events` records the creating member, latest modifying member, stable session identity, revision, and latest immutable Calendar action ID. `private.calendar_event_mutation_requests` records one deterministic, immutable create/update/cancel request with its household, event, actor, stable session, revisions, and a SHA-256 request fingerprint.

The Calendar worker rechecks the immutable action, active adult membership, household boundaries, event visibility, action type, and event revision before refreshing a Google token. A missing or inconsistent boundary becomes `needs_review`; it never falls back to another member, household, or calendar.

## Concurrency and replay

- Family API event mutations require the caller's integer `expected_revision` and a stable per-action `mutation_id`.
- The server changes the canonical event and increments `revision` in one conditional update. `updated_at` is display/audit metadata only and is never a Calendar-event lock.
- Exact retries reuse `mutation_id`; independent actions use distinct IDs so one of two writes against the same revision receives a conflict.
- Canonical mutations increment `events.revision`.
- Stale concurrent updates fail rather than overwriting newer state.
- Capture-driven action keys and Google event IDs are deterministic.
- A repeated capture reuses the same mutation record and canonical event.

## Migration and rollback

Forward migration:

`supabase/migrations/20260917211929_authorize_household_calendar_contributions.sql`

Exact local rollback:

`supabase/tests/multi_member_calendar_contributions_rollback.sql`

The rollback removes only the columns, functions, trigger, indexes, and immutable action table introduced by the forward migration. It does not delete canonical events or household members.

## Release boundary

This local implementation changes the appointment release candidate. It requires a new isolated multi-device sandbox verification before deployment. That test must use separate Pepper sessions for Danielle and Matt, synthetic events only, the reviewed Pepper-created sandbox Calendar, and no event attendees or invitations.
