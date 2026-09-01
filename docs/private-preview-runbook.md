# Pepper V6 private preview runbook

## Boundary

- Supabase project: `pepper-v6-private-preview` (`mfgyeolvfthxacrqwwtc`)
- Source application branch: `codex/v6-pepper-family-slice`
- Production Supabase and the live Pepper deployment are read-only for this work.
- The preview contains a point-in-time copy of canonical family state: 5 members, 79 events, 163 tasks, 169 responsibilities, 4 groceries, and 2 meals.
- Production PINs, member sessions, OAuth tokens, raw captures, and production audit/state-change history were not copied.
- The generated preview PIN is delivered separately and must never be committed.

## Deployed preview services

| Function | Authentication | Purpose |
| --- | --- | --- |
| `pepper-family-beta-01` | Pepper member session | Canonical family state foundation |
| `pepper-family-api` | Supabase platform JWT plus Pepper member session | Web application gateway and authorized mutations |
| `pepper-integrations` | Supabase platform JWT plus Pepper member session | Honest connection status, Gmail start, Health pairing |
| `pepper-health-ingest` | Supabase platform JWT plus one-time member pairing token | Member-scoped daily HealthKit metrics |
| `pepper-consequences` | Supabase platform JWT plus Pepper member session | Canonical missing-owner and conflict projection |
| `pepper-horizon` | Supabase platform JWT plus Pepper member session | Seven-day operational horizon and readiness |
| `pepper-preparation` | Supabase platform JWT plus Pepper member session | Preparation actions derived from canonical state |
| `pepper-reflections` | Supabase platform JWT plus Pepper member session | Member-private weekly reflection evidence |
| `pepper-rituals` | Supabase platform JWT plus Pepper member session | Morning and evening summaries |
| `pepper-tell-v2` | Supabase platform JWT plus Pepper member session | Transactional natural-language capture and reconciliation |

Google Calendar and Gmail use preview-only callbacks and remain disconnected until a Google OAuth web client supplies `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The Google client must authorize these exact redirect URIs:

- `https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-calendar/callback`
- `https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-gmail-callback`

`PEPPER_APP_URL` should point to the protected Pepper preview route. The functions fall back to the branch preview route so OAuth can return safely even before that optional override is set.

## Apple Health pathway

A web application cannot read Apple Health directly. Pepper creates a one-time pairing token for an iPhone Shortcut or future native companion. The Shortcut sends only approved daily metrics to the generated upload URL.

Required headers:

```text
Authorization: Bearer <Supabase publishable key>
apikey: <Supabase publishable key>
x-pepper-health-token: <one-time pairing token>
Content-Type: application/json
```

Example body:

```json
{
  "metric_date": "2026-09-01",
  "step_count": 6200,
  "step_goal": 10000,
  "active_minutes": 24
}
```

Pairing and session tokens are secrets. They are shown only to the authenticated member, are never logged in documentation, and can be revoked.

## Verification record

- Real snapshot counts verified after import.
- Adult owner/driver assignment, completion, cancellation, restore, audit, and state propagation verified against persisted preview data.
- Teen driver assignment denied with HTTP 403.
- Health pairing and ingestion verified, then the temporary metric and pairing were removed.
- Canonical engines return 2 current consequences, 7 horizon days, 5 readiness items, 2 preparation items, and daily rituals from the real snapshot.
- The Vercel branch origin passes the scoped CORS preflight; unrelated Vercel hostnames are not accepted.
- Supabase security advisor returned no findings after explicit private-table deny policies.

The preview is not a production migration source. Any later production change must use reviewed additive migrations and a separate production preflight.
