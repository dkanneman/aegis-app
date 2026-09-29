import postgres from 'npm:postgres@3.4.7';
import {
  activityKey,
  buildGoogleAppointmentPayload,
  calendarOperationFor,
  CalendarConnectionProbeError,
  calendarSetupAction,
  canonicalDedupeKey,
  classifyGoogleCalendarFailure,
  eventTime,
  GOOGLE_OAUTH_SCOPE,
  googleOAuthRedirectUri,
  googleEventIdForPepper,
  hasGoogleCalendarAppCreatedScope,
  isActiveGoogleEvent,
  isPepperManagedGoogleEvent,
  inferPerson,
  kindFor,
  PEPPER_CALENDAR_SETUP_METHOD,
  PEPPER_PRODUCTION_CALENDAR_NAME,
  PEPPER_TEST_CALENDAR_NAME,
  pepperCalendarMarker,
  pepperCalendarMode,
  requirementFor,
  runCalendarConnectionProbe,
  sharedWithHousehold,
  stripHtml,
  validateCalendarConnectionProof,
  validateCalendarResource,
  validateCreatedCalendar,
  validateCurrentGoogleIdentity,
  validateGoogleOidcClaims,
} from './logic.ts';
import { authorizeCalendarContribution } from '../_shared/calendar-contribution.ts';

const APP_URL = Deno.env.get('PEPPER_APP_URL') || 'https://pepper-family-beta.vercel.app/pepper';
const APP_ORIGIN = new URL(APP_URL).origin;
const FUNCTION_NAME = 'pepper-calendar';
const FAMILY_TIME_ZONE = 'America/Los_Angeles';
const GOOGLE_SCOPE = GOOGLE_OAUTH_SCOPE;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const DATABASE_URL = Deno.env.get('SUPABASE_DB_URL') || '';
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const GOOGLE_REDIRECT_URI = Deno.env.get('GOOGLE_REDIRECT_URI') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CALENDAR_MODE = pepperCalendarMode(Deno.env.get('PEPPER_CALENDAR_MODE'));
const GOOGLE_ACCOUNT_EMAIL = Deno.env.get('PEPPER_GOOGLE_ACCOUNT_EMAIL') || '';
const REDIRECT_URI = googleOAuthRedirectUri(SUPABASE_URL, GOOGLE_REDIRECT_URI, FUNCTION_NAME);
const DATABASE_SSL = Deno.env.get('PEPPER_DB_SSL') === 'disable' ? false : 'require';

if (!DATABASE_URL) throw new Error('SUPABASE_DB_URL is not configured.');

const sql = postgres(DATABASE_URL, {
  ssl: DATABASE_SSL,
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
  session_id: string;
  active: boolean;
  removed_at: string | null;
};

type Connection = {
  id: string;
  household_id: string;
  connected_by_member_id: string;
  provider_calendar_id: string;
  calendar_name: string | null;
  calendar_time_zone: string | null;
  access_scope?: string | null;
  calendar_setup_method: string | null;
  calendar_created_at: string | null;
  calendar_mode: string | null;
  pepper_installation_id: string | null;
  pepper_calendar_marker: string | null;
  google_account_email: string | null;
  google_account_subject: string | null;
  google_data_owner: string | null;
  calendar_probe_completed_at: string | null;
  calendar_probe_evidence: Record<string, unknown> | null;
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
  extendedProperties?: { private?: Record<string, string> };
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
    select m.id, m.household_id, m.slug, m.display_name, m.role,
      m.active, m.removed_at, s.session_id
    from public.member_sessions s
    join public.household_members m on m.id = s.member_id
    where s.token = ${token}::uuid
      and s.revoked_at is null
      and s.expires_at > now()
      and m.active = true
      and m.removed_at is null
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

function requireConfiguredGoogleAccountEmail() {
  const accountEmail = GOOGLE_ACCOUNT_EMAIL;
  if (!accountEmail.trim()) {
    throw new HttpError(
      503,
      `${CALENDAR_MODE}_calendar_account_email_not_configured`,
      `Pepper Calendar requires the configured ${CALENDAR_MODE} Google account identifier.`,
    );
  }
  return accountEmail.trim();
}

function requireStoredCalendar(
  connection: Connection,
  requestedCalendarId: string | null | undefined,
) {
  try {
    return validateCalendarConnectionProof(
      connection,
      CALENDAR_MODE,
      requireConfiguredGoogleAccountEmail(),
      requestedCalendarId,
    );
  } catch (error) {
    const code = String((error as Error)?.message || 'calendar_destination_rejected');
    throw new HttpError(
      ['calendar_id_missing', 'calendar_not_allowlisted', 'primary_calendar_rejected'].includes(code)
        ? 403 : 503,
      code,
      `Pepper Calendar writes are restricted to the configured ${CALENDAR_MODE} calendar.`,
    );
  }
}

function connectionHasAppCreatedCalendar(connection: Connection | null | undefined) {
  if (!connection) return false;
  try {
    requireStoredCalendar(connection, connection.provider_calendar_id);
    return Boolean(
      connection.calendar_probe_completed_at
      && connection.calendar_probe_evidence?.success === true,
    );
  } catch {
    return false;
  }
}

async function connectionForHousehold(householdId: string) {
  const rows = await sql<Connection[]>`
    select id, household_id, connected_by_member_id, provider_calendar_id,
      calendar_name, calendar_time_zone, access_scope, scan_window_days, status, sync_status,
      calendar_setup_method, calendar_created_at, calendar_mode, pepper_installation_id,
      pepper_calendar_marker, google_account_email, google_account_subject, google_data_owner,
      calendar_probe_completed_at, calendar_probe_evidence,
      last_attempt_at, last_synced_at, last_error
    from public.calendar_connections
    where household_id = ${householdId}::uuid and provider = 'google'
    limit 1
  `;
  return rows[0] || null;
}

async function beginOAuth(member: Member, returnTarget: unknown) {
  requireAdult(member);
  requireConfiguredGoogleAccountEmail();
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
      state_hash, code_verifier, household_id, member_id, initiating_session_id, return_target, expires_at
    ) values (
      ${stateHash}, ${verifier}, ${member.household_id}::uuid,
      ${member.id}::uuid, ${member.session_id}::uuid, ${return_target}, now() + interval '10 minutes'
    )
  `;

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', stateHash);
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

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJwtJson(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as Record<string, unknown>;
}

async function verifyGoogleIdToken(idToken: unknown, expectedAccountEmail: string, expectedNonce: string) {
  if (typeof idToken !== 'string') {
    throw new HttpError(409, 'google_identity_claim_missing', 'Google did not return a signed identity token.');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HttpError(403, 'google_identity_token_invalid', 'Google identity verification failed.');
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decodeJwtJson(parts[0]);
    claims = decodeJwtJson(parts[1]);
  } catch {
    throw new HttpError(403, 'google_identity_token_invalid', 'Google identity verification failed.');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new HttpError(403, 'google_identity_algorithm_invalid', 'Google identity verification failed.');
  }
  const jwks = await fetchGoogleJson(
    'https://www.googleapis.com/oauth2/v3/certs',
    {},
    'google_identity_keys_unavailable',
  );
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const jwk = keys.find((value) => (
    value && typeof value === 'object' && (value as Record<string, unknown>).kid === header.kid
  ));
  if (!jwk) throw new HttpError(403, 'google_identity_key_missing', 'Google identity verification failed.');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const validSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!validSignature) throw new HttpError(403, 'google_identity_signature_invalid', 'Google identity verification failed.');
  try {
    return validateGoogleOidcClaims(claims, {
      clientId: GOOGLE_CLIENT_ID,
      expectedAccountEmail,
      expectedNonce,
    });
  } catch (error) {
    throw new HttpError(403, String((error as Error).message), 'The authenticated Google account is not authorized for Pepper.');
  }
}

async function validateStoredCalendarAccess(
  connection: Connection,
  accessToken: string,
  requestedCalendarId: string | null | undefined,
  requireCompletedProbe = true,
) {
  if (requireCompletedProbe && (
    !connection.calendar_probe_completed_at
    || connection.calendar_probe_evidence?.success !== true
  )) {
    throw new HttpError(409, 'calendar_connection_probe_required', 'The Pepper Calendar connection probe is incomplete.');
  }
  const destination = requireStoredCalendar(connection, requestedCalendarId);
  const identityClaims = await fetchGoogleJson(
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { Authorization: `Bearer ${accessToken}` } },
    'google_identity_refresh_failed',
  );
  let currentIdentity;
  try {
    currentIdentity = validateCurrentGoogleIdentity(
      identityClaims,
      connection,
      requireConfiguredGoogleAccountEmail(),
    );
  } catch (error) {
    throw new HttpError(
      403,
      String((error as Error).message),
      'The current Google identity does not match the account that created this Pepper calendar.',
    );
  }
  const calendarResource = await fetchGoogleJson(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(destination.id)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    `${CALENDAR_MODE}_calendar_access_failed`,
  );
  try {
    return validateCalendarResource(calendarResource, destination, currentIdentity);
  } catch (error) {
    throw new HttpError(
      403,
      String((error as Error).message),
      `The stored calendar is not the exact ${destination.name} calendar created by this Pepper installation.`,
    );
  }
}

async function createPepperCalendar(accessToken: string, identity: { email: string; subject: string }) {
  const expectedName = CALENDAR_MODE === 'sandbox'
    ? PEPPER_TEST_CALENDAR_NAME
    : PEPPER_PRODUCTION_CALENDAR_NAME;
  const installationId = crypto.randomUUID();
  const marker = pepperCalendarMarker(installationId);
  const created = await fetchGoogleJson(
    'https://www.googleapis.com/calendar/v3/calendars',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: expectedName,
        description: marker,
        timeZone: FAMILY_TIME_ZONE,
      }),
    },
    'calendar_creation_failed',
  );
  try {
    return validateCreatedCalendar(created, CALENDAR_MODE, identity, installationId, marker);
  } catch (error) {
    throw new HttpError(502, String((error as Error).message), 'Google did not return the dedicated Pepper calendar.');
  }
}

async function deletePepperCalendar(accessToken: string, calendarId: string) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok && ![404, 410].includes(response.status)) {
    throw new HttpError(response.status, 'calendar_cleanup_failed', `Google Calendar returned ${response.status}.`);
  }
}

async function probePepperCalendar(
  accessToken: string,
  destination: ReturnType<typeof requireStoredCalendar>,
) {
  const endpointFor = (calendarId: string) => {
    if (calendarId !== destination.id) {
      throw new HttpError(403, 'calendar_probe_calendar_mismatch', 'The connection probe calendar does not match the stored Pepper calendar.');
    }
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  };
  return runCalendarConnectionProbe({
    create(calendarId, payload) {
      const endpoint = endpointFor(calendarId);
      return fetchGoogleJson(`${endpoint}?sendUpdates=none`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 'calendar_probe_create_failed');
    },
    async read(calendarId, eventId) {
      const endpoint = endpointFor(calendarId);
      try {
        const event = await fetchGoogleJson(`${endpoint}/${encodeURIComponent(eventId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }, 'calendar_probe_read_failed');
        return { calendarId, eventId, httpStatus: 200, event };
      } catch (error) {
        if (error instanceof HttpError && [404, 410].includes(error.status)) {
          return { calendarId, eventId, httpStatus: error.status, event: null };
        }
        throw error;
      }
    },
    async remove(calendarId, eventId) {
      const endpoint = endpointFor(calendarId);
      const response = await fetch(`${endpoint}/${encodeURIComponent(eventId)}?sendUpdates=none`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok && ![404, 410].includes(response.status)) {
        throw new HttpError(response.status, 'calendar_probe_delete_failed', `Google Calendar returned ${response.status}.`);
      }
    },
  }, destination);
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

type PublishableEvent = {
  id: string;
  household_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  preparation_instructions: string | null;
  clinician_name: string | null;
  facility_name: string | null;
  appointment_type: string | null;
  source_timezone: string | null;
  external_event_id: string | null;
  external_calendar_id: string | null;
  status: string;
  visibility: string;
  created_by_member_id: string | null;
  last_modified_by_member_id: string | null;
  last_modified_session_id: string | null;
  last_calendar_action_id: string | null;
  revision: number;
};

type CalendarMutationAuthorizationRow = {
  request_id: string;
  request_household_id: string;
  request_event_id: string;
  actor_member_id: string;
  actor_session_id: string | null;
  action: string;
  source: string;
  after_revision: number;
  member_household_id: string;
  role: string;
  active: boolean;
  removed_at: string | null;
};

async function authorizePublishedEvent(event: PublishableEvent, connection: Connection) {
  if (!event.last_calendar_action_id || !event.last_modified_by_member_id) {
    return { allowed: false as const, reason: 'calendar_mutation_evidence_missing' };
  }
  const rows = await sql<CalendarMutationAuthorizationRow[]>`
    select request.id as request_id,request.household_id as request_household_id,
      request.event_id as request_event_id,request.actor_member_id,request.actor_session_id,
      request.action,request.source,request.after_revision,
      member.household_id as member_household_id,member.role,member.active,member.removed_at
    from private.calendar_event_mutation_requests request
    join public.household_members member on member.id=request.actor_member_id
    where request.id=${event.last_calendar_action_id}::uuid
      and request.event_id=${event.id}::uuid
      and request.household_id=${event.household_id}::uuid
    limit 1
  `;
  const evidence = rows[0];
  if (!evidence) return { allowed: false as const, reason: 'calendar_mutation_evidence_invalid' };
  if (evidence.actor_member_id !== event.last_modified_by_member_id) {
    return { allowed: false as const, reason: 'calendar_actor_mismatch' };
  }
  if (evidence.source === 'pepper_session' && (
    !event.last_modified_session_id
    || evidence.actor_session_id !== event.last_modified_session_id
  )) {
    return { allowed: false as const, reason: 'calendar_session_mismatch' };
  }
  if (!['pepper_session', 'migration_backfill'].includes(evidence.source)) {
    return { allowed: false as const, reason: 'calendar_mutation_source_invalid' };
  }
  if (Number(evidence.after_revision) !== Number(event.revision)) {
    return { allowed: false as const, reason: 'calendar_event_revision_mismatch' };
  }
  if (event.status === 'canceled' && evidence.action !== 'cancel') {
    return { allowed: false as const, reason: 'calendar_cancel_evidence_missing' };
  }
  const decision = authorizeCalendarContribution({
    id: evidence.actor_member_id,
    household_id: evidence.member_household_id,
    role: evidence.role,
    session_id: evidence.actor_session_id || 'migration-backfill',
    active: evidence.active,
    removed_at: evidence.removed_at,
  }, event, connection);
  return decision.allowed
    ? { allowed: true as const, actorMemberId: evidence.actor_member_id }
    : { allowed: false as const, reason: decision.reason };
}

async function recordCalendarAudit(
  event: PublishableEvent,
  connection: Connection,
  captureId: string,
  eventType: string,
  summary: string,
) {
  await sql`
    insert into public.audit_log(
      household_id,actor_member_id,capture_id,event_type,entity_type,entity_id,summary
    ) values (
      ${event.household_id}::uuid,${event.last_modified_by_member_id || connection.connected_by_member_id}::uuid,
      nullif(${captureId},'')::uuid,${eventType},'event',${event.id},${summary.slice(0, 500)}
    )
  `;
}

async function mirrorCalendarDelivery(
  eventId: string,
  status: 'synced' | 'skipped' | 'needs_reconnect' | 'retry_required' | 'failed',
  error: string | null,
) {
  await sql`
    update private.appointment_bridge_deliveries set
      google_status=${status},last_error=${error},updated_at=now()
    where event_id=${eventId}::uuid
  `;
}

async function markCalendarNeedsReview(
  event: PublishableEvent,
  connection: Connection,
  captureId: string,
  reason: string,
) {
  const safeReason = safeError(reason);
  await sql`
    update public.events set
      sync_status='needs_review',last_sync_error=${safeReason},sync_retry_at=null,updated_at=now()
    where id=${event.id}::uuid and household_id=${event.household_id}::uuid
  `;
  await mirrorCalendarDelivery(event.id, 'needs_review', safeReason);
  await recordCalendarAudit(
    event,
    connection,
    captureId,
    'calendar_mutation_needs_review',
    safeReason,
  );
  return { ok: false, status: 'needs_review', retryable: false, reason: safeReason };
}

async function markCalendarFailure(
  event: PublishableEvent,
  connection: Connection,
  captureId: string,
  status: 'retry_required' | 'reconnect_required',
  reason: string,
) {
  const safeReason = safeError(reason);
  await sql.begin(async (transaction) => {
    await transaction`
      update public.events set
        sync_status=${status},last_sync_error=${safeReason},
        sync_retry_at=case when ${status}='retry_required' then now()+interval '15 minutes' else null end,
        updated_at=now()
      where id=${event.id}::uuid and household_id=${event.household_id}::uuid
    `;
    if (status === 'reconnect_required') {
      await transaction`
        update public.calendar_connections set
          status='reconnect_required',sync_status='error',last_error=${safeReason},updated_at=now()
        where id=${connection.id}::uuid
      `;
    }
  });
  await mirrorCalendarDelivery(
    event.id,
    status === 'reconnect_required' ? 'needs_reconnect' : 'retry_required',
    safeReason,
  );
  await recordCalendarAudit(
    event,
    connection,
    captureId,
    status === 'reconnect_required' ? 'calendar_reconnect_required' : 'calendar_sync_retry_required',
    safeReason,
  );
  return { ok: true, status, retryable: true, reason: safeReason, external_event_id: event.external_event_id };
}

async function findPepperGoogleEvent(
  endpoint: string,
  accessToken: string,
  event: PublishableEvent,
) {
  const deterministicId = googleEventIdForPepper(event.id);
  try {
    const direct = await fetchGoogleJson(`${endpoint}/${deterministicId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, 'calendar_reconcile_lookup_failed');
    if (typeof direct.id === 'string' && direct.status !== 'cancelled') return direct;
  } catch (error) {
    if (!(error instanceof HttpError) || ![404, 410].includes(error.status)) throw error;
  }

  const lookup = new URL(endpoint);
  lookup.searchParams.set('privateExtendedProperty', `pepperEventId=${event.id}`);
  lookup.searchParams.set('showDeleted', 'true');
  lookup.searchParams.set('singleEvents', 'true');
  lookup.searchParams.set('maxResults', '10');
  const listed = await fetchGoogleJson(lookup.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, 'calendar_reconcile_search_failed');
  const items = Array.isArray(listed.items) ? listed.items : [];
  return items.find((item) => (
    item && typeof item === 'object' && typeof item.id === 'string' && item.status !== 'cancelled'
  )) as Record<string, unknown> | undefined;
}

async function publishPepperEvent(eventId: string, captureId: string) {
  if (!UUID_PATTERN.test(eventId) || (captureId && !UUID_PATTERN.test(captureId))) {
    throw new HttpError(400, 'invalid_event', 'A valid event is required.');
  }
  const rows = await sql<PublishableEvent[]>`
    select event.id,event.household_id,event.title,event.starts_at,event.ends_at,event.location,
      event.notes,event.preparation_instructions,event.clinician_name,event.facility_name,
      event.appointment_type,event.source_timezone,event.external_event_id,
      event.external_calendar_id,event.status,event.visibility,event.created_by_member_id,
      event.last_modified_by_member_id,event.last_modified_session_id,
      event.last_calendar_action_id,event.revision
    from public.events event
    where event.id=${eventId}::uuid
      and event.deleted_at is null
      and (
        ${captureId}=''
        or exists (
          select 1 from public.captures capture
          where capture.id=nullif(${captureId},'')::uuid and capture.household_id=event.household_id
        )
      )
    limit 1
  `;
  const event = rows[0];
  if (!event) throw new HttpError(404, 'event_not_found', 'The appointment was not found.');
  const connection = await connectionForHousehold(event.household_id);
  if (!connection) {
    await sql`
      update public.events set sync_status='reconnect_required',
        last_sync_error='The household Pepper Calendar is not connected.',sync_retry_at=null,updated_at=now()
      where id=${event.id}::uuid and household_id=${event.household_id}::uuid
    `;
    return { ok: false, status: 'reconnect_required', retryable: true, reason: 'calendar_not_connected' };
  }
  const contribution = await authorizePublishedEvent(event, connection);
  if (!contribution.allowed) {
    return markCalendarNeedsReview(event, connection, captureId, contribution.reason);
  }
  if (connection.status !== 'connected' || !connectionHasAppCreatedCalendar(connection)) {
    return markCalendarFailure(
      event,
      connection,
      captureId,
      'reconnect_required',
      'Reconnect Google Calendar so Pepper can update existing appointments.',
    );
  }
  await sql`
    update public.events set
      sync_status='syncing',last_sync_error=null,sync_retry_at=null,
      sync_attempt_count=coalesce(sync_attempt_count,0)+1,updated_at=now()
    where id=${event.id}::uuid and household_id=${event.household_id}::uuid
  `;

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(connection.id);
  } catch (error) {
    return markCalendarFailure(event, connection, captureId, 'reconnect_required', safeError(error));
  }

  let calendarId: string;
  try {
    const calendarMetadata = await validateStoredCalendarAccess(
      connection,
      accessToken,
      event.external_calendar_id || connection.provider_calendar_id,
    );
    calendarId = calendarMetadata.id;
  } catch (error) {
    const retryable = error instanceof HttpError && (error.status === 429 || error.status >= 500);
    return markCalendarFailure(
      event,
      connection,
      captureId,
      retryable ? 'retry_required' : 'reconnect_required',
      safeError(error),
    );
  }

  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const operation = calendarOperationFor(event);
  const updatePayload = buildGoogleAppointmentPayload(event, captureId || null, false, CALENDAR_MODE);
  const createPayload = buildGoogleAppointmentPayload(event, captureId || null, true, CALENDAR_MODE);
  let googleEvent: Record<string, unknown> = {};
  let replayed = operation.kind !== 'create';
  let reconciledExternalId = false;

  try {
    if (operation.kind === 'skip_cancel') {
      await sql`
        update public.events set sync_status='removed',last_sync_error=null,sync_retry_at=null,
          last_synced_at=now(),updated_at=now()
        where id=${event.id}::uuid
      `;
      await mirrorCalendarDelivery(event.id, 'skipped', null);
      await recordCalendarAudit(event, connection, captureId, 'calendar_cancel_skipped', 'No Google event had been created for the canceled appointment.');
      return { ok: true, status: 'synced', replayed: true, reason: 'calendar_event_not_created' };
    }

    if (operation.kind === 'cancel') {
      let externalId = operation.externalEventId;
      let response = await fetch(`${endpoint}/${encodeURIComponent(externalId)}?sendUpdates=none`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20_000),
      });
      if ([404, 410].includes(response.status)) {
        const found = await findPepperGoogleEvent(endpoint, accessToken, event);
        if (found && typeof found.id === 'string') {
          externalId = found.id;
          reconciledExternalId = externalId !== operation.externalEventId;
          response = await fetch(`${endpoint}/${encodeURIComponent(externalId)}?sendUpdates=none`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(20_000),
          });
        }
      }
      if (!response.ok && ![404, 410].includes(response.status)) {
        throw new HttpError(response.status, 'calendar_cancel_failed', `Google Calendar returned ${response.status}.`);
      }
      await sql`
        update public.events set external_event_id=${externalId},sync_status='removed',
          last_sync_error=null,sync_retry_at=null,last_synced_at=now(),updated_at=now()
        where id=${event.id}::uuid and household_id=${event.household_id}::uuid
      `;
      await mirrorCalendarDelivery(event.id, 'synced', null);
      await recordCalendarAudit(event, connection, captureId, 'calendar_event_canceled', `Canceled Google event ${externalId}.`);
      return { ok: true, status: 'synced', replayed: true, external_event_id: externalId };
    }

    if (operation.kind === 'update') {
      try {
        googleEvent = await fetchGoogleJson(`${endpoint}/${encodeURIComponent(operation.externalEventId)}?sendUpdates=none`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        }, 'calendar_update_failed');
      } catch (error) {
        if (!(error instanceof HttpError) || ![404, 410].includes(error.status)) throw error;
        const found = await findPepperGoogleEvent(endpoint, accessToken, event);
        if (!found || typeof found.id !== 'string') {
          return markCalendarFailure(
            event,
            connection,
            captureId,
            'retry_required',
            'The linked Google event is missing. Pepper did not create a replacement; reconnect or retry after reconciling the calendar event.',
          );
        }
        reconciledExternalId = found.id !== operation.externalEventId;
        googleEvent = await fetchGoogleJson(`${endpoint}/${encodeURIComponent(found.id)}?sendUpdates=none`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        }, 'calendar_update_reconciled_event_failed');
      }
    } else {
      try {
        googleEvent = await fetchGoogleJson(`${endpoint}?sendUpdates=none`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload),
        }, 'calendar_publish_failed');
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
        replayed = true;
        const existing = await findPepperGoogleEvent(endpoint, accessToken, event);
        if (!existing || typeof existing.id !== 'string') throw error;
        googleEvent = await fetchGoogleJson(`${endpoint}/${encodeURIComponent(existing.id)}?sendUpdates=none`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        }, 'calendar_replay_update_failed');
      }
    }
  } catch (error) {
    const failure = classifyGoogleCalendarFailure(error instanceof HttpError ? error.status : 500);
    return markCalendarFailure(
      event,
      connection,
      captureId,
      failure.reconnectRequired ? 'reconnect_required' : 'retry_required',
      safeError(error),
    );
  }

  if (!isActiveGoogleEvent(googleEvent)) {
    return markCalendarFailure(
      event,
      connection,
      captureId,
      'retry_required',
      'The linked Google event was deleted outside Pepper. Pepper did not create a replacement; reconcile the calendar event before retrying.',
    );
  }

  const externalId = typeof googleEvent.id === 'string'
    ? googleEvent.id
    : event.external_event_id || googleEventIdForPepper(event.id);
  await sql`
    update public.events set
      external_connection_id=${connection.id}::uuid,external_provider='google',
      external_event_id=${externalId},external_calendar_id=${calendarId},
      external_ical_uid=${typeof googleEvent.iCalUID === 'string' ? googleEvent.iCalUID : null},
      external_url=${typeof googleEvent.htmlLink === 'string' ? googleEvent.htmlLink : null},
      external_updated_at=${typeof googleEvent.updated === 'string' ? googleEvent.updated : null}::timestamptz,
      sync_status='synced',last_sync_error=null,sync_retry_at=null,
      last_synced_at=now(),updated_at=now()
    where id=${event.id}::uuid and household_id=${event.household_id}::uuid
  `;
  await mirrorCalendarDelivery(event.id, 'synced', null);
  await recordCalendarAudit(
    event,
    connection,
    captureId,
    reconciledExternalId ? 'calendar_event_reconciled_and_updated' : replayed ? 'calendar_event_updated' : 'calendar_event_created',
    `${replayed ? 'Updated' : 'Created'} Google event ${externalId}.`,
  );
  return { ok: true, status: 'synced', replayed, reconciled_external_id: reconciledExternalId, external_event_id: externalId };
}

type OAuthInitiator = { initiating_session_id: string | null; member_id: string; household_id: string };

async function requireOAuthInitiator(transaction: postgres.TransactionSql, state: OAuthInitiator) {
  // Locks serialize revocation/member changes with the protected operation. A
  // fresh clock check also rejects expiry after a lock wait or provider request.
  const rows = await transaction<{ expires_at: Date }[]>`
    select s.expires_at from public.member_sessions s
    join public.household_members m on m.id = s.member_id
    where s.session_id = ${state.initiating_session_id}::uuid
      and m.id = ${state.member_id}::uuid
      and m.household_id = ${state.household_id}::uuid
      and s.revoked_at is null and m.active = true and m.removed_at is null
      and m.role in ('adult_admin', 'adult')
    for share of s, m
  `;
  const valid = rows[0] && await transaction<{ valid: boolean }[]>`
    select ${rows[0].expires_at}::timestamptz > clock_timestamp() as valid
  `;
  if (!valid?.[0]?.valid) {
    throw new HttpError(403, 'oauth_initiator_unauthorized', 'The initiating Pepper session is no longer authorized. Start again from an active adult session.');
  }
}

async function completeOAuth(reqUrl: URL) {
  const state = reqUrl.searchParams.get('state') || '';
  const stateHash = state ? await digest(state) : '';
  const stateRows = await sql<{
    code_verifier: string;
    household_id: string;
    member_id: string;
    initiating_session_id: string | null;
    return_target: string;
  }[]>`
    update private.calendar_oauth_states
    set consumed_at = now()
    where state_hash = ${stateHash}
      and consumed_at is null
      and expires_at > now()
    returning code_verifier, household_id, member_id, initiating_session_id, return_target
  `;
  const oauthState = stateRows[0];
  if (!oauthState) return redirectToApp('error', 'invalid_state');

  const oauthError = reqUrl.searchParams.get('error');
  if (oauthError) return redirectToApp('error', oauthError, oauthState.return_target);
  const code = reqUrl.searchParams.get('code');
  if (!code || !oauthConfigured()) return redirectToApp('error', 'oauth_not_configured', oauthState.return_target);

  let cleanupAccessToken = '';
  let newlyCreatedCalendarId = '';
  try {
    const token = await sql.begin(async (transaction) => {
      await requireOAuthInitiator(transaction, oauthState);
      return await exchangeCode(code, oauthState.code_verifier);
    });
    const accessToken = String(token.access_token || '');
    if (!accessToken) throw new HttpError(502, 'access_token_missing', 'Google did not return an access token.');
    cleanupAccessToken = accessToken;

    const grantedScope = typeof token.scope === 'string' ? token.scope : '';
    if (!hasGoogleCalendarAppCreatedScope(grantedScope)) {
      throw new HttpError(409, 'calendar_app_created_scope_required', 'Google did not grant Pepper-only calendar access.');
    }
    const accountEmail = requireConfiguredGoogleAccountEmail();
    const identity = await verifyGoogleIdToken(token.id_token, accountEmail, stateHash);
    let connection = await connectionForHousehold(oauthState.household_id);

    let setupAction: ReturnType<typeof calendarSetupAction>;
    try {
      setupAction = calendarSetupAction(connection);
    } catch (error) {
      throw new HttpError(409, String((error as Error).message), 'The stored calendar setup cannot be trusted.');
    }
    if (setupAction === 'reuse' && connection) {
      requireStoredCalendar(connection, connection.provider_calendar_id);
      if (connection.google_account_subject !== identity.subject) {
        throw new HttpError(403, 'google_account_mismatch', 'The stored calendar belongs to a different Google identity.');
      }
    } else {
      connection = await sql.begin(async (transaction) => {
        await requireOAuthInitiator(transaction, oauthState);
        const createdCalendar = await createPepperCalendar(accessToken, identity);
        newlyCreatedCalendarId = createdCalendar.id;
        await requireOAuthInitiator(transaction, oauthState);
        const pendingRows = await transaction<Connection[]>`
          insert into public.calendar_connections (
            household_id, connected_by_member_id, provider, provider_calendar_id,
            calendar_name, calendar_time_zone, access_scope, calendar_setup_method,
            calendar_created_at, calendar_mode, pepper_installation_id, pepper_calendar_marker,
            google_account_email, google_account_subject, google_data_owner,
            calendar_probe_completed_at, calendar_probe_evidence,
            status, sync_status, scan_window_days, last_error, updated_at
          ) values (
            ${oauthState.household_id}::uuid, ${oauthState.member_id}::uuid,
            'google', ${createdCalendar.id}, ${createdCalendar.name}, ${FAMILY_TIME_ZONE},
            ${grantedScope}, ${PEPPER_CALENDAR_SETUP_METHOD}, now(),
            ${CALENDAR_MODE}, ${createdCalendar.installationId}::uuid, ${createdCalendar.marker},
            ${identity.email.toLowerCase()}, ${identity.subject}, ${createdCalendar.dataOwner?.toLowerCase()},
            null, null, 'error', 'never', 14,
            'Calendar setup pending exact-ID validation and connection probe.', now()
          )
          on conflict (household_id, provider) do update set
            connected_by_member_id = excluded.connected_by_member_id,
            provider_calendar_id = excluded.provider_calendar_id,
            calendar_name = excluded.calendar_name,
            calendar_time_zone = excluded.calendar_time_zone,
            access_scope = excluded.access_scope,
            calendar_setup_method = excluded.calendar_setup_method,
            calendar_created_at = excluded.calendar_created_at,
            calendar_mode = excluded.calendar_mode,
            pepper_installation_id = excluded.pepper_installation_id,
            pepper_calendar_marker = excluded.pepper_calendar_marker,
            google_account_email = excluded.google_account_email,
            google_account_subject = excluded.google_account_subject,
            google_data_owner = excluded.google_data_owner,
            calendar_probe_completed_at = null,
            calendar_probe_evidence = null,
            status = 'error', sync_status = 'never',
            last_error = excluded.last_error, updated_at = now()
          returning id, household_id, connected_by_member_id, provider_calendar_id,
            calendar_name, calendar_time_zone, access_scope, calendar_setup_method,
            calendar_created_at, calendar_mode, pepper_installation_id, pepper_calendar_marker,
            google_account_email, google_account_subject, google_data_owner,
            calendar_probe_completed_at, calendar_probe_evidence,
            scan_window_days, status, sync_status, last_attempt_at, last_synced_at, last_error
        `;
        return pendingRows[0];
      });
    }
    if (!connection) throw new HttpError(500, 'calendar_connection_missing', 'Pepper could not store the calendar destination.');

    const calendarMetadata = await validateStoredCalendarAccess(
      connection,
      accessToken,
      connection.provider_calendar_id,
      false,
    );
    const calendarId = calendarMetadata.id;
    const calendarName = calendarMetadata.name;
    const calendarTimeZone = calendarMetadata.timeZone || FAMILY_TIME_ZONE;
    const destination = requireStoredCalendar(connection, calendarId);
    const probeEvidence = connection.calendar_probe_completed_at
      && connection.calendar_probe_evidence?.success === true
      ? connection.calendar_probe_evidence
      : await probePepperCalendar(accessToken, destination);

    connection = await sql.begin(async (transaction) => {
      await requireOAuthInitiator(transaction, oauthState);
      const rows = await transaction<Connection[]>`
        update public.calendar_connections set
          connected_by_member_id = ${oauthState.member_id}::uuid,
          provider_calendar_id = ${calendarId}, calendar_name = ${calendarName},
          calendar_time_zone = ${calendarTimeZone}, access_scope = ${grantedScope},
          calendar_setup_method = ${PEPPER_CALENDAR_SETUP_METHOD},
          google_account_email = ${identity.email.toLowerCase()}, google_account_subject = ${identity.subject},
          google_data_owner = ${calendarMetadata.dataOwner.toLowerCase()},
          calendar_mode = ${CALENDAR_MODE},
          calendar_probe_completed_at = now(),
          calendar_probe_evidence = ${transaction.json(probeEvidence)}::jsonb,
          status = 'connected',
          sync_status = case when last_synced_at is null then 'never' else sync_status end,
          last_error = null, updated_at = now()
        where id = ${connection.id}::uuid
        returning id, household_id, connected_by_member_id, provider_calendar_id,
          calendar_name, calendar_time_zone, access_scope, calendar_setup_method,
          calendar_created_at, calendar_mode, pepper_installation_id, pepper_calendar_marker,
          google_account_email, google_account_subject, google_data_owner,
          calendar_probe_completed_at, calendar_probe_evidence,
          scan_window_days, status, sync_status,
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
          ${`${calendarName} Google Calendar connected.`}
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
    if (newlyCreatedCalendarId && cleanupAccessToken) {
      let cleanupFailed = false;
      try {
        await deletePepperCalendar(cleanupAccessToken, newlyCreatedCalendarId);
      } catch {
        cleanupFailed = true;
      }
      const failure = error instanceof CalendarConnectionProbeError && error.cleanupFailed
        ? `${safeError(error)}; synthetic event cleanup failed.`
        : safeError(error);
      if (cleanupFailed) {
        await sql`
          update public.calendar_connections set
            status='error', sync_status='error',
            last_error=${`${failure}; dedicated calendar cleanup failed.`.slice(0, 500)}, updated_at=now()
          where household_id=${oauthState.household_id}::uuid and provider='google'
        `;
      } else {
        await sql`
          update public.calendar_connections set
            provider_calendar_id='', calendar_name=null, calendar_time_zone=null,
            access_scope='', calendar_setup_method=null, calendar_created_at=null,
            calendar_mode=null, pepper_installation_id=null, pepper_calendar_marker=null,
            google_account_email=null, google_account_subject=null, google_data_owner=null,
            calendar_probe_completed_at=null, calendar_probe_evidence=null,
            status='error', sync_status='error', last_error=${failure}, updated_at=now()
          where household_id=${oauthState.household_id}::uuid and provider='google'
        `;
      }
    }
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

async function googleEvents(accessToken: string, calendarId: string, from: Date, to: Date) {
  const items: GoogleEvent[] = [];
  let pageToken = '';
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
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
    if (Array.isArray(page.items)) {
      items.push(...(page.items as GoogleEvent[]).filter((event) => (
        isPepperManagedGoogleEvent(event as Record<string, unknown>, CALENDAR_MODE)
      )));
    }
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
  requireStoredCalendar(connectionInput, connectionInput.provider_calendar_id);
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
      calendar_name, calendar_time_zone, access_scope, calendar_setup_method,
      calendar_created_at, calendar_mode, pepper_installation_id, pepper_calendar_marker,
      google_account_email, google_account_subject, google_data_owner,
      calendar_probe_completed_at, calendar_probe_evidence,
      scan_window_days, status, sync_status,
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
    const calendarMetadata = await validateStoredCalendarAccess(
      connection,
      accessToken,
      connection.provider_calendar_id,
    );
    const [events, members] = await Promise.all([
      googleEvents(accessToken, calendarMetadata.id, from, to),
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
    const connectionStatus = error instanceof HttpError
      && [401, 403, 404, 409, 410].includes(error.status)
      ? 'reconnect_required'
      : ['token_refresh_failed', 'refresh_token_missing'].includes(code) ? 'error' : 'connected';
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
      calendar_name, calendar_time_zone, access_scope, calendar_setup_method,
      calendar_created_at, calendar_mode, pepper_installation_id, pepper_calendar_marker,
      google_account_email, google_account_subject, google_data_owner,
      calendar_probe_completed_at, calendar_probe_evidence,
      scan_window_days, status, sync_status,
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
  const retryRows = await sql<Array<{ id: string; capture_id: string | null }>>`
    select event.id,
      (
        select delivery.capture_id::text
        from private.appointment_bridge_deliveries delivery
        where delivery.event_id=event.id
        order by delivery.updated_at desc
        limit 1
      ) as capture_id
    from public.events event
    where event.deleted_at is null
      and event.sync_status='retry_required'
      and event.sync_retry_at is not null
      and event.sync_retry_at<=now()
    order by event.sync_retry_at,event.updated_at
    limit 50
  `;
  let appointmentRetries = 0;
  let appointmentRetryFailures = 0;
  for (const event of retryRows) {
    try {
      const result = await publishPepperEvent(event.id, event.capture_id || '');
      if (result.status === 'synced' || result.status === 'skipped') appointmentRetries += 1;
      else appointmentRetryFailures += 1;
    } catch {
      appointmentRetryFailures += 1;
    }
  }
  return {
    ok: true,
    scanned,
    failed,
    appointment_retries: appointmentRetries,
    appointment_retry_failures: appointmentRetryFailures,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    if (!allowedOrigin(req)) return json(req, { error: 'Origin not allowed.' }, 403);
    return new Response(null, { status: 204, headers: responseHeaders(req) });
  }

  const url = new URL(req.url);
  console.log('[pepper-calendar] request', { method: req.method, path: url.pathname });
  if (req.method === 'GET' && url.pathname.endsWith('/health')) {
    return json(req, {
      ok: true,
      oauth_configured: oauthConfigured(),
      google_account_configured: Boolean(GOOGLE_ACCOUNT_EMAIL.trim()),
      destination_strategy: 'app_created_stored_id',
      calendar_mode: CALENDAR_MODE,
      schema: 'calendar-v3',
      app_url: APP_URL,
    });
  }
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) {
    return completeOAuth(url);
  }
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);
  if (!allowedOrigin(req)) return json(req, { error: 'Origin not allowed.' }, 403);

  try {
    const body = await req.json();
    if (body?.action === 'cron') return json(req, await runCron(req));
    if (body?.action === 'publish_event') {
      const serviceToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!SERVICE_ROLE_KEY || !constantTimeEqual(serviceToken, SERVICE_ROLE_KEY)) {
        throw new HttpError(403, 'service_authorization_required', 'Server authorization required.');
      }
      return json(req, await publishPepperEvent(String(body.event_id || ''), String(body.capture_id || '')));
    }

    const member = await memberFromSession(body?.session_token);
    if (body?.action === 'status') {
      const connection = await connectionForHousehold(member.household_id);
      return json(req, {
        ok: true,
        configured: oauthConfigured(),
        connected: connection?.status === 'connected'
          && connectionHasAppCreatedCalendar(connection),
        reconnect_required: Boolean(connection) && (
          connection.status === 'reconnect_required'
          || !connectionHasAppCreatedCalendar(connection)
        ),
        connection: connection
          ? {
              calendar_name: connection.calendar_name,
              access_scope: connection.access_scope,
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
      if (connection.status !== 'connected'
        || !connectionHasAppCreatedCalendar(connection)) {
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
