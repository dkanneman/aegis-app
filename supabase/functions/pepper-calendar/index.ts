import postgres from 'npm:postgres@3.4.7';
import {
  activityKey,
  canonicalDedupeKey,
  eventTime,
  inferPerson,
  kindFor,
  requirementFor,
  sharedWithHousehold,
  stripHtml,
} from './logic.ts';

const APP_URL = Deno.env.get('PEPPER_APP_URL') || 'https://pepper-family-beta-git-codex-v6-e3b0dd-dkanneman-8936s-projects.vercel.app/pepper';
const APP_ORIGIN = new URL(APP_URL).origin;
const FUNCTION_NAME = 'pepper-calendar';
const FAMILY_TIME_ZONE = 'America/Los_Angeles';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const DATABASE_URL = Deno.env.get('SUPABASE_DB_URL') || '';
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}/callback`;

if (!DATABASE_URL) throw new Error('SUPABASE_DB_URL is not configured.');

const sql = postgres(DATABASE_URL, {
  ssl: 'require',
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 300,
});

type Member = {
  id: string;
  household_id: string;
  slug: string;
  display_name: string;
  role: 'adult_admin' | 'adult' | 'teen' | 'child';
};

type Connection = {
  id: string;
  household_id: string;
  connected_by_member_id: string;
  provider_calendar_id: string;
  calendar_name: string | null;
  calendar_time_zone: string | null;
  scan_window_days: number;
  status: string;
  sync_status: string;
  last_attempt_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

type GoogleEvent = {
  id: string;
  iCalUID?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  visibility?: string;
  htmlLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  organizer?: { email?: string; displayName?: string; self?: boolean };
};

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function allowedOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === APP_ORIGIN;
}

function responseHeaders(req: Request) {
  const origin = req.headers.get('origin');
  return {
    'Access-Control-Allow-Origin': origin === APP_ORIGIN ? origin : APP_ORIGIN,
    'Access-Control-Allow-Headers': 'apikey, content-type, x-pepper-cron',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(req),
  });
}

function redirectToApp(state: 'connected' | 'error', reason?: string, returnTarget: unknown = 'web') {
  if (returnTarget === 'pepper_ios') {
    const nativeUrl = new URL('pepper://oauth');
    nativeUrl.searchParams.set('calendar', state);
    if (reason) nativeUrl.searchParams.set('reason', reason.slice(0, 80));
    return Response.redirect(nativeUrl.toString(), 303);
  }
  const url = new URL(APP_URL);
  url.searchParams.set('calendar', state);
  url.searchParams.set('view', 'week');
  if (reason) url.searchParams.set('reason', reason.slice(0, 80));
  return Response.redirect(url.toString(), 303);
}

function oauthConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && SUPABASE_URL);
}

function safeError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error || 'Unknown calendar error');
  return text
    .replace(/(refresh_token|client_secret|access_token)=[^&\s]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .slice(0, 500);
}

function randomToken(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function pkceChallenge(verifier: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] || 0) ^ (b[index] || 0);
  }
  return mismatch === 0;
}

async function memberFromSession(token: unknown): Promise<Member> {
  if (typeof token !== 'string' || !UUID_PATTERN.test(token)) {
    throw new HttpError(401, 'session_required', 'Unlock Pepper again to continue.');
  }

  const rows = await sql<Member[]>`
    select m.id, m.household_id, m.slug, m.display_name, m.role
    from public.member_sessions s
    join public.household_members m on m.id = s.member_id
    where s.token = ${token}::uuid
      and s.revoked_at is null
      and s.expires_at > now()
    limit 1
  `;
  const member = rows[0];
  if (!member) throw new HttpError(401, 'session_expired', 'Your Pepper session expired.');

  await sql`
    update public.member_sessions
    set last_seen_at = now()
    where token = ${token}::uuid
  `;
  return member;
}

function requireAdult(member: Member) {
  if (!['adult_admin', 'adult'].includes(member.role)) {
    throw new HttpError(403, 'adult_required', 'Only a family adult can connect Google Calendar.');
  }
}

async function connectionForHousehold(householdId: string) {
  const rows = await sql<Connection[]>`
    select id, household_id, connected_by_member_id, provider_calendar_id,
      calendar_name, calendar_time_zone, scan_window_days, status, sync_status,
      last_attempt_at, last_synced_at, last_error
    from public.calendar_connections
    where household_id = ${householdId}::uuid and provider = 'google'
    limit 1
  `;
  return rows[0] || null;
}

async function beginOAuth(member: Member, returnTarget: unknown) {
  requireAdult(member);
  if (!oauthConfigured()) {
    throw new HttpError(
      503,
      'oauth_not_configured',
      'Google Calendar setup is waiting for the server-side OAuth credentials.',
    );
  }

  const state = randomToken(32);
  const stateHash = await digest(state);
  const verifier = randomToken(64);
  const challenge = await pkceChallenge(verifier);
  const return_target = returnTarget === 'pepper_ios' ? 'pepper_ios' : 'web';

  await sql`
    delete from private.calendar_oauth_states
    where expires_at < now() or consumed_at < now() - interval '1 hour'
  `;
  await sql`
    insert into private.calendar_oauth_states (
      state_hash, code_verifier, household_id, member_id, return_target, expires_at
    ) values (
      ${stateHash}, ${verifier}, ${member.household_id}::uuid,
      ${member.id}::uuid, ${return_target}, now() + interval '10 minutes'
    )
  `;

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return url.toString();
}

async function fetchGoogleJson(url: string, init: RequestInit, code: string) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = typeof data.error_description === 'string'
      ? data.error_description
      : typeof data.error === 'object' && data.error && 'message' in data.error
      ? String((data.error as { message?: unknown }).message || '')
      : typeof data.error === 'string'
      ? data.error
      : `Google returned ${response.status}`;
    throw new HttpError(response.status, code, detail);
  }
  return data;
}

async function exchangeCode(code: string, verifier: string) {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  return fetchGoogleJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, 'oauth_exchange_failed');
}

async function refreshAccessToken(connectionId: string) {
  if (!oauthConfigured()) {
    throw new HttpError(503, 'oauth_not_configured', 'Google OAuth is not configured.');
  }
  const rows = await sql<{ refresh_token: string }[]>`
    select v.decrypted_secret as refresh_token
    from private.calendar_tokens t
    join vault.decrypted_secrets v on v.id = t.vault_secret_id
    where t.connection_id = ${connectionId}::uuid
    limit 1
  `;
  if (!rows[0]?.refresh_token) {
    throw new HttpError(409, 'refresh_token_missing', 'Reconnect Google Calendar to restore scanning.');
  }

  const body = new URLSearchParams({
    refresh_token: rows[0].refresh_token,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const token = await fetchGoogleJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, 'token_refresh_failed');
  if (typeof token.access_token !== 'string') {
    throw new HttpError(502, 'access_token_missing', 'Google did not return an access token.');
  }
  return token.access_token;
}

async function completeOAuth(reqUrl: URL) {
  const state = reqUrl.searchParams.get('state') || '';
  const stateHash = state ? await digest(state) : '';
  const stateRows = await sql<{
    code_verifier: string;
    household_id: string;
    member_id: string;
    return_target: string;
  }[]>`
    update private.calendar_oauth_states
    set consumed_at = now()
    where state_hash = ${stateHash}
      and consumed_at is null
      and expires_at > now()
    returning code_verifier, household_id, member_id, return_target
  `;
  const oauthState = stateRows[0];
  if (!oauthState) return redirectToApp('error', 'invalid_state');

  const oauthError = reqUrl.searchParams.get('error');
  if (oauthError) return redirectToApp('error', oauthError, oauthState.return_target);
  const code = reqUrl.searchParams.get('code');
  if (!code || !oauthConfigured()) return redirectToApp('error', 'oauth_not_configured', oauthState.return_target);

  try {
    const token = await exchangeCode(code, oauthState.code_verifier);
    const accessToken = String(token.access_token || '');
    if (!accessToken) throw new HttpError(502, 'access_token_missing', 'Google did not return an access token.');

    const calendar = await fetchGoogleJson(
      'https://www.googleapis.com/calendar/v3/calendars/primary',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      'calendar_lookup_failed',
    );
    const calendarId = typeof calendar.id === 'string' ? calendar.id : 'primary';
    const calendarName = typeof calendar.summary === 'string' ? calendar.summary.slice(0, 240) : 'Primary calendar';
    const calendarTimeZone = typeof calendar.timeZone === 'string' ? calendar.timeZone.slice(0, 100) : FAMILY_TIME_ZONE;

    const connection = await sql.begin(async (transaction) => {
      const rows = await transaction<Connection[]>`
        insert into public.calendar_connections (
          household_id, connected_by_member_id, provider, provider_calendar_id,
          calendar_name, calendar_time_zone, access_scope, status, sync_status,
          scan_window_days, last_error, updated_at
        ) values (
          ${oauthState.household_id}::uuid, ${oauthState.member_id}::uuid,
          'google', ${calendarId}, ${calendarName}, ${calendarTimeZone},
          'calendar.readonly', 'connected', 'never', 14, null, now()
        )
        on conflict (household_id, provider) do update set
          connected_by_member_id = excluded.connected_by_member_id,
          provider_calendar_id = excluded.provider_calendar_id,
          calendar_name = excluded.calendar_name,
          calendar_time_zone = excluded.calendar_time_zone,
          access_scope = excluded.access_scope,
          status = 'connected',
          sync_status = case
            when public.calendar_connections.last_synced_at is null then 'never'
            else public.calendar_connections.sync_status
          end,
          last_error = null,
          updated_at = now()
        returning id, household_id, connected_by_member_id, provider_calendar_id,
          calendar_name, calendar_time_zone, scan_window_days, status, sync_status,
          last_attempt_at, last_synced_at, last_error
      `;
      const savedConnection = rows[0];
      const tokenRows = await transaction<{ vault_secret_id: string }[]>`
        select vault_secret_id
        from private.calendar_tokens
        where connection_id = ${savedConnection.id}::uuid
        limit 1
      `;
      const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : '';

      if (refreshToken && tokenRows[0]?.vault_secret_id) {
        await transaction`
          select vault.update_secret(
            ${tokenRows[0].vault_secret_id}::uuid,
            ${refreshToken},
            ${`pepper_google_calendar_${savedConnection.id}`},
            'Encrypted Google Calendar refresh token for Pepper'
          )
        `;
        await transaction`
          update private.calendar_tokens set updated_at = now()
          where connection_id = ${savedConnection.id}::uuid
        `;
      } else if (refreshToken) {
        const secretRows = await transaction<{ id: string }[]>`
          select vault.create_secret(
            ${refreshToken},
            ${`pepper_google_calendar_${savedConnection.id}`},
            'Encrypted Google Calendar refresh token for Pepper'
          ) as id
        `;
        await transaction`
          insert into private.calendar_tokens (connection_id, vault_secret_id)
          values (${savedConnection.id}::uuid, ${secretRows[0].id}::uuid)
          on conflict (connection_id) do update set
            vault_secret_id = excluded.vault_secret_id,
            updated_at = now()
        `;
      } else if (!tokenRows[0]) {
        throw new HttpError(409, 'refresh_token_missing', 'Google did not return offline access. Reconnect and allow access.');
      }

      await transaction`
        insert into public.audit_log (
          household_id, actor_member_id, event_type, entity_type, entity_id, summary
        ) values (
          ${oauthState.household_id}::uuid,
          ${oauthState.member_id}::uuid,
          'calendar.connected',
          'calendar_connections',
          ${savedConnection.id},
          'Primary Google Calendar connected.'
        )
      `;
      return savedConnection;
    });

    try {
      await syncConnection(connection, true, accessToken);
    } catch {
      // Authorization succeeded. The UI will show the stored scan error and can retry.
    }
    return redirectToApp('connected', undefined, oauthState.return_target);
  } catch (error) {
    return redirectToApp('error', error instanceof HttpError ? error.code : 'oauth_failed', oauthState.return_target);
  }
}

function responseStatus(event: GoogleEvent) {
  return event.attendees?.find((attendee) => attendee.self)?.responseStatus || null;
}

async function familyMembers(householdId: string) {
  return sql<Member[]>`
    select id, household_id, slug, display_name, role
    from public.household_members
    where household_id = ${householdId}::uuid
  `;
}

async function googleEvents(accessToken: string, from: Date, to: Date) {
  const items: GoogleEvent[] = [];
  let pageToken = '';
  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', from.toISOString());
    url.searchParams.set('timeMax', to.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('showDeleted', 'true');
    url.searchParams.set('maxResults', '2500');
    url.searchParams.set('timeZone', FAMILY_TIME_ZONE);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const page = await fetchGoogleJson(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, 'calendar_scan_failed');
    if (Array.isArray(page.items)) items.push(...(page.items as GoogleEvent[]));
    pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
  } while (pageToken);
  return items;
}

async function findLocalDuplicate(
  connection: Connection,
  personSlug: string | null,
  startsAt: string,
  combinedText: string,
) {
  const candidates = await sql<Array<{
    id: string;
    title: string;
    person_slug: string | null;
    starts_at: string;
    notes: string | null;
  }>>`
    select id, title, person_slug, starts_at, notes
    from public.events
    where household_id = ${connection.household_id}::uuid
      and deleted_at is null
      and external_event_id is null
      and status <> 'canceled'
      and starts_at between (${startsAt}::timestamptz - interval '15 minutes')
                        and (${startsAt}::timestamptz + interval '15 minutes')
    order by abs(extract(epoch from (starts_at - ${startsAt}::timestamptz)))
    limit 12
  `;
  const incomingActivity = activityKey(combinedText);
  return candidates.find((candidate) => {
    if (personSlug && candidate.person_slug !== personSlug) return false;
    if (!personSlug && candidate.person_slug) return false;
    return activityKey(`${candidate.title} ${candidate.notes || ''}`) === incomingActivity;
  }) || null;
}

async function upsertGoogleEvent(
  connection: Connection,
  members: Member[],
  event: GoogleEvent,
  scanStarted: string,
) {
  const existingRows = await sql<Array<{ id: string }>>`
    select id
    from public.events
    where external_connection_id = ${connection.id}::uuid
      and external_event_id = ${event.id}
    limit 1
  `;
  const existingId = existingRows[0]?.id || null;

  if (event.status === 'cancelled' || event.status === 'canceled') {
    if (!existingId) return { seen: 1, upserted: 0, merged: 0 };
    await sql`
      update public.events
      set status = coalesce(canonical_status_override, 'canceled'), sync_status = 'removed', last_synced_at = ${scanStarted}::timestamptz
      where id = ${existingId}::uuid
    `;
    return { seen: 1, upserted: 1, merged: 0 };
  }

  const timeZone = event.start?.timeZone || connection.calendar_time_zone || FAMILY_TIME_ZONE;
  const startsAt = eventTime(event.start, timeZone);
  if (!startsAt) return { seen: 1, upserted: 0, merged: 0 };
  const endsAt = eventTime(event.end, timeZone);
  const title = stripHtml(event.summary || 'Untitled calendar event').slice(0, 240);
  const notes = stripHtml(event.description || '').slice(0, 8000) || null;
  const location = stripHtml(event.location || '').slice(0, 500) || null;
  const combinedText = `${title}\n${notes || ''}\n${location || ''}`;
  const personSlug = inferPerson(combinedText, members);
  const visibility = sharedWithHousehold(event, personSlug, combinedText) ? 'household' : 'private';
  const response = responseStatus(event);
  const status = response === 'declined'
    ? 'canceled'
    : response === 'tentative' || response === 'needsAction'
    ? 'tentative'
    : 'confirmed';
  const requirement = requirementFor(combinedText);
  const dedupeKey = canonicalDedupeKey(personSlug, startsAt, combinedText);
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const kind = kindFor(combinedText, title);
  let targetId = existingId;
  let merged = 0;

  if (!targetId) {
    const duplicate = await findLocalDuplicate(connection, personSlug, startsAt, combinedText);
    if (duplicate) {
      targetId = duplicate.id;
      merged = 1;
    }
  }

  if (targetId) {
    await sql`
      update public.events
      set title = case
            when canonical_content_override ? 'title' then canonical_content_override->>'title'
            else ${title}
          end,
          person_slug = ${personSlug},
          starts_at = case
            when canonical_content_override ? 'starts_at' then (canonical_content_override->>'starts_at')::timestamptz
            else ${startsAt}::timestamptz
          end,
          ends_at = case
            when canonical_content_override ? 'ends_at' then nullif(canonical_content_override->>'ends_at', '')::timestamptz
            else ${endsAt}::timestamptz
          end,
          location = case
            when canonical_content_override ? 'location' then nullif(canonical_content_override->>'location', '')
            else ${location}
          end,
          status = coalesce(canonical_status_override, ${status}),
          visibility = ${visibility},
          owner_member_id = coalesce(owner_member_id, ${connection.connected_by_member_id}::uuid),
          kind = ${kind},
          source = 'google_calendar',
          external_connection_id = ${connection.id}::uuid,
          external_provider = 'google',
          external_event_id = ${event.id},
          external_calendar_id = ${connection.provider_calendar_id},
          external_ical_uid = ${event.iCalUID || null},
          external_url = ${event.htmlLink || null},
          external_organizer_email = ${event.organizer?.email || null},
          external_organizer_name = ${event.organizer?.displayName || null},
          external_updated_at = ${event.updated || null}::timestamptz,
          notes = case
            when canonical_content_override ? 'notes' then nullif(canonical_content_override->>'notes', '')
            else ${notes}
          end,
          response_status = ${response},
          sync_status = 'synced',
          last_synced_at = ${scanStarted}::timestamptz,
          all_day = ${allDay},
          dedupe_key = ${dedupeKey},
          adult_required = ${requirement.required},
          adult_requirement_label = ${requirement.label},
          adult_owner_member_id = case when ${requirement.required} then adult_owner_member_id else null end,
          adult_requirement_status = case
            when ${requirement.required} then coalesce(adult_requirement_status, 'unassigned')
            else null
          end,
          updated_at = now()
      where id = ${targetId}::uuid
    `;
  } else {
    const rows = await sql<Array<{ id: string }>>`
      insert into public.events (
        household_id, title, person_slug, starts_at, ends_at, location, status,
        visibility, owner_member_id, kind, source, external_connection_id,
        external_provider, external_event_id, external_calendar_id,
        external_ical_uid, external_url, external_organizer_email,
        external_organizer_name, external_updated_at, notes,
        response_status, sync_status, last_synced_at, all_day, dedupe_key,
        adult_required, adult_requirement_label, adult_requirement_status
      ) values (
        ${connection.household_id}::uuid, ${title}, ${personSlug},
        ${startsAt}::timestamptz, ${endsAt}::timestamptz, ${location}, ${status},
        ${visibility}, ${connection.connected_by_member_id}::uuid, ${kind},
        'google_calendar', ${connection.id}::uuid, 'google', ${event.id},
        ${connection.provider_calendar_id}, ${event.iCalUID || null},
        ${event.htmlLink || null}, ${event.organizer?.email || null},
        ${event.organizer?.displayName || null}, ${event.updated || null}::timestamptz,
        ${notes}, ${response}, 'synced', ${scanStarted}::timestamptz,
        ${allDay}, ${dedupeKey}, ${requirement.required}, ${requirement.label},
        ${requirement.required ? 'unassigned' : null}
      )
      returning id
    `;
    targetId = rows[0].id;
  }

  return { seen: 1, upserted: targetId ? 1 : 0, merged };
}

async function syncConnection(
  connectionInput: Connection,
  force = false,
  suppliedAccessToken?: string,
) {
  const claimedRows = await sql<Connection[]>`
    update public.calendar_connections
    set sync_status = 'syncing', last_attempt_at = now(), last_error = null, updated_at = now()
    where id = ${connectionInput.id}::uuid
      and status = 'connected'
      and (
        ${force}
        or last_attempt_at is null
        or last_attempt_at < now() - interval '4 minutes'
      )
      and (
        sync_status <> 'syncing'
        or last_attempt_at is null
        or last_attempt_at < now() - interval '2 minutes'
      )
    returning id, household_id, connected_by_member_id, provider_calendar_id,
      calendar_name, calendar_time_zone, scan_window_days, status, sync_status,
      last_attempt_at, last_synced_at, last_error
  `;
  const connection = claimedRows[0];
  if (!connection) return { ok: true, skipped: true, reason: 'recent_scan_or_busy' };

  const runRows = await sql<Array<{ id: number }>>`
    insert into private.calendar_sync_runs (connection_id)
    values (${connection.id}::uuid)
    returning id
  `;
  const runId = runRows[0].id;
  const scanStarted = new Date().toISOString();
  const from = new Date(Date.now() - 18 * 60 * 60 * 1000);
  const to = new Date(Date.now() + connection.scan_window_days * 24 * 60 * 60 * 1000);

  try {
    const accessToken = suppliedAccessToken || await refreshAccessToken(connection.id);
    const [events, members] = await Promise.all([
      googleEvents(accessToken, from, to),
      familyMembers(connection.household_id),
    ]);
    const stats = { seen: 0, upserted: 0, merged: 0 };
    for (const event of events) {
      const result = await upsertGoogleEvent(connection, members, event, scanStarted);
      stats.seen += result.seen;
      stats.upserted += result.upserted;
      stats.merged += result.merged;
    }

    const removedRows = await sql<Array<{ id: string }>>`
      update public.events
      set status = coalesce(canonical_status_override, 'canceled'), sync_status = 'removed', updated_at = now()
      where external_connection_id = ${connection.id}::uuid
        and starts_at >= ${from.toISOString()}::timestamptz
        and starts_at < ${to.toISOString()}::timestamptz
        and (last_synced_at is null or last_synced_at < ${scanStarted}::timestamptz)
        and status <> 'canceled'
      returning id
    `;

    await sql.begin(async (transaction) => {
      await transaction`
        update public.calendar_connections
        set sync_status = 'healthy', status = 'connected',
            last_synced_at = ${scanStarted}::timestamptz,
            last_error = null, updated_at = now()
        where id = ${connection.id}::uuid
      `;
      await transaction`
        update private.calendar_sync_runs
        set finished_at = now(), status = 'healthy', events_seen = ${stats.seen},
            events_upserted = ${stats.upserted}, duplicates_merged = ${stats.merged},
            events_removed = ${removedRows.length}
        where id = ${runId}
      `;
    });
    return {
      ok: true,
      skipped: false,
      last_synced_at: scanStarted,
      events_seen: stats.seen,
      events_upserted: stats.upserted,
      duplicates_merged: stats.merged,
      events_removed: removedRows.length,
    };
  } catch (error) {
    const message = safeError(error);
    const code = error instanceof HttpError ? error.code : 'calendar_sync_failed';
    const connectionStatus = ['token_refresh_failed', 'refresh_token_missing'].includes(code) ? 'error' : 'connected';
    await sql.begin(async (transaction) => {
      await transaction`
        update public.calendar_connections
        set sync_status = 'error', status = ${connectionStatus},
            last_error = ${message}, updated_at = now()
        where id = ${connection.id}::uuid
      `;
      await transaction`
        update private.calendar_sync_runs
        set finished_at = now(), status = 'error', error_code = ${code},
            error_message = ${message}
        where id = ${runId}
      `;
    });
    throw error;
  }
}

async function verifyCron(req: Request) {
  const presented = req.headers.get('x-pepper-cron') || '';
  const rows = await sql<Array<{ secret: string }>>`
    select decrypted_secret as secret
    from vault.decrypted_secrets
    where name = 'pepper_calendar_cron_secret'
    limit 1
  `;
  if (!presented || !rows[0]?.secret || !constantTimeEqual(presented, rows[0].secret)) {
    throw new HttpError(401, 'cron_unauthorized', 'Unauthorized.');
  }
}

async function runCron(req: Request) {
  await verifyCron(req);
  const connections = await sql<Connection[]>`
    select id, household_id, connected_by_member_id, provider_calendar_id,
      calendar_name, calendar_time_zone, scan_window_days, status, sync_status,
      last_attempt_at, last_synced_at, last_error
    from public.calendar_connections
    where provider = 'google' and status = 'connected'
  `;
  let scanned = 0;
  let failed = 0;
  for (const connection of connections) {
    try {
      const result = await syncConnection(connection, false);
      if (!result.skipped) scanned += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok: true, scanned, failed };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    if (!allowedOrigin(req)) return json(req, { error: 'Origin not allowed.' }, 403);
    return new Response(null, { status: 204, headers: responseHeaders(req) });
  }

  const url = new URL(req.url);
  console.log('[pepper-calendar] request', { method: req.method, path: url.pathname });
  if (req.method === 'GET' && url.pathname.endsWith('/health')) {
    return json(req, { ok: true, oauth_configured: oauthConfigured(), schema: 'calendar-v1', app_url: APP_URL });
  }
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) {
    return completeOAuth(url);
  }
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);
  if (!allowedOrigin(req)) return json(req, { error: 'Origin not allowed.' }, 403);

  try {
    const body = await req.json();
    if (body?.action === 'cron') return json(req, await runCron(req));

    const member = await memberFromSession(body?.session_token);
    if (body?.action === 'status') {
      const connection = await connectionForHousehold(member.household_id);
      return json(req, {
        ok: true,
        configured: oauthConfigured(),
        connected: connection?.status === 'connected',
        connection: connection
          ? {
              calendar_name: connection.calendar_name,
              status: connection.status,
              sync_status: connection.sync_status,
              scan_window_days: connection.scan_window_days,
              last_attempt_at: connection.last_attempt_at,
              last_synced_at: connection.last_synced_at,
              last_error: connection.last_error,
            }
          : null,
      });
    }
    if (body?.action === 'start') {
      const authorizationUrl = await beginOAuth(member, body?.return_target);
      return json(req, { ok: true, authorization_url: authorizationUrl });
    }
    if (body?.action === 'sync') {
      requireAdult(member);
      const connection = await connectionForHousehold(member.household_id);
      if (!connection) return json(req, { ok: true, connected: false, skipped: true });
      if (connection.status !== 'connected') {
        return json(req, { ok: false, connected: false, reconnect_required: true }, 409);
      }
      const result = await syncConnection(connection, Boolean(body.force));
      return json(req, { connected: true, ...result });
    }
    throw new HttpError(400, 'unknown_action', 'Unknown calendar action.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : 'calendar_request_failed';
    return json(req, { error: safeError(error), code }, status);
  }
});
