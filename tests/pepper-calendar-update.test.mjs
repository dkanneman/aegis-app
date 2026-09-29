import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildCalendarConnectionProbePayload,
  buildGoogleAppointmentPayload,
  calendarConnectionProbeEventId,
  calendarOperationFor,
  CalendarConnectionProbeError,
  calendarSetupAction,
  classifyGoogleCalendarFailure,
  GOOGLE_CALENDAR_APP_CREATED_SCOPE,
  GOOGLE_OAUTH_SCOPE,
  googleOAuthRedirectUri,
  googleEventIdForPepper,
  hasGoogleCalendarAppCreatedScope,
  isActiveGoogleEvent,
  isCalendarProbeDeletionConfirmed,
  isPepperManagedGoogleEvent,
  PEPPER_CALENDAR_SETUP_METHOD,
  PEPPER_CONNECTION_PROBE_TITLE,
  PEPPER_PRODUCTION_CALENDAR_NAME,
  pepperCalendarMarker,
  pepperCalendarMode,
  runCalendarConnectionProbe,
  validateCalendarConnectionProof,
  validateCalendarConnectionProbeEvent,
  validateCalendarResource,
  validateCreatedCalendar,
  validateCurrentGoogleIdentity,
  validateGoogleOidcClaims,
} from '../supabase/functions/pepper-calendar/logic.ts'
import {
  appointmentDeliveryState,
  googleAppointmentDeliveryStatus,
  publicAppointmentSyncResult,
} from '../supabase/functions/aegis-bridge-worker/logic.ts'

const eventId = 'ad3b99f4-c6d4-4d27-b5e5-56ce5f74f44b'
const baseEvent = {
  id: eventId,
  title: 'Karin Eshagh, MD appointment',
  starts_at: '2026-09-19T20:45:00.000Z',
  ends_at: '2026-09-19T21:45:00.000Z',
  location: 'Ventura Medical Center',
  notes: 'Patient: Lyra',
  preparation_instructions: 'Bring insurance and a medication list.',
  clinician_name: 'Karin Eshagh, MD',
  facility_name: 'Ventura Medical Center',
  appointment_type: 'doctor',
  source_timezone: 'America/Los_Angeles',
  external_event_id: 'pepper-existing-google-event',
  status: 'confirmed',
}

test('time and date changes serialize the current canonical appointment', () => {
  const timeChanged = buildGoogleAppointmentPayload({
    ...baseEvent,
    starts_at: '2026-09-19T22:15:00.000Z',
    ends_at: '2026-09-19T23:15:00.000Z',
  })
  assert.equal(timeChanged.start.dateTime, '2026-09-19T22:15:00.000Z')
  assert.equal(timeChanged.end.dateTime, '2026-09-19T23:15:00.000Z')

  const dateChanged = buildGoogleAppointmentPayload({
    ...baseEvent,
    starts_at: '2026-09-22T20:45:00.000Z',
    ends_at: '2026-09-22T21:45:00.000Z',
  })
  assert.equal(dateChanged.start.dateTime, '2026-09-22T20:45:00.000Z')
  assert.equal(dateChanged.start.timeZone, 'America/Los_Angeles')
})

test('provider, location, preparation, reminders, and description update together', () => {
  const payload = buildGoogleAppointmentPayload({
    ...baseEvent,
    clinician_name: 'New Provider, MD',
    facility_name: 'Two Trees Physical Therapy',
    location: '123 Main Street',
    preparation_instructions: 'Arrive 20 minutes early.',
  }, '45436a3e-e2d6-4e3a-bf78-11a338b6c35e')
  assert.equal(payload.location, '123 Main Street')
  assert.match(payload.description, /New Provider, MD/)
  assert.match(payload.description, /Two Trees Physical Therapy/)
  assert.match(payload.description, /Arrive 20 minutes early/)
  assert.deepEqual(payload.reminders, { useDefault: true })
  assert.equal(payload.extendedProperties.private.pepperEventId, eventId)
})

test('published updates and cancellations preserve the external Google event ID', () => {
  assert.deepEqual(calendarOperationFor(baseEvent), {
    kind: 'update',
    externalEventId: 'pepper-existing-google-event',
  })
  assert.deepEqual(calendarOperationFor({ ...baseEvent, status: 'canceled' }), {
    kind: 'cancel',
    externalEventId: 'pepper-existing-google-event',
  })
})

test('repeated update delivery remains a PATCH target and cannot become a create', () => {
  const first = calendarOperationFor(baseEvent)
  const replay = calendarOperationFor({ ...baseEvent })
  assert.deepEqual(replay, first)
  assert.equal(replay.kind, 'update')
})

test('repeated create delivery uses the same deterministic Google event ID', () => {
  const unpublished = { ...baseEvent, external_event_id: null }
  const first = calendarOperationFor(unpublished)
  const replay = calendarOperationFor({ ...unpublished })
  assert.deepEqual(replay, first)
  assert.deepEqual(first, {
    kind: 'create',
    externalEventId: googleEventIdForPepper(eventId),
  })
})

test('stale and externally deleted IDs are retryable rather than duplicate creates', () => {
  const stale = classifyGoogleCalendarFailure(404)
  const deleted = classifyGoogleCalendarFailure(410)
  assert.equal(stale.code, 'external_event_missing')
  assert.equal(stale.retryable, true)
  assert.equal(deleted.code, 'external_event_missing')
  assert.equal(calendarOperationFor(baseEvent).kind, 'update')
  assert.equal(googleEventIdForPepper(eventId), 'pepperad3b99f4c6d44d27b5e556ce5f74f44b')
  assert.equal(isActiveGoogleEvent({ id: 'existing', status: 'confirmed' }), true)
  assert.equal(isActiveGoogleEvent({ id: 'existing', status: 'cancelled' }), false)
})

test('permission failures require reconnect while transient API failures remain retryable', () => {
  assert.deepEqual(classifyGoogleCalendarFailure(403), {
    code: 'reconnect_required',
    reconnectRequired: true,
    retryable: true,
  })
  assert.equal(classifyGoogleCalendarFailure(429).code, 'retry_required')
  assert.equal(classifyGoogleCalendarFailure(503).retryable, true)
})

test('only openid, email, and calendar.app.created are accepted', () => {
  assert.equal(hasGoogleCalendarAppCreatedScope(GOOGLE_OAUTH_SCOPE), true)
  assert.equal(hasGoogleCalendarAppCreatedScope(
    `openid https://www.googleapis.com/auth/userinfo.email ${GOOGLE_CALENDAR_APP_CREATED_SCOPE}`,
  ), true)
  assert.equal(hasGoogleCalendarAppCreatedScope('https://www.googleapis.com/auth/calendar.events'), false)
  assert.equal(hasGoogleCalendarAppCreatedScope(`${GOOGLE_OAUTH_SCOPE} https://www.googleapis.com/auth/calendar`), false)
  assert.equal(hasGoogleCalendarAppCreatedScope(`${GOOGLE_OAUTH_SCOPE} https://www.googleapis.com/auth/gmail.readonly`), false)
})

const productionCalendarId = 'pepper-family-secondary@example.com'
const productionAccountEmail = 'danielle@example.com'
const productionAccountSubject = 'google-account-subject'
const installationId = 'dc43b74c-bef1-4e84-9f86-85ce2142566c'
const installationMarker = pepperCalendarMarker(installationId)

function appCreatedConnection(overrides = {}) {
  return {
    provider_calendar_id: productionCalendarId,
    calendar_name: PEPPER_PRODUCTION_CALENDAR_NAME,
    calendar_setup_method: PEPPER_CALENDAR_SETUP_METHOD,
    calendar_created_at: '2026-09-16T18:00:00.000Z',
    calendar_mode: 'production',
    pepper_installation_id: installationId,
    pepper_calendar_marker: installationMarker,
    google_account_email: productionAccountEmail,
    google_account_subject: productionAccountSubject,
    google_data_owner: productionAccountEmail,
    access_scope: GOOGLE_OAUTH_SCOPE,
    ...overrides,
  }
}

function productionDestination(requestedCalendarId = productionCalendarId, overrides = {}) {
  return validateCalendarConnectionProof(
    appCreatedConnection(overrides),
    pepperCalendarMode('production'),
    productionAccountEmail,
    requestedCalendarId,
  )
}

function writableProductionListing(overrides = {}) {
  return {
    id: productionCalendarId,
    summary: 'Pepper Family',
    description: installationMarker,
    dataOwner: productionAccountEmail,
    timeZone: 'America/Los_Angeles',
    ...overrides,
  }
}

test('an app-created Pepper Family calendar is accepted through Calendars.get with exact proof', () => {
  const destination = productionDestination()
  assert.deepEqual(validateCalendarResource(
    writableProductionListing(),
    destination,
    { email: productionAccountEmail, subject: productionAccountSubject },
  ), {
    id: productionCalendarId,
    mode: 'production',
    name: 'Pepper Family',
    marker: installationMarker,
    dataOwner: productionAccountEmail,
    timeZone: 'America/Los_Angeles',
  })
})

test('a manually created same-name calendar is rejected without creation proof', () => {
  assert.throws(() => productionDestination(productionCalendarId, {
    calendar_setup_method: null,
    calendar_created_at: null,
  }), /calendar_creation_proof_missing/)
})

test('repeated setup reuses the stored app-created calendar instead of creating another', () => {
  assert.equal(calendarSetupAction(null), 'create')
  assert.equal(calendarSetupAction({ calendar_setup_method: null }), 'create')
  assert.equal(calendarSetupAction(appCreatedConnection()), 'reuse')
  assert.throws(
    () => calendarSetupAction({ calendar_setup_method: 'manual_calendar' }),
    /calendar_creation_proof_invalid/,
  )
})

test('the authenticated account email is rejected case-insensitively', () => {
  const accountCalendarId = 'Danielle@Example.com'
  assert.throws(() => productionDestination(accountCalendarId, {
    provider_calendar_id: accountCalendarId,
  }), /production_calendar_account_id_rejected/)
})

test('an incorrect authenticated account is rejected', () => {
  assert.throws(() => validateCalendarConnectionProof(
    appCreatedConnection(),
    'production',
    'someone-else@example.com',
    productionCalendarId,
  ), /google_account_mismatch/)
})

test('current OIDC identity must match the stored subject and normalized email', () => {
  assert.deepEqual(validateCurrentGoogleIdentity({
    sub: productionAccountSubject,
    email: productionAccountEmail.toUpperCase(),
    email_verified: true,
  }, appCreatedConnection(), productionAccountEmail), {
    email: productionAccountEmail.toUpperCase(),
    subject: productionAccountSubject,
  })
  assert.throws(() => validateCurrentGoogleIdentity({
    sub: 'wrong-subject',
    email: productionAccountEmail,
    email_verified: true,
  }, appCreatedConnection(), productionAccountEmail), /google_account_mismatch/)
  assert.throws(() => validateCurrentGoogleIdentity({
    sub: productionAccountSubject,
    email: 'wrong@example.com',
    email_verified: true,
  }, appCreatedConnection(), productionAccountEmail), /google_account_mismatch/)
  assert.throws(() => validateCurrentGoogleIdentity({
    email: productionAccountEmail,
    email_verified: true,
  }, appCreatedConnection(), productionAccountEmail), /google_identity_claim_missing/)
})

test('signed identity claims require verified email, subject, audience, and nonce', () => {
  const claims = {
    iss: 'https://accounts.google.com',
    aud: 'pepper-client-id',
    exp: 2_000_000_000,
    nonce: 'oauth-state-hash',
    email: productionAccountEmail,
    email_verified: true,
    sub: 'google-account-subject',
  }
  assert.deepEqual(validateGoogleOidcClaims(claims, {
    clientId: 'pepper-client-id',
    expectedAccountEmail: productionAccountEmail.toUpperCase(),
    expectedNonce: 'oauth-state-hash',
    nowEpochSeconds: 1_800_000_000,
  }), { email: productionAccountEmail, subject: 'google-account-subject' })
  assert.throws(() => validateGoogleOidcClaims({ ...claims, email: undefined }, {
    clientId: 'pepper-client-id',
    expectedAccountEmail: productionAccountEmail,
    expectedNonce: 'oauth-state-hash',
    nowEpochSeconds: 1_800_000_000,
  }), /google_identity_claim_missing/)
  assert.throws(() => validateGoogleOidcClaims(claims, {
    clientId: 'pepper-client-id',
    expectedAccountEmail: 'different@example.com',
    expectedNonce: 'oauth-state-hash',
    nowEpochSeconds: 1_800_000_000,
  }), /google_account_mismatch/)
})

test('a nonallowlisted secondary calendar is rejected', () => {
  assert.throws(() => productionDestination('other-secondary@example.com'), /calendar_not_allowlisted/)
})

test('Calendars.get rejects a wrong immutable ID or title', () => {
  assert.throws(() => validateCalendarResource(
    writableProductionListing({ id: 'other-secondary@example.com' }),
    productionDestination(),
    { email: productionAccountEmail, subject: productionAccountSubject },
  ), /calendar_resource_id_mismatch/)
  assert.throws(() => validateCalendarResource(
    writableProductionListing({ summary: 'Another Calendar' }),
    productionDestination(),
    { email: productionAccountEmail, subject: productionAccountSubject },
  ), /production_calendar_name_mismatch/)
})

test('Calendars.get requires the exact marker and dataOwner', () => {
  assert.throws(() => validateCalendarResource(
    writableProductionListing({ description: '' }),
    productionDestination(),
    { email: productionAccountEmail, subject: productionAccountSubject },
  ), /calendar_resource_metadata_missing/)
  assert.throws(() => validateCalendarResource(
    writableProductionListing({ description: `${installationMarker}-wrong` }),
    productionDestination(),
    { email: productionAccountEmail, subject: productionAccountSubject },
  ), /calendar_installation_marker_mismatch/)
  assert.throws(() => validateCalendarResource(
    writableProductionListing({ dataOwner: '' }),
    productionDestination(),
    { email: productionAccountEmail, subject: productionAccountSubject },
  ), /calendar_resource_metadata_missing/)
  assert.throws(() => validateCalendarResource(
    writableProductionListing({ dataOwner: 'wrong@example.com' }),
    productionDestination(),
    { email: productionAccountEmail, subject: productionAccountSubject },
  ), /calendar_data_owner_mismatch/)
})

test('stored app-created calendar proof has no primary, missing-ID, or alternate fallback', () => {
  assert.throws(() => productionDestination(productionCalendarId, {
    provider_calendar_id: '',
  }), /production_calendar_not_configured/)
  assert.throws(() => productionDestination('primary'), /primary_calendar_rejected/)
  assert.throws(() => productionDestination(''), /calendar_id_missing/)
  assert.throws(() => productionDestination('other-secondary@example.com'), /calendar_not_allowlisted/)
})

test('Calendars.insert output must identify the exact dedicated Pepper calendar', () => {
  assert.deepEqual(validateCreatedCalendar({
    id: productionCalendarId,
    summary: PEPPER_PRODUCTION_CALENDAR_NAME,
    description: installationMarker,
    dataOwner: productionAccountEmail,
  }, 'production', {
    email: productionAccountEmail,
    subject: productionAccountSubject,
  }, installationId, installationMarker), {
    mode: 'production',
    id: productionCalendarId,
    name: PEPPER_PRODUCTION_CALENDAR_NAME,
    installationId,
    marker: installationMarker,
    dataOwner: productionAccountEmail,
    accountEmail: productionAccountEmail,
    accountSubject: productionAccountSubject,
  })
  assert.throws(() => validateCreatedCalendar({
    id: productionAccountEmail,
    summary: PEPPER_PRODUCTION_CALENDAR_NAME,
    description: installationMarker,
    dataOwner: productionAccountEmail,
  }, 'production', {
    email: productionAccountEmail,
    subject: productionAccountSubject,
  }, installationId, installationMarker), /production_calendar_account_id_rejected/)
  assert.throws(() => validateCreatedCalendar({
    id: productionCalendarId,
    summary: 'Not Pepper Family',
    description: installationMarker,
    dataOwner: productionAccountEmail,
  }, 'production', {
    email: productionAccountEmail,
    subject: productionAccountSubject,
  }, installationId, installationMarker), /production_calendar_name_mismatch/)
})

test('connection proof rejects wrong mode, marker, data owner, subject, and scopes', () => {
  assert.throws(() => productionDestination(productionCalendarId, { calendar_mode: 'sandbox' }), /calendar_mode_mismatch/)
  assert.throws(() => productionDestination(productionCalendarId, { pepper_calendar_marker: 'wrong' }), /calendar_installation_marker_invalid/)
  assert.throws(() => productionDestination(productionCalendarId, { google_data_owner: 'wrong@example.com' }), /calendar_data_owner_mismatch/)
  assert.throws(() => productionDestination(productionCalendarId, { google_account_subject: '' }), /calendar_creation_proof_missing/)
  assert.throws(() => productionDestination(productionCalendarId, {
    access_scope: `${GOOGLE_OAUTH_SCOPE} https://www.googleapis.com/auth/calendar`,
  }), /calendar_app_created_scope_required/)
})

test('connection probe creates, reads, deletes, and verifies absence without guests', async () => {
  const destination = productionDestination()
  const events = new Map()
  const operations = []
  let deleted = false
  const gateway = {
    async create(calendarId, payload) {
      operations.push('create')
      assert.equal(calendarId, destination.id)
      assert.equal(payload.summary, PEPPER_CONNECTION_PROBE_TITLE)
      assert.equal(payload.visibility, 'private')
      assert.equal('attendees' in payload, false)
      events.set(payload.id, structuredClone(payload))
      return structuredClone(payload)
    },
    async read(calendarId, id) {
      operations.push('read')
      assert.equal(calendarId, destination.id)
      if (deleted) {
        return { calendarId, eventId: id, httpStatus: 200, event: { id, status: 'cancelled' } }
      }
      return {
        calendarId,
        eventId: id,
        httpStatus: 200,
        event: events.has(id) ? structuredClone(events.get(id)) : null,
      }
    },
    async remove(calendarId, id) {
      operations.push('delete')
      assert.equal(calendarId, destination.id)
      assert.equal(events.has(id), true)
      deleted = true
    },
  }
  const evidence = await runCalendarConnectionProbe(gateway, destination, new Date('2026-09-16T18:00:00Z'))
  assert.deepEqual(operations, ['create', 'read', 'delete', 'read'])
  assert.deepEqual(evidence, {
    success: true,
    event_id: calendarConnectionProbeEventId(installationId),
    created: true,
    read_back: true,
    deleted: true,
    absence_verified: true,
  })
  assert.equal(events.size, 1)
  assert.equal(deleted, true)
  const payload = buildCalendarConnectionProbePayload(destination)
  assert.doesNotThrow(() => validateCalendarConnectionProbeEvent(payload, destination))
})

test('connection activation binds probe evidence as a JSON object', async () => {
  const calendar = await readFile(
    new URL('../supabase/functions/pepper-calendar/index.ts', import.meta.url),
    'utf8',
  )

  assert.match(
    calendar,
    /calendar_probe_evidence\s*=\s*\$\{transaction\.json\(probeEvidence\)\}::jsonb/,
  )
  assert.doesNotMatch(
    calendar,
    /calendar_probe_evidence\s*=\s*\$\{JSON\.stringify\(probeEvidence\)\}::jsonb/,
  )
})

test('connection probe accepts only exact non-recurring deletion evidence', () => {
  const destination = productionDestination()
  const eventId = calendarConnectionProbeEventId(installationId)
  const result = (httpStatus, event, calendarId = destination.id, requestedEventId = eventId) => ({
    calendarId,
    eventId: requestedEventId,
    httpStatus,
    event,
  })

  assert.equal(isCalendarProbeDeletionConfirmed(
    result(200, { id: eventId, status: 'cancelled', summary: PEPPER_CONNECTION_PROBE_TITLE }),
    destination,
    eventId,
  ), true)
  assert.equal(isCalendarProbeDeletionConfirmed(
    result(200, { id: eventId, status: 'cancelled' }),
    destination,
    eventId,
  ), true)
  assert.equal(isCalendarProbeDeletionConfirmed(result(404, null), destination, eventId), true)
  assert.equal(isCalendarProbeDeletionConfirmed(result(410, null), destination, eventId), true)

  assert.equal(isCalendarProbeDeletionConfirmed(
    result(200, { id: eventId, status: 'confirmed' }),
    destination,
    eventId,
  ), false)
  assert.equal(isCalendarProbeDeletionConfirmed(
    result(200, { id: eventId, status: 'tentative' }),
    destination,
    eventId,
  ), false)
  assert.equal(isCalendarProbeDeletionConfirmed(
    result(200, { id: eventId, status: 'unknown' }),
    destination,
    eventId,
  ), false)
  assert.equal(isCalendarProbeDeletionConfirmed(
    result(200, { id: 'wrong-event', status: 'cancelled' }),
    destination,
    eventId,
  ), false)
  assert.equal(isCalendarProbeDeletionConfirmed(
    result(200, { id: eventId, status: 'cancelled' }, 'wrong-calendar@example.com'),
    destination,
    eventId,
  ), false)
  assert.equal(isCalendarProbeDeletionConfirmed(
    result(200, { id: eventId, status: 'cancelled', recurringEventId: 'parent-event' }),
    destination,
    eventId,
  ), false)
  assert.equal(isCalendarProbeDeletionConfirmed(
    result(200, { id: eventId, status: 'cancelled', originalStartTime: { dateTime: '2026-09-16T18:00:00Z' } }),
    destination,
    eventId,
  ), false)
  assert.equal(isCalendarProbeDeletionConfirmed(result(200, {}), destination, eventId), false)
  assert.equal(isCalendarProbeDeletionConfirmed(result(200, null), destination, eventId), false)
  assert.equal(isCalendarProbeDeletionConfirmed(result(200, 'malformed'), destination, eventId), false)

  for (const status of [401, 403, 429, 500, 503]) {
    assert.equal(isCalendarProbeDeletionConfirmed(result(status, null), destination, eventId), false)
  }
})

test('connection stays inactive when probe deletion is not confirmed and creates no canonical side effects', async () => {
  const destination = productionDestination()
  const payload = buildCalendarConnectionProbePayload(destination)
  let deleted = false
  await assert.rejects(
    runCalendarConnectionProbe({
      async create(calendarId, createdPayload) {
        assert.equal(calendarId, destination.id)
        return createdPayload
      },
      async read(calendarId, id) {
        assert.equal(calendarId, destination.id)
        return {
          calendarId,
          eventId: id,
          httpStatus: 200,
          event: deleted ? { id, status: 'confirmed' } : payload,
        }
      },
      async remove(calendarId) {
        assert.equal(calendarId, destination.id)
        deleted = true
      },
    }, destination),
    (error) => error instanceof CalendarConnectionProbeError
      && error.stage === 'absence_verification'
      && error.cleanupFailed === false,
  )

  const calendar = await readFile(new URL('../supabase/functions/pepper-calendar/index.ts', import.meta.url), 'utf8')
  const probeStart = calendar.indexOf('async function probePepperCalendar')
  const probeEnd = calendar.indexOf('async function exchangeCode', probeStart)
  const probeBody = calendar.slice(probeStart, probeEnd)
  assert.doesNotMatch(probeBody, /recordCalendarAudit|mirrorCalendarDelivery|appointment_bridge|public\.events/)
  const probeCall = calendar.indexOf(': await probePepperCalendar')
  const connectionActivation = calendar.indexOf("status = 'connected'", probeCall)
  assert.ok(probeCall > 0)
  assert.ok(connectionActivation > probeCall)
})

test('connection probe failures identify create, read, delete, and cleanup failures', async () => {
  const destination = productionDestination()
  await assert.rejects(
    runCalendarConnectionProbe({
      async create() { throw new Error('create denied') },
      async read() { throw new Error('read should not run') },
      async remove() {},
    }, destination),
    (error) => error instanceof CalendarConnectionProbeError
      && error.stage === 'create' && error.cleanupFailed === false,
  )

  let cleaned = false
  await assert.rejects(
    runCalendarConnectionProbe({
      async create(_calendarId, payload) { return payload },
      async read() { throw new Error('read unavailable') },
      async remove() { cleaned = true },
    }, destination),
    (error) => error instanceof CalendarConnectionProbeError
      && error.stage === 'read' && error.cleanupFailed === false,
  )
  assert.equal(cleaned, true)

  await assert.rejects(
    runCalendarConnectionProbe({
      async create(_calendarId, payload) { return payload },
      async read(calendarId, id) {
        return { calendarId, eventId: id, httpStatus: 200, event: buildCalendarConnectionProbePayload(destination) }
      },
      async remove() { throw new Error('delete denied') },
    }, destination),
    (error) => error instanceof CalendarConnectionProbeError
      && error.stage === 'delete' && error.cleanupFailed === true,
  )
})

test('production payloads contain no guests and scans accept only Pepper-managed events', () => {
  const payload = buildGoogleAppointmentPayload(baseEvent, null, false, 'production')
  assert.equal(payload.summary, baseEvent.title)
  assert.equal('attendees' in payload, false)
  assert.equal(isPepperManagedGoogleEvent({
    summary: baseEvent.title,
    extendedProperties: { private: { pepperEventId: eventId } },
  }, 'production'), true)
  assert.equal(isPepperManagedGoogleEvent({ summary: baseEvent.title }, 'production'), false)
})

test('local OAuth uses the explicitly authorized loopback callback', () => {
  assert.equal(
    googleOAuthRedirectUri(
      'http://kong:8000',
      'http://127.0.0.1:54321/functions/v1/pepper-calendar/callback',
    ),
    'http://127.0.0.1:54321/functions/v1/pepper-calendar/callback',
  )
  assert.equal(
    googleOAuthRedirectUri('https://preview.example.com', ''),
    'https://preview.example.com/functions/v1/pepper-calendar/callback',
  )
  assert.throws(
    () => googleOAuthRedirectUri('http://kong:8000', 'http://example.com/functions/v1/pepper-calendar/callback'),
    /google_oauth_redirect_uri_insecure/,
  )
  assert.throws(
    () => googleOAuthRedirectUri('https://preview.example.com', 'https://preview.example.com/wrong'),
    /google_oauth_redirect_uri_path_invalid/,
  )
})

test('partial Pepper, Google, and AEGIS delivery is explicit and retryable', () => {
  assert.equal(googleAppointmentDeliveryStatus('retry_required'), 'retry_required')
  assert.equal(googleAppointmentDeliveryStatus('reconnect_required'), 'needs_reconnect')
  assert.equal(appointmentDeliveryState('synced', 'retry_required'), 'partial_retry_required')
  assert.equal(appointmentDeliveryState('synced', 'needs_reconnect'), 'partial_reconnect_required')
  assert.equal(appointmentDeliveryState('synced', 'synced'), 'synced')
  assert.equal(appointmentDeliveryState('synced', 'skipped'), 'partial_calendar_not_connected')
  assert.equal(appointmentDeliveryState('needs_review', 'synced'), 'partial_review_required')
})

test('public appointment updates never report a partial bridge delivery as synced', () => {
  assert.deepEqual(publicAppointmentSyncResult({
    useBridge: true,
    operation: 'edit',
    data: {
      ok: false,
      delivery_state: 'partial_reconnect_required',
      aegis_status: 'reconnect_required',
      google_status: 'synced',
    },
  }), {
    status: 'reconnect_required',
    retryable: true,
    operation: 'edit',
    delivery_state: 'partial_reconnect_required',
    aegis_status: 'reconnect_required',
    google_status: 'synced',
  })

  assert.deepEqual(publicAppointmentSyncResult({
    useBridge: true,
    operation: 'edit',
    data: {
      ok: true,
      delivery_state: 'synced',
      aegis_status: 'synced',
      google_status: 'synced',
    },
  }), {
    status: 'synced',
    retryable: false,
    operation: 'edit',
    delivery_state: 'synced',
    aegis_status: 'synced',
    google_status: 'synced',
  })
})

test('runtime contracts update existing Google events and surface retry state', async () => {
  const [calendar, family, bridge, migration] = await Promise.all([
    readFile(new URL('../supabase/functions/pepper-calendar/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/aegis-bridge-worker/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260916120000_sync_published_appointments.sql', import.meta.url), 'utf8'),
  ])
  assert.match(calendar, /method:\s*'PATCH'/)
  assert.match(calendar, /findPepperGoogleEvent/)
  assert.match(calendar, /Pepper did not create a replacement/)
  assert.match(calendar, /isActiveGoogleEvent\(googleEvent\)/)
  assert.match(calendar, /method:\s*'DELETE'/)
  assert.match(calendar, /sync_status='retry_required'/)
  assert.match(calendar, /appointment_retries/)
  assert.match(calendar, /mirrorCalendarDelivery/)
  assert.match(calendar, /PEPPER_GOOGLE_ACCOUNT_EMAIL/)
  assert.match(calendar, /GOOGLE_OAUTH_SCOPE/)
  assert.match(calendar, /verifyGoogleIdToken/)
  assert.match(calendar, /calendar\/v3\/calendars'/)
  assert.match(calendar, /openidconnect\.googleapis\.com\/v1\/userinfo/)
  assert.match(calendar, /validateCalendarResource/)
  assert.match(calendar, /probePepperCalendar/)
  assert.match(calendar, /calendar_probe_completed_at/)
  assert.match(calendar, /validateStoredCalendarAccess/)
  assert.match(calendar, /calendar_setup_method/)
  assert.doesNotMatch(calendar, /users\/me\/calendarList|calendarList\?/)
  assert.doesNotMatch(calendar, /PEPPER_PRODUCTION_CALENDAR_ID/)
  assert.doesNotMatch(calendar, /auth\/calendar\.events/)
  assert.doesNotMatch(calendar, /auth\/gmail/)
  assert.doesNotMatch(calendar, /sendUpdates=(?!none)/)
  assert.match(family, /syncPublishedAppointment/)
  assert.match(family, /publicAppointmentSyncResult\(\{useBridge,data,operation\}\)/)
  assert.match(family, /calendar_sync:calendarSync/)
  assert.match(family, /jsonb_build_object\('title',\$\{title\}::text/)
  assert.match(family, /change\.value->>'medical_event_id'=\$\{itemId\}/)
  assert.match(family, /task\.source='pepper_medical_coordination'/)
  assert.match(bridge, /const normalized = \{/)
  assert.match(bridge, /status: event\.status/)
  assert.match(bridge, /appointmentDeliveryState\(aegisResult\.status, googleStatus\)/)
  assert.match(migration, /cron\.schedule\('pepper-calendar-sync'/)
  assert.match(migration, /calendar_connections_status_check/)
  assert.match(migration, /calendar_connections_app_created_proof_check/)
  assert.match(migration, /calendar_connections_active_probe_check/)
  assert.match(migration, /calendar_probe_evidence/)
  assert.match(migration, /google_calendars_insert_v1/)
  assert.match(migration, /'reconnect_required'/)
  assert.match(migration, /excluded\.google_status in \('pending', 'retry_required'\)/)
  assert.match(migration, /appointment_release_task_backfill_backup/)
})
