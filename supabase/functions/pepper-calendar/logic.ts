export type CalendarEventLike = {
  visibility?: string;
};

export type MemberLike = {
  slug: string;
  display_name: string;
};

export type EventDateLike = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

export const GOOGLE_CALENDAR_APP_CREATED_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const GOOGLE_OIDC_EMAIL_SCOPE = 'email';
export const GOOGLE_OIDC_OPENID_SCOPE = 'openid';
export const GOOGLE_OAUTH_SCOPE = [
  GOOGLE_OIDC_OPENID_SCOPE,
  GOOGLE_OIDC_EMAIL_SCOPE,
  GOOGLE_CALENDAR_APP_CREATED_SCOPE,
].join(' ');
export const PEPPER_CALENDAR_SETUP_METHOD = 'google_calendars_insert_v1';
export const PEPPER_CALENDAR_MARKER_PREFIX = 'Managed by Pepper | installation:';
export const PEPPER_CONNECTION_PROBE_TITLE = '[PEPPER CONNECTION TEST]';
export const PEPPER_TEST_EVENT_PREFIX = '[PEPPER TEST]';
export const PEPPER_TEST_CALENDAR_NAME = 'Pepper Sandbox';
export const PEPPER_PRODUCTION_CALENDAR_NAME = 'Pepper Family';

export type PepperCalendarMode = 'sandbox' | 'production';

export type PepperCalendarDestination = {
  mode: PepperCalendarMode;
  id: string;
  name: string;
  installationId?: string;
  marker?: string;
  dataOwner?: string;
  accountEmail?: string;
  accountSubject?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function googleOAuthRedirectUri(
  supabaseUrl: string,
  configuredRedirectUri: string | null | undefined,
  functionName = 'pepper-calendar',
) {
  const fallback = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${functionName}/callback`;
  const candidate = String(configuredRedirectUri || '').trim() || fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('google_oauth_redirect_uri_invalid');
  }
  const loopbackHttp = parsed.protocol === 'http:'
    && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('google_oauth_redirect_uri_insecure');
  }
  if (!parsed.pathname.endsWith(`/functions/v1/${functionName}/callback`)) {
    throw new Error('google_oauth_redirect_uri_path_invalid');
  }
  return parsed.toString();
}

export function pepperCalendarMode(value: unknown): PepperCalendarMode {
  const mode = String(value || '').trim();
  if (mode !== 'sandbox' && mode !== 'production') {
    throw new Error('calendar_mode_not_configured');
  }
  return mode;
}

export function storedCalendarDestination(
  mode: PepperCalendarMode,
  storedCalendarId: string | null | undefined,
  requestedCalendarId: string | null | undefined,
): PepperCalendarDestination {
  const configuredCalendarId = typeof storedCalendarId === 'string' ? storedCalendarId : '';
  const requestedId = typeof requestedCalendarId === 'string' ? requestedCalendarId : '';
  const expectedName = mode === 'sandbox'
    ? PEPPER_TEST_CALENDAR_NAME
    : PEPPER_PRODUCTION_CALENDAR_NAME;
  if (!configuredCalendarId.trim()) {
    throw new Error(`${mode}_calendar_not_configured`);
  }
  if (configuredCalendarId !== configuredCalendarId.trim()) {
    throw new Error(`${mode}_calendar_id_invalid`);
  }
  if (configuredCalendarId.toLowerCase() === 'primary') {
    throw new Error('primary_calendar_rejected');
  }
  if (!requestedId.trim()) {
    throw new Error('calendar_id_missing');
  }
  if (requestedId.toLowerCase() === 'primary') {
    throw new Error('primary_calendar_rejected');
  }
  if (requestedId !== configuredCalendarId) {
    throw new Error('calendar_not_allowlisted');
  }
  return { mode, id: configuredCalendarId, name: expectedName };
}

export type PepperCalendarConnectionProof = {
  provider_calendar_id?: string | null;
  calendar_name?: string | null;
  calendar_setup_method?: string | null;
  calendar_created_at?: string | null;
  calendar_mode?: string | null;
  pepper_installation_id?: string | null;
  pepper_calendar_marker?: string | null;
  google_account_email?: string | null;
  google_account_subject?: string | null;
  google_data_owner?: string | null;
  access_scope?: string | null;
  calendar_probe_completed_at?: string | null;
  calendar_probe_evidence?: Record<string, unknown> | null;
};

export type GoogleIdentity = {
  email: string;
  subject: string;
};

export function pepperCalendarMarker(installationId: string) {
  const normalized = String(installationId || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error('calendar_installation_id_invalid');
  return `${PEPPER_CALENDAR_MARKER_PREFIX}${normalized}`;
}

export function calendarConnectionProbeEventId(installationId: string) {
  const normalized = String(installationId || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error('calendar_installation_id_invalid');
  return `pepperprobe${normalized.replaceAll('-', '')}`;
}

export function calendarSetupAction(connection: PepperCalendarConnectionProof | null | undefined) {
  if (!connection || !connection.calendar_setup_method) return 'create' as const;
  if (connection.calendar_setup_method === PEPPER_CALENDAR_SETUP_METHOD) return 'reuse' as const;
  throw new Error('calendar_creation_proof_invalid');
}

export function hasGoogleCalendarAppCreatedScope(scope: unknown) {
  const scopes = new Set(String(scope || '').split(/\s+/).filter(Boolean).map((value) => (
    value === 'https://www.googleapis.com/auth/userinfo.email' ? GOOGLE_OIDC_EMAIL_SCOPE : value
  )));
  return scopes.size === 3
    && scopes.has(GOOGLE_OIDC_OPENID_SCOPE)
    && scopes.has(GOOGLE_OIDC_EMAIL_SCOPE)
    && scopes.has(GOOGLE_CALENDAR_APP_CREATED_SCOPE);
}

export function validateCalendarConnectionProof(
  connection: PepperCalendarConnectionProof,
  mode: PepperCalendarMode,
  expectedAccountEmail: string,
  requestedCalendarId: string | null | undefined,
) {
  const accountEmail = String(expectedAccountEmail || '').trim();
  if (!accountEmail) throw new Error(`${mode}_calendar_account_email_not_configured`);
  if (connection.calendar_setup_method !== PEPPER_CALENDAR_SETUP_METHOD
      || !connection.calendar_created_at
      || !String(connection.google_account_subject || '').trim()
      || !String(connection.google_data_owner || '').trim()
      || !String(connection.pepper_installation_id || '').trim()
      || !String(connection.pepper_calendar_marker || '').trim()) {
    throw new Error('calendar_creation_proof_missing');
  }
  if (connection.calendar_mode !== mode) throw new Error('calendar_mode_mismatch');
  if (String(connection.google_account_email || '').trim().toLowerCase() !== accountEmail.toLowerCase()) {
    throw new Error('google_account_mismatch');
  }
  if (String(connection.google_data_owner || '').trim().toLowerCase() !== accountEmail.toLowerCase()) {
    throw new Error('calendar_data_owner_mismatch');
  }
  if (!hasGoogleCalendarAppCreatedScope(connection.access_scope)) {
    throw new Error('calendar_app_created_scope_required');
  }
  const destination = storedCalendarDestination(
    mode,
    connection.provider_calendar_id,
    requestedCalendarId,
  );
  if (destination.id.toLowerCase() === accountEmail.toLowerCase()) {
    throw new Error(`${mode}_calendar_account_id_rejected`);
  }
  if (String(connection.calendar_name || '').trim() !== destination.name) {
    throw new Error(`${mode}_calendar_name_mismatch`);
  }
  const installationId = String(connection.pepper_installation_id || '').trim().toLowerCase();
  if (String(connection.pepper_calendar_marker || '').trim() !== pepperCalendarMarker(installationId)) {
    throw new Error('calendar_installation_marker_invalid');
  }
  return {
    ...destination,
    installationId,
    marker: pepperCalendarMarker(installationId),
    dataOwner: String(connection.google_data_owner || '').trim(),
    accountEmail: String(connection.google_account_email || '').trim(),
    accountSubject: String(connection.google_account_subject || '').trim(),
  };
}

export function validateCreatedCalendar(
  calendar: Record<string, unknown>,
  mode: PepperCalendarMode,
  identity: GoogleIdentity,
  installationId: string,
  marker: string,
) {
  const id = String(calendar.id || '').trim();
  const accountEmail = String(identity.email || '').trim();
  const accountSubject = String(identity.subject || '').trim();
  const dataOwner = String(calendar.dataOwner || '').trim();
  const expectedName = mode === 'sandbox' ? PEPPER_TEST_CALENDAR_NAME : PEPPER_PRODUCTION_CALENDAR_NAME;
  if (!id) throw new Error('calendar_creation_id_missing');
  if (!accountEmail || !accountSubject) throw new Error('google_identity_claim_missing');
  if (id.toLowerCase() === 'primary') throw new Error('primary_calendar_rejected');
  if (id.toLowerCase() === accountEmail.toLowerCase()) {
    throw new Error(`${mode}_calendar_account_id_rejected`);
  }
  if (String(calendar.summary || '').trim() !== expectedName) {
    throw new Error(`${mode}_calendar_name_mismatch`);
  }
  if (String(calendar.description || '').trim() !== marker
      || marker !== pepperCalendarMarker(installationId)) {
    throw new Error('calendar_installation_marker_mismatch');
  }
  if (!dataOwner) throw new Error('calendar_data_owner_missing');
  if (dataOwner.toLowerCase() !== accountEmail.toLowerCase()) {
    throw new Error('calendar_data_owner_mismatch');
  }
  return {
    mode,
    id,
    name: expectedName,
    installationId: installationId.toLowerCase(),
    marker,
    dataOwner,
    accountEmail,
    accountSubject,
  } satisfies PepperCalendarDestination;
}

export type GoogleOidcClaims = {
  aud?: unknown;
  email?: unknown;
  email_verified?: unknown;
  exp?: unknown;
  iss?: unknown;
  nonce?: unknown;
  sub?: unknown;
};

export function validateGoogleOidcClaims(
  claims: GoogleOidcClaims,
  options: {
    clientId: string;
    expectedAccountEmail: string;
    expectedNonce: string;
    nowEpochSeconds?: number;
  },
) {
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const email = typeof claims.email === 'string' ? claims.email.trim() : '';
  const subject = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  const now = options.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(String(claims.iss || ''))) {
    throw new Error('google_identity_issuer_invalid');
  }
  if (!options.clientId || !audience.includes(options.clientId)) {
    throw new Error('google_identity_audience_invalid');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= now) {
    throw new Error('google_identity_expired');
  }
  if (!options.expectedNonce || claims.nonce !== options.expectedNonce) {
    throw new Error('google_identity_nonce_invalid');
  }
  if (!email || !subject || claims.email_verified !== true) {
    throw new Error('google_identity_claim_missing');
  }
  if (email.toLowerCase() !== options.expectedAccountEmail.trim().toLowerCase()) {
    throw new Error('google_account_mismatch');
  }
  return { email, subject };
}

export function validateCurrentGoogleIdentity(
  claims: Record<string, unknown>,
  connection: PepperCalendarConnectionProof,
  expectedAccountEmail: string,
) {
  const email = String(claims.email || '').trim();
  const subject = String(claims.sub || claims.subject || '').trim();
  if (!email || !subject || claims.email_verified !== true) {
    throw new Error('google_identity_claim_missing');
  }
  if (email.toLowerCase() !== String(expectedAccountEmail || '').trim().toLowerCase()
      || email.toLowerCase() !== String(connection.google_account_email || '').trim().toLowerCase()
      || subject !== String(connection.google_account_subject || '').trim()) {
    throw new Error('google_account_mismatch');
  }
  return { email, subject } satisfies GoogleIdentity;
}

export function validateCalendarResource(
  calendar: Record<string, unknown>,
  destination: PepperCalendarDestination,
  currentIdentity: GoogleIdentity,
) {
  const id = String(calendar.id || '').trim();
  const name = String(calendar.summary || '').trim();
  const description = String(calendar.description || '').trim();
  const dataOwner = String(calendar.dataOwner || '').trim();
  const accountEmail = String(currentIdentity.email || '').trim();
  const accountSubject = String(currentIdentity.subject || '').trim();
  if (!id || !name || !description || !dataOwner) throw new Error('calendar_resource_metadata_missing');
  if (!accountEmail || !accountSubject) throw new Error('google_identity_claim_missing');
  if (id !== destination.id) throw new Error('calendar_resource_id_mismatch');
  if (id.toLowerCase() === 'primary') throw new Error('primary_calendar_rejected');
  if (id.toLowerCase() === accountEmail.toLowerCase()) {
    throw new Error(`${destination.mode}_calendar_account_id_rejected`);
  }
  if (name !== destination.name) throw new Error(`${destination.mode}_calendar_name_mismatch`);
  if (!destination.marker || description !== destination.marker) {
    throw new Error('calendar_installation_marker_mismatch');
  }
  if (!destination.dataOwner || dataOwner.toLowerCase() !== destination.dataOwner.toLowerCase()
      || dataOwner.toLowerCase() !== accountEmail.toLowerCase()) {
    throw new Error('calendar_data_owner_mismatch');
  }
  if (destination.accountEmail?.toLowerCase() !== accountEmail.toLowerCase()
      || destination.accountSubject !== accountSubject) throw new Error('google_account_mismatch');
  return {
    id: destination.id,
    mode: destination.mode,
    name,
    marker: description,
    dataOwner,
    timeZone: String(calendar.timeZone || '').trim() || null,
  };
}

export function buildCalendarConnectionProbePayload(
  destination: PepperCalendarDestination,
  now = new Date(),
) {
  if (!destination.installationId || !destination.marker) {
    throw new Error('calendar_creation_proof_missing');
  }
  const startsAt = new Date(now.getTime() + 5 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 5 * 60_000);
  return {
    id: calendarConnectionProbeEventId(destination.installationId),
    summary: PEPPER_CONNECTION_PROBE_TITLE,
    description: destination.marker,
    visibility: 'private',
    start: { dateTime: startsAt.toISOString(), timeZone: 'America/Los_Angeles' },
    end: { dateTime: endsAt.toISOString(), timeZone: 'America/Los_Angeles' },
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        pepperConnectionProbe: 'true',
        pepperCalendarId: destination.id,
        pepperInstallationId: destination.installationId,
        pepperCalendarMarker: destination.marker,
      },
    },
  };
}

export function validateCalendarConnectionProbeEvent(
  event: Record<string, unknown>,
  destination: PepperCalendarDestination,
) {
  const payload = buildCalendarConnectionProbePayload(destination, new Date(0));
  const privateProperties = event.extendedProperties && typeof event.extendedProperties === 'object'
    ? (event.extendedProperties as { private?: Record<string, unknown> }).private
    : null;
  if (event.id !== payload.id) throw new Error('calendar_probe_event_id_mismatch');
  if (event.summary !== PEPPER_CONNECTION_PROBE_TITLE) throw new Error('calendar_probe_title_mismatch');
  if (event.visibility !== 'private') throw new Error('calendar_probe_visibility_mismatch');
  if (Array.isArray(event.attendees) && event.attendees.length > 0) {
    throw new Error('calendar_probe_attendees_rejected');
  }
  if (!privateProperties
      || privateProperties.pepperConnectionProbe !== 'true'
      || privateProperties.pepperCalendarId !== destination.id
      || privateProperties.pepperInstallationId !== destination.installationId
      || privateProperties.pepperCalendarMarker !== destination.marker) {
    throw new Error('calendar_probe_marker_mismatch');
  }
  return { id: String(event.id), title: PEPPER_CONNECTION_PROBE_TITLE };
}

export type CalendarConnectionProbeGateway = {
  create(calendarId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  read(calendarId: string, eventId: string): Promise<CalendarConnectionProbeReadResult>;
  remove(calendarId: string, eventId: string): Promise<void>;
};

export type CalendarConnectionProbeReadResult = {
  calendarId: string;
  eventId: string;
  httpStatus: number;
  event: Record<string, unknown> | null;
};

export function isCalendarProbeDeletionConfirmed(
  result: CalendarConnectionProbeReadResult,
  destination: PepperCalendarDestination,
  expectedEventId: string,
) {
  if (!result || typeof result !== 'object') return false;
  if (result.calendarId !== destination.id || result.eventId !== expectedEventId) return false;
  if ([404, 410].includes(result.httpStatus)) return result.event === null;
  if (result.httpStatus !== 200 || !result.event || typeof result.event !== 'object'
      || Array.isArray(result.event)) return false;
  if (result.event.id !== expectedEventId || result.event.status !== 'cancelled') return false;
  if (Object.hasOwn(result.event, 'recurringEventId')
      || Object.hasOwn(result.event, 'originalStartTime')) return false;
  return true;
}

export class CalendarConnectionProbeError extends Error {
  stage: string;
  cleanupFailed: boolean;

  constructor(stage: string, cause: unknown, cleanupFailed: boolean) {
    super(`calendar_probe_${stage}_failed:${String((cause as Error)?.message || cause)}`);
    this.stage = stage;
    this.cleanupFailed = cleanupFailed;
  }
}

export async function runCalendarConnectionProbe(
  gateway: CalendarConnectionProbeGateway,
  destination: PepperCalendarDestination,
  now = new Date(),
) {
  const payload = buildCalendarConnectionProbePayload(destination, now);
  let created = false;
  let deleted = false;
  let stage = 'create';
  try {
    const createdEvent = await gateway.create(destination.id, payload);
    created = true;
    validateCalendarConnectionProbeEvent(createdEvent, destination);
    stage = 'read';
    const readback = await gateway.read(destination.id, payload.id);
    if (readback.calendarId !== destination.id || readback.eventId !== payload.id
        || readback.httpStatus !== 200 || !readback.event) {
      throw new Error('calendar_probe_event_missing');
    }
    validateCalendarConnectionProbeEvent(readback.event, destination);
    stage = 'delete';
    await gateway.remove(destination.id, payload.id);
    deleted = true;
    stage = 'absence_verification';
    const deletionReadback = await gateway.read(destination.id, payload.id);
    if (!isCalendarProbeDeletionConfirmed(deletionReadback, destination, payload.id)) {
      throw new Error('calendar_probe_event_still_present');
    }
    return {
      success: true,
      event_id: payload.id,
      created: true,
      read_back: true,
      deleted: true,
      absence_verified: true,
    };
  } catch (error) {
    let cleanupFailed = false;
    if (created && !deleted) {
      try {
        await gateway.remove(destination.id, payload.id);
      } catch {
        cleanupFailed = true;
      }
    }
    throw new CalendarConnectionProbeError(stage, error, cleanupFailed);
  }
}

export type PepperAppointmentCalendarEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  notes?: string | null;
  preparation_instructions?: string | null;
  clinician_name?: string | null;
  facility_name?: string | null;
  appointment_type?: string | null;
  source_timezone?: string | null;
  external_event_id?: string | null;
  status: string;
};

export type CalendarFailure = {
  code: 'external_event_missing' | 'reconnect_required' | 'retry_required' | 'request_failed';
  reconnectRequired: boolean;
  retryable: boolean;
};

export function googleEventIdForPepper(eventId: string) {
  return `pepper${eventId.replace(/-/g, '')}`;
}

export function calendarOperationFor(event: PepperAppointmentCalendarEvent) {
  if (event.status === 'canceled') {
    return event.external_event_id
      ? { kind: 'cancel' as const, externalEventId: event.external_event_id }
      : { kind: 'skip_cancel' as const, externalEventId: null };
  }
  return event.external_event_id
    ? { kind: 'update' as const, externalEventId: event.external_event_id }
    : { kind: 'create' as const, externalEventId: googleEventIdForPepper(event.id) };
}

export function classifyGoogleCalendarFailure(status: number): CalendarFailure {
  if (status === 401 || status === 403) {
    return { code: 'reconnect_required', reconnectRequired: true, retryable: true };
  }
  if (status === 404 || status === 410) {
    return { code: 'external_event_missing', reconnectRequired: false, retryable: true };
  }
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return { code: 'retry_required', reconnectRequired: false, retryable: true };
  }
  return { code: 'request_failed', reconnectRequired: false, retryable: false };
}

export function isActiveGoogleEvent(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === 'string' && event.id.length > 0 && event.status !== 'cancelled';
}

export function buildGoogleAppointmentPayload(
  event: PepperAppointmentCalendarEvent,
  captureId?: string | null,
  includeId = false,
  mode: PepperCalendarMode = 'production',
) {
  const description = [
    event.appointment_type ? `Type: ${event.appointment_type.replace(/_/g, ' ')}` : null,
    event.clinician_name ? `Clinician: ${event.clinician_name}` : null,
    event.facility_name ? `Facility: ${event.facility_name}` : null,
    event.preparation_instructions || null,
    event.notes || null,
    'Managed by Pepper.',
  ].filter(Boolean).join('\n\n');
  const privateProperties: Record<string, string> = { pepperEventId: event.id };
  if (captureId) privateProperties.pepperCaptureId = captureId;
  return {
    ...(includeId ? { id: googleEventIdForPepper(event.id) } : {}),
    summary: mode === 'sandbox' && !event.title.startsWith(PEPPER_TEST_EVENT_PREFIX)
      ? `${PEPPER_TEST_EVENT_PREFIX} ${event.title}`
      : event.title,
    description,
    location: event.location || undefined,
    start: {
      dateTime: event.starts_at,
      timeZone: event.source_timezone || 'America/Los_Angeles',
    },
    end: {
      dateTime: event.ends_at || new Date(Date.parse(event.starts_at) + 60 * 60_000).toISOString(),
      timeZone: event.source_timezone || 'America/Los_Angeles',
    },
    reminders: { useDefault: true },
    extendedProperties: { private: privateProperties },
  };
}

export function isPepperManagedGoogleEvent(
  event: Record<string, unknown>,
  mode: PepperCalendarMode,
) {
  const properties = event.extendedProperties;
  const privateProperties = properties && typeof properties === 'object'
    ? (properties as { private?: unknown }).private
    : null;
  const pepperEventId = privateProperties && typeof privateProperties === 'object'
    ? String((privateProperties as Record<string, unknown>).pepperEventId || '').trim()
    : '';
  if (!pepperEventId) return false;
  return mode === 'production'
    || String(event.summary || '').startsWith(PEPPER_TEST_EVENT_PREFIX);
}

export function stripHtml(value: unknown) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeText(value: unknown) {
  return stripHtml(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function zonedMidnight(dateString: string, timeZone: string) {
  const [year, month, day] = dateString.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const rendered = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess -= rendered - target;
  }
  return new Date(guess).toISOString();
}

export function eventTime(value: EventDateLike | undefined, fallbackTimeZone: string) {
  if (value?.dateTime) {
    const parsed = new Date(value.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value?.date) return zonedMidnight(value.date, value.timeZone || fallbackTimeZone);
  return null;
}

export function inferPerson(text: string, members: MemberLike[]) {
  const normalized = ` ${normalizeText(text)} `;
  return members.find((member) => {
    const names = [member.slug, member.display_name].map(normalizeText).filter(Boolean);
    return names.some((name) => normalized.includes(` ${name} `));
  })?.slug || null;
}

export function activityKey(text: string) {
  const normalized = normalizeText(text);
  if (/\b(xc|cross country|track|run|running|runner)\b/.test(normalized)) return 'run';
  if (/\b(soccer|football)\b/.test(normalized)) return 'soccer';
  if (/\b(dance|ballet)\b/.test(normalized)) return 'dance';
  if (/\b(rehearsal|theatre|theater|play|musical)\b/.test(normalized)) return 'theatre';
  if (/\b(dentist|doctor|appointment|therapy)\b/.test(normalized)) return 'appointment';
  const words = normalized
    .split(' ')
    .filter((word) => word.length > 3 && !['chloe', 'lyra', 'posey', 'elle', 'matt', 'team'].includes(word));
  return words.slice(0, 3).join('-') || 'event';
}

export function kindFor(text: string, title = text) {
  const normalized = normalizeText(text);
  const normalizedTitle = normalizeText(title);
  if (/\bdr\b/.test(normalizedTitle) || /\b(doctor|dentist|dental|orthodont\w*|pediatri\w*|pulmonolog\w*|cardiolog\w*|dermatolog\w*|endocrinolog\w*|neurolog\w*|allerg\w*|specialist|medical|therapy|therapist|physical|optometr\w*|vision|eye exam|check up|checkup|well child|wellness|urgent care|clinic)\b/.test(normalized)) return 'appointment';
  if (/\b(dinner|lunch|breakfast)\b/.test(normalized)) return 'meal';
  if (/\b(pickup|pick up|dropoff|drop off|ride|driver)\b/.test(normalized)) return 'transport';
  if (/\b(work|meeting|shift)\b/.test(normalized)) return 'work';
  return 'activity';
}

export function requirementFor(text: string) {
  const normalized = normalizeText(text);
  const adultRunner = /\badult runner (is )?required\b/.test(normalized);
  const adultRequired = adultRunner || /\b(adult|parent|guardian)\b.{0,32}\b(required|needed|must attend|must run|volunteer)\b/.test(normalized);
  if (!adultRequired) return { required: false, label: null };
  if (adultRunner) return { required: true, label: 'Adult runner required' };
  if (/\bparent\b/.test(normalized)) return { required: true, label: 'Parent required' };
  return { required: true, label: 'Adult required' };
}

export function sharedWithHousehold(
  event: CalendarEventLike,
  personSlug: string | null,
  combinedText: string,
) {
  if (event.visibility === 'private' || event.visibility === 'confidential') return false;
  if (personSlug) return true;
  return /\b(family|kids?|children|daughter|son|school|pickup|pick up|dropoff|drop off|parent)\b/.test(
    normalizeText(combinedText),
  );
}

export function canonicalDedupeKey(personSlug: string | null, startsAt: string, text: string) {
  const minute = Math.floor(new Date(startsAt).getTime() / 60000);
  return `${personSlug || 'family'}|${minute}|${activityKey(text)}`;
}
