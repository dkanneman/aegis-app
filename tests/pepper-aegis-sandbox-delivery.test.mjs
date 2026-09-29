import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  AEGIS_APPOINTMENT_HEADERS,
  AEGIS_PRODUCTION_SPREADSHEET_ID,
  AEGIS_PRODUCTION_SHEET_NAME,
  AEGIS_SANDBOX_SHEET_NAME,
  AEGIS_SANDBOX_SPREADSHEET_ID,
  PEPPER_TEST_ROW_PREFIX,
  AegisSheetsError,
  aegisAppointmentDeliveryId,
  appointmentSheetRow,
  deliverAegisAppointment,
  validateAegisDestinationConfig,
} from '../supabase/functions/aegis-bridge-worker/sheets.ts'
import {
  buildGoogleAppointmentPayload,
  GOOGLE_OAUTH_SCOPE,
  PEPPER_CALENDAR_SETUP_METHOD,
  PEPPER_TEST_EVENT_PREFIX,
  pepperCalendarMarker,
  validateCalendarConnectionProof,
  validateCalendarResource,
} from '../supabase/functions/pepper-calendar/logic.ts'

const eventId = 'ad3b99f4-c6d4-4d27-b5e5-56ce5f74f44b'
const captureId = '45436a3e-e2d6-4e3a-bf78-11a338b6c35e'
const config = {
  mode: 'sandbox',
  spreadsheetId: AEGIS_SANDBOX_SPREADSHEET_ID,
  sheetName: AEGIS_SANDBOX_SHEET_NAME,
  serviceAccountJson: '{"test":true}',
}
const appointment = {
  event_id: eventId,
  title: 'Karin Eshagh, MD appointment',
  starts_at: '2026-09-19T20:45:00.000Z',
  ends_at: '2026-09-19T21:45:00.000Z',
  status: 'confirmed',
  timezone: 'America/Los_Angeles',
  appointment_type: 'doctor',
  patient_member_id: 'b117c3ce-d0d4-4c30-8970-4c6a3bfc6d70',
  patient_slug: 'lyra',
  clinician: 'Karin Eshagh, MD',
  facility: 'Ventura Medical Center',
  location: '123 Main Street',
  preparation_instructions: 'Bring insurance card.',
  original_source_text: '09/19 at 1:45 PM PDT with Karin Eshagh, MD',
  dedupe_key: 'appointment:lyra:2026-09-19T20:45:00.000Z:karin-eshagh',
}

function memoryGateway(seed = []) {
  const rows = seed.map((values, index) => ({ rowNumber: index + 2, values: [...values] }))
  return {
    rows,
    async findRowsByRecordId(recordId) {
      return rows.filter((row) => row.values[0] === recordId)
    },
    async appendRow(values) {
      const rowNumber = rows.length + 2
      rows.push({ rowNumber, values: [...values] })
      return rowNumber
    },
    async updateRow(rowNumber, values) {
      const row = rows.find((candidate) => candidate.rowNumber === rowNumber)
      if (!row) throw new Error('missing row')
      row.values = [...values]
    },
    async readRow(rowNumber) {
      return [...rows.find((candidate) => candidate.rowNumber === rowNumber).values]
    },
  }
}

test('AEGIS delivery appends once, reads back, and marks synced only after verification', async () => {
  const gateway = memoryGateway()
  let tick = 0
  const result = await deliverAegisAppointment(
    gateway,
    config,
    appointment,
    captureId,
    () => `2026-09-16T12:00:0${tick++}.000Z`,
  )
  assert.equal(result.status, 'synced')
  assert.equal(result.operation, 'append')
  assert.equal(result.recordId, `pepper-event:${eventId}`)
  assert.equal(result.verifiedAt, '2026-09-16T12:00:02.000Z')
  assert.equal(gateway.rows.length, 1)
  assert.ok(gateway.rows[0].values[4].startsWith(`${PEPPER_TEST_ROW_PREFIX} `))
  assert.equal(gateway.rows[0].values[15], appointment.original_source_text)
  assert.equal(gateway.rows[0].values[18], `${PEPPER_TEST_ROW_PREFIX} Pepper appointment bridge`)
})

test('AEGIS replay updates the deterministic row without creating a duplicate', async () => {
  const existing = appointmentSheetRow(config, appointment, captureId, '2026-09-16T11:00:00.000Z')
  const gateway = memoryGateway([existing])
  const changed = { ...appointment, location: 'Two Trees Physical Therapy' }
  const first = await deliverAegisAppointment(gateway, config, changed, captureId)
  const replay = await deliverAegisAppointment(gateway, config, changed, captureId)
  assert.equal(first.operation, 'update')
  assert.equal(replay.operation, 'update')
  assert.equal(gateway.rows.length, 1)
  assert.equal(gateway.rows[0].values[13], 'Two Trees Physical Therapy')
})

test('ambiguous duplicate IDs and readback mismatch never report synced', async () => {
  const row = appointmentSheetRow(config, appointment, captureId, '2026-09-16T11:00:00.000Z')
  const duplicates = await deliverAegisAppointment(memoryGateway([row, row]), config, appointment, captureId)
  assert.equal(duplicates.status, 'needs_review')
  assert.equal(duplicates.errorClass, 'ambiguous_record')

  const gateway = memoryGateway()
  gateway.readRow = async () => ['wrong-record']
  const mismatch = await deliverAegisAppointment(gateway, config, appointment, captureId)
  assert.equal(mismatch.status, 'needs_review')
  assert.equal(mismatch.errorClass, 'readback_mismatch')
  assert.equal(mismatch.verifiedAt, null)
})

test('transient and permission failures remain visible retry states', async () => {
  const transient = {
    async findRowsByRecordId() { throw new AegisSheetsError(503, 'sheets_api_failed', 'unavailable') },
    async appendRow() { return 2 },
    async updateRow() {},
    async readRow() { return [] },
  }
  const retry = await deliverAegisAppointment(transient, config, appointment, captureId)
  assert.equal(retry.status, 'retry_required')

  const denied = {
    ...transient,
    async findRowsByRecordId() { throw new AegisSheetsError(403, 'sheets_api_failed', 'forbidden') },
  }
  const reconnect = await deliverAegisAppointment(denied, config, appointment, captureId)
  assert.equal(reconnect.status, 'reconnect_required')
})

test('AEGIS sandbox allowlist rejects production, arbitrary workbooks, copied-data tabs, and missing credentials', () => {
  assert.throws(() => validateAegisDestinationConfig({
    ...config,
    spreadsheetId: AEGIS_PRODUCTION_SPREADSHEET_ID,
  }), /approved Pepper sandbox destination/i)
  assert.throws(() => validateAegisDestinationConfig({
    ...config,
    spreadsheetId: 'arbitrary-sheet',
  }), /approved Pepper sandbox destination/i)
  assert.throws(() => validateAegisDestinationConfig({
    ...config,
    sheetName: 'Daily Action Log',
  }), /dedicated Pepper Appointment Tests tab/i)
  assert.throws(() => validateAegisDestinationConfig({
    ...config,
    serviceAccountJson: '',
  }), /service account is not configured/i)
})

test('AEGIS production contract enforces workbook, tab, and dedicated credential identity', () => {
  const serviceAccountEmail = 'pepper-aegis-production-writer@example.iam.gserviceaccount.com'
  const production = {
    mode: 'production',
    spreadsheetId: AEGIS_PRODUCTION_SPREADSHEET_ID,
    sheetName: AEGIS_PRODUCTION_SHEET_NAME,
    serviceAccountJson: JSON.stringify({ client_email: serviceAccountEmail }),
    expectedServiceAccountEmail: serviceAccountEmail,
  }
  assert.doesNotThrow(() => validateAegisDestinationConfig(production))
  assert.throws(() => validateAegisDestinationConfig({
    ...production,
    sheetName: 'Calendar Events',
  }), /Pepper Appointments/)
  assert.throws(() => validateAegisDestinationConfig({
    ...production,
    spreadsheetId: AEGIS_SANDBOX_SPREADSHEET_ID,
  }), /approved Pepper production destination/)
  assert.throws(() => validateAegisDestinationConfig({
    ...production,
    expectedServiceAccountEmail: 'different@example.iam.gserviceaccount.com',
  }), /not approved for the production AEGIS workbook/)
  assert.throws(() => validateAegisDestinationConfig({
    ...production,
    serviceAccountJson: JSON.stringify({
      client_email: 'pepper-aegis-sandbox-writer@example.iam.gserviceaccount.com',
    }),
    expectedServiceAccountEmail: 'pepper-aegis-sandbox-writer@example.iam.gserviceaccount.com',
  }), /sandbox service account cannot write to production/i)
})

function sandboxCalendarConnection(calendarId, accountEmail = 'danielle@example.com') {
  const installationId = '549327fd-3d38-4458-9a50-6f7c47c11ed3'
  return {
    provider_calendar_id: calendarId,
    calendar_name: 'Pepper Sandbox',
    calendar_setup_method: PEPPER_CALENDAR_SETUP_METHOD,
    calendar_created_at: '2026-09-16T18:00:00.000Z',
    calendar_mode: 'sandbox',
    pepper_installation_id: installationId,
    pepper_calendar_marker: pepperCalendarMarker(installationId),
    google_account_email: accountEmail,
    google_account_subject: 'sandbox-google-subject',
    google_data_owner: accountEmail,
    access_scope: GOOGLE_OAUTH_SCOPE,
  }
}

test('calendar sandbox rejects primary and alternate destinations without ID-shape rules', () => {
  const calendarId = 'pepper-sandbox-calendar@example.com'
  const connection = sandboxCalendarConnection(calendarId)
  assert.equal(validateCalendarConnectionProof(connection, 'sandbox', 'danielle@example.com', calendarId).id, calendarId)
  assert.throws(
    () => validateCalendarConnectionProof(connection, 'sandbox', 'danielle@example.com', 'primary'),
    /primary_calendar_rejected/,
  )
  assert.throws(
    () => validateCalendarConnectionProof(connection, 'sandbox', 'danielle@example.com', 'family@example.com'),
    /calendar_not_allowlisted/,
  )
})

test('calendar sandbox metadata requires the exact app-created resource proof', () => {
  const calendarId = 'pepper-sandbox-calendar@example.com'
  const accountEmail = 'danielle@example.com'
  const destination = validateCalendarConnectionProof(
    sandboxCalendarConnection(calendarId, accountEmail),
    'sandbox',
    accountEmail,
    calendarId,
  )
  assert.deepEqual(validateCalendarResource({
    id: calendarId,
    summary: 'Pepper Sandbox',
    description: destination.marker,
    dataOwner: accountEmail,
    timeZone: 'America/Los_Angeles',
  }, destination, { email: accountEmail, subject: 'sandbox-google-subject' }), {
    id: calendarId,
    mode: 'sandbox',
    name: 'Pepper Sandbox',
    marker: destination.marker,
    dataOwner: accountEmail,
    timeZone: 'America/Los_Angeles',
  })
  assert.throws(() => validateCalendarResource({
    id: calendarId,
    summary: 'Family',
    description: destination.marker,
    dataOwner: accountEmail,
  }, destination, { email: accountEmail, subject: 'sandbox-google-subject' }), /sandbox_calendar_name_mismatch/)
  assert.throws(() => validateCalendarResource({
    id: calendarId,
    summary: 'Pepper Sandbox',
    description: destination.marker,
    dataOwner: 'someone-else@example.com',
  }, destination, { email: accountEmail, subject: 'sandbox-google-subject' }), /calendar_data_owner_mismatch/)
})

test('sandbox calendar payloads are synthetic and contain no guests', () => {
  const payload = buildGoogleAppointmentPayload({
    id: eventId,
    title: 'Karin Eshagh, MD appointment',
    starts_at: appointment.starts_at,
    ends_at: appointment.ends_at,
    location: appointment.location,
    preparation_instructions: appointment.preparation_instructions,
    clinician_name: appointment.clinician,
    facility_name: appointment.facility,
    appointment_type: appointment.appointment_type,
    source_timezone: appointment.timezone,
    external_event_id: null,
    status: appointment.status,
  }, captureId, true, 'sandbox')
  assert.ok(payload.summary.startsWith(`${PEPPER_TEST_EVENT_PREFIX} `))
  assert.equal('attendees' in payload, false)
})

test('the exact AEGIS contract has 19 columns and stable appointment and delivery IDs', () => {
  assert.equal(AEGIS_APPOINTMENT_HEADERS.length, 19)
  assert.deepEqual(AEGIS_APPOINTMENT_HEADERS, [
    'record_id', 'event_id', 'capture_id', 'status', 'title', 'starts_at', 'ends_at',
    'timezone', 'appointment_type', 'patient_member_id', 'patient_slug', 'clinician',
    'facility', 'location', 'preparation_instructions', 'original_source_text',
    'dedupe_key', 'updated_at', 'source',
  ])
  const row = appointmentSheetRow(config, appointment, captureId, '2026-09-16T11:00:00.000Z')
  assert.equal(row[0], `pepper-event:${eventId}`)
  assert.equal(row[16], aegisAppointmentDeliveryId(eventId))
})

test('production AEGIS rows are not marked as synthetic', () => {
  const serviceAccountEmail = 'pepper-aegis-production-writer@example.iam.gserviceaccount.com'
  const production = {
    mode: 'production',
    spreadsheetId: AEGIS_PRODUCTION_SPREADSHEET_ID,
    sheetName: AEGIS_PRODUCTION_SHEET_NAME,
    serviceAccountJson: JSON.stringify({ client_email: serviceAccountEmail }),
    expectedServiceAccountEmail: serviceAccountEmail,
  }
  const row = appointmentSheetRow(production, appointment, captureId, '2026-09-16T11:00:00.000Z')
  assert.equal(row[4], appointment.title)
  assert.equal(row[18], 'Pepper appointment bridge')
  assert.equal(row.some((value) => value.includes(PEPPER_TEST_ROW_PREFIX)), false)
})

test('runtime contract uses a delivery lease and never claims One Brain completion while incomplete', async () => {
  const [bridge, migration, tell, client, calendar] = await Promise.all([
    readFile(new URL('../supabase/functions/aegis-bridge-worker/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260916143000_fail_closed_aegis_sandbox_delivery.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/pepper-tell-v2/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/pepper/pepper-client.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/pepper-calendar/index.ts', import.meta.url), 'utf8'),
  ])
  assert.match(bridge, /pepper_claim_aegis_sheet_delivery/)
  assert.match(bridge, /pepper_finish_aegis_sheet_delivery/)
  assert.doesNotMatch(bridge, /aegis_status_input:\s*'synced'/)
  assert.match(migration, /for update/i)
  assert.match(migration, /aegis_lease_expires_at/)
  assert.match(migration, /cannot be marked synced without write and readback timestamps/i)
  assert.match(tell, /delivery_complete: complete/)
  assert.match(client, /Delivery pending/)
  assert.match(client, /Saved in Pepper/)
  assert.match(calendar, /requireStoredCalendar/)
  assert.match(calendar, /PEPPER_GOOGLE_ACCOUNT_EMAIL/)
  assert.match(calendar, /calendar_setup_method/)
  assert.match(calendar, /calendar_probe_completed_at/)
  assert.match(calendar, /include_granted_scopes', 'false'/)
  assert.doesNotMatch(calendar, /users\/me\/calendarList/)
  assert.doesNotMatch(calendar, /gmail\.googleapis|auth\/gmail/)
  assert.doesNotMatch(calendar, /const calendarId = 'primary'/)
})
