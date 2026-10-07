import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  appointmentDedupeKey,
  appointmentEventId,
  parseAppointmentText,
} from '../supabase/functions/_shared/appointment-intake.ts'
import { buildDailyPlan } from '../supabase/functions/pepper-family-api/day-planning.ts'
import {
  classifyPiece,
  clarificationFor,
  isAppointmentPreparationPiece,
  reviewRetryText,
} from '../supabase/functions/pepper-tell-v2/logic.ts'
import { medicalCoordinationPriority } from '../supabase/functions/_shared/medical-scheduling.ts'

const tellPath = new URL('../supabase/functions/pepper-tell-v2/index.ts', import.meta.url)
const bridgePath = new URL('../supabase/functions/aegis-bridge-worker/index.ts', import.meta.url)
const calendarPath = new URL('../supabase/functions/pepper-calendar/index.ts', import.meta.url)
const migrationPath = new URL(
  '../supabase/migrations/20260915164500_harden_appointment_intake_and_bridge.sql',
  import.meta.url,
)
const updateMigrationPath = new URL(
  '../supabase/migrations/20260916120000_sync_published_appointments.sql',
  import.meta.url,
)

test('MyChart date, PM marker, Pacific zone, clinician, and source survive normalization', () => {
  const source = 'MyChart: Lyra has an appointment 09/19 at 1:45 PM PDT with Karin Eshagh, MD. Bring insurance and a medication list.'
  const result = parseAppointmentText(source, { today: '2026-09-15' })

  assert.equal(result.status, 'parsed')
  assert.equal(result.startsAt, '2026-09-19T13:45:00-07:00')
  assert.equal(result.localDate, '2026-09-19')
  assert.equal(result.localTime, '13:45')
  assert.equal(result.timeZone, 'America/Los_Angeles')
  assert.equal(result.dateSource, 'explicit')
  assert.equal(result.timeSource, 'explicit')
  assert.equal(result.timezoneSource, 'explicit')
  assert.equal(result.clinician, 'Karin Eshagh, MD')
  assert.equal(result.patientSlug, 'lyra')
  assert.match(result.preparationInstructions, /Bring insurance/)
  assert.equal(result.originalText, source)
})

test('credentialed MyChart phrasing is routed to appointment intake without a keyword', () => {
  const intent = classifyPiece('09/19 at 1:45 PM PDT with Karin Eshagh, MD', '2026-09-15')

  assert.equal(intent.type, 'event.create')
  assert.equal(intent.appointment?.status, 'parsed')
  assert.equal(intent.appointment?.startsAt, '2026-09-19T13:45:00-07:00')
  assert.equal(intent.appointment?.clinician, 'Karin Eshagh, MD')
  assert.equal(isAppointmentPreparationPiece('Bring insurance and a medication list'), true)
  assert.equal(isAppointmentPreparationPiece('Bring lumber to the framing site'), false)
})

test('review clarification is appended to the immutable source instead of the error text', () => {
  assert.equal(
    reviewRetryText('doctor next Thursday afternoon', 'at 3:00 PM'),
    'doctor next Thursday afternoon at 3:00 PM',
  )
  const intent = classifyPiece(
    reviewRetryText('doctor next Thursday afternoon', 'at 3:00 PM'),
    '2026-09-15',
  )
  assert.equal(intent.type, 'event.create')
  assert.equal(intent.appointment?.status, 'parsed')
  assert.equal(intent.appointment?.startsAt, '2026-09-24T15:00:00-07:00')
})

test('named dates and AM versus PM retain their source meaning', () => {
  assert.equal(
    parseAppointmentText('Doctor appointment Oct 1st at 8am', { today: '2026-09-15' }).startsAt,
    '2026-10-01T08:00:00-07:00',
  )
  assert.equal(
    parseAppointmentText('Doctor appointment Oct 1st at 8pm', { today: '2026-09-15' }).startsAt,
    '2026-10-01T20:00:00-07:00',
  )
  assert.equal(
    parseAppointmentText('Doctor appointment Oct 1st at 12am', { today: '2026-09-15' }).localTime,
    '00:00',
  )
  assert.equal(
    parseAppointmentText('Doctor appointment Oct 1st at 12pm', { today: '2026-09-15' }).localTime,
    '12:00',
  )
})

test('dates without a year choose the next valid local occurrence', () => {
  assert.equal(
    parseAppointmentText('Appointment 09/19 at 1 PM', { today: '2026-09-15' }).localDate,
    '2026-09-19',
  )
  assert.equal(
    parseAppointmentText('Appointment 09/19 at 1 PM', { today: '2026-10-02' }).localDate,
    '2027-09-19',
  )
  assert.equal(
    parseAppointmentText('Appointment Oct 1st at 8am', { today: '2026-10-02' }).localDate,
    '2027-10-01',
  )
  assert.equal(
    parseAppointmentText('Appointment 02/29 at 8am', { today: '2026-03-01' }).localDate,
    '2028-02-29',
  )
})

test('Pacific daylight and standard time use America/Los_Angeles rules', () => {
  assert.equal(
    parseAppointmentText('Appointment July 15, 2026 at 8 AM PDT', { today: '2026-01-01' }).startsAt,
    '2026-07-15T08:00:00-07:00',
  )
  assert.equal(
    parseAppointmentText('Appointment January 15, 2026 at 8 AM PST', { today: '2026-01-01' }).startsAt,
    '2026-01-15T08:00:00-08:00',
  )
  assert.equal(
    parseAppointmentText('Appointment November 1, 2026 at 1:30 AM PDT', { today: '2026-01-01' }).startsAt,
    '2026-11-01T01:30:00-07:00',
  )
  assert.equal(
    parseAppointmentText('Appointment November 1, 2026 at 1:30 AM PST', { today: '2026-01-01' }).startsAt,
    '2026-11-01T01:30:00-08:00',
  )
  const mismatchedZone = parseAppointmentText(
    'Appointment January 15, 2026 at 8 AM PDT',
    { today: '2026-01-01' },
  )
  assert.equal(mismatchedZone.status, 'needs_review')
  assert.match(mismatchedZone.unresolvedFields.join(' '), /^timezone:/i)
  const missingWallTime = parseAppointmentText(
    'Appointment March 8, 2026 at 2:30 AM PST',
    { today: '2026-01-01' },
  )
  assert.equal(missingWallTime.status, 'needs_review')
  assert.match(missingWallTime.unresolvedFields.join(' '), /does not exist/i)
})

test('explicit values beat calendar context and local defaults only fill absent values', () => {
  const explicit = parseAppointmentText('Appointment 09/19 at 1:45 PM PDT', {
    today: '2026-09-15',
    calendarDate: '2026-09-22',
    calendarTime: '09:00',
    timeZone: 'America/Los_Angeles',
  })
  assert.equal(explicit.localDate, '2026-09-19')
  assert.equal(explicit.localTime, '13:45')
  assert.equal(explicit.dateSource, 'explicit')
  assert.equal(explicit.timeSource, 'explicit')

  const contextual = parseAppointmentText('Doctor appointment at 8 AM', {
    today: '2026-09-15',
    calendarDate: '2026-09-22',
  })
  assert.equal(contextual.localDate, '2026-09-22')
  assert.equal(contextual.dateSource, 'calendar_context')

  const defaulted = parseAppointmentText('Doctor appointment at 8 AM', { today: '2026-09-15' })
  assert.equal(defaulted.localDate, '2026-09-15')
  assert.equal(defaulted.dateSource, 'user_local_default')
})

test('malformed or ambiguous explicit fields are held for review without fallback writes', () => {
  const badDate = parseAppointmentText('Doctor appointment 09/31 at 1:45 PM', { today: '2026-09-15' })
  assert.equal(badDate.status, 'needs_review')
  assert.equal(badDate.startsAt, null)
  assert.match(badDate.unresolvedFields[0], /^date:/)

  const ambiguousTime = parseAppointmentText('Doctor appointment 09/19 at 1:45', { today: '2026-09-15' })
  assert.equal(ambiguousTime.status, 'needs_review')
  assert.equal(ambiguousTime.startsAt, null)
  assert.match(ambiguousTime.unresolvedFields.join(' '), /time:/)

  const intent = classifyPiece('Schedule doctor appointment 09/31 at 1:45 PM', '2026-09-15')
  assert.equal(intent.type, 'ambiguous')
  assert.match(intent.unresolvedFields.join(' '), /^date:/)
  assert.match(clarificationFor(`${intent.unresolvedFields[0]}. Original: ${intent.text}`).question, /appointment date/i)
})

test('physical therapy and mental-health therapy remain distinct', () => {
  assert.equal(
    parseAppointmentText('Physical therapy appointment Oct 1 at 8 AM', { today: '2026-09-15' }).appointmentType,
    'physical_therapy',
  )
  assert.equal(
    parseAppointmentText('Mental health therapy appointment Oct 1 at 8 AM', { today: '2026-09-15' }).appointmentType,
    'mental_health_therapy',
  )
})

test('patient, clinician, facility, location, preparation, and source remain distinct', () => {
  const source = 'Chloe physical therapy appointment Oct 1st at 8am with Jamie Lee, DPT. Facility: Ventura Orthopedics. Location: 123 Main St. Arrive 15 minutes early and bring insurance.'
  const result = parseAppointmentText(source, { today: '2026-09-15' })

  assert.equal(result.status, 'parsed')
  assert.equal(result.patientSlug, 'chloe')
  assert.equal(result.clinician, 'Jamie Lee, DPT')
  assert.equal(result.facility, 'Ventura Orthopedics')
  assert.equal(result.location, '123 Main St')
  assert.match(result.preparationInstructions, /Arrive 15 minutes early/)
  assert.equal(result.originalText, source)
})

test('repeated processing produces the same semantic key and event id', () => {
  const parsed = parseAppointmentText('Chloe dentist appointment Oct 1 at 8 AM', { today: '2026-09-15' })
  const input = {
    title: 'Chloe dentist appointment',
    startsAt: parsed.startsAt,
    patientSlug: parsed.patientSlug,
    appointmentType: parsed.appointmentType,
    clinician: parsed.clinician,
  }
  const firstKey = appointmentDedupeKey(input)
  const secondKey = appointmentDedupeKey({ ...input })
  assert.equal(firstKey, secondKey)
  assert.equal(appointmentEventId(firstKey), appointmentEventId(secondKey))
})

test('medical appointments outrank school and work while producing coordination conflicts', () => {
  const plan = buildDailyPlan({
    now: '2026-09-19T15:00:00.000Z',
    dayStart: '2026-09-19T07:00:00.000Z',
    dayEnd: '2026-09-20T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    emails: [],
    events: [
      {
        id: 'medical',
        title: 'Dermatology appointment',
        starts_at: '2026-09-19T20:45:00.000Z',
        ends_at: '2026-09-19T21:45:00.000Z',
        kind: 'appointment',
        appointment_type: 'doctor',
      },
      {
        id: 'school',
        title: 'School rehearsal',
        starts_at: '2026-09-19T20:30:00.000Z',
        ends_at: '2026-09-19T21:30:00.000Z',
        kind: 'school',
      },
      {
        id: 'work',
        title: 'Work client meeting',
        starts_at: '2026-09-19T21:00:00.000Z',
        ends_at: '2026-09-19T22:00:00.000Z',
        kind: 'work',
      },
    ],
  })

  const medical = plan.items.find((item) => item.record_id === 'medical')
  assert.equal(medical.urgency, 'critical')
  assert.match(medical.reason, /school and work coordinate around it/i)
  assert.match(plan.headline, /top fixed priority/i)
  assert.equal(plan.conflicts.filter((conflict) => /remains the priority/i.test(conflict)).length, 1)
  assert.match(plan.conflicts.join(' '), /coordinate school coverage/i)
  assert.match(plan.conflicts.join(' '), /coordinate work coverage/i)
})

test('medical coordination uses P0 only when unresolved logistics are imminent', () => {
  assert.equal(medicalCoordinationPriority({
    appointmentStartsAt: '2026-09-16T20:00:00.000Z',
    now: '2026-09-15T20:00:00.000Z',
    unresolvedLogistics: true,
  }).priority, 'P0')
  assert.equal(medicalCoordinationPriority({
    appointmentStartsAt: '2026-10-16T20:00:00.000Z',
    now: '2026-09-15T20:00:00.000Z',
    unresolvedLogistics: true,
  }).priority, 'P1')
  assert.equal(medicalCoordinationPriority({
    appointmentStartsAt: '2026-10-16T20:00:00.000Z',
    now: '2026-09-15T20:00:00.000Z',
    unresolvedLogistics: false,
    routinePreparation: true,
  }).priority, 'P2')
  assert.notEqual(medicalCoordinationPriority({
    appointmentStartsAt: '2026-09-10T20:00:00.000Z',
    now: '2026-09-15T20:00:00.000Z',
    unresolvedLogistics: true,
  }).priority, 'P0')
})

test('future medical coordination cannot flood the daily plan', () => {
  const plan = buildDailyPlan({
    now: '2026-09-15T15:00:00.000Z',
    dayStart: '2026-09-15T07:00:00.000Z',
    dayEnd: '2026-09-16T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    events: [],
    emails: [],
    tasks: [
      {
        id: 'payroll', title: 'Submit payroll today', project: 'Payroll', status: 'open',
        importance: 'critical', urgency: 'today', deadline_type: 'hard',
        due_date_confidence: 1, due_at: '2026-09-15T23:00:00.000Z', estimated_minutes: 45,
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `medical-${index}`, title: `Coordinate future appointment ${index + 1}`,
        project: 'Medical coordination', source: 'pepper_medical_coordination', status: 'open',
        importance: 'high', urgency: 'upcoming', deadline_type: 'soft', due_date_confidence: 1,
        due_at: `2026-10-${String(index + 10).padStart(2, '0')}T20:00:00.000Z`, estimated_minutes: 30,
      })),
    ],
  })
  assert.ok(plan.items.some((item) => item.record_id === 'payroll'))
  assert.ok(plan.items.filter((item) => item.project === 'Medical coordination').length <= 2)
})

test('the canonical pipeline invokes the bridge automatically and records idempotent delivery', async () => {
  const [tell, bridge, calendar, migration, updateMigration] = await Promise.all([
    readFile(tellPath, 'utf8'),
    readFile(bridgePath, 'utf8'),
    readFile(calendarPath, 'utf8'),
    readFile(migrationPath, 'utf8'),
    readFile(updateMigrationPath, 'utf8'),
  ])

  assert.match(tell, /syncAppointmentBridges/)
  assert.match(tell, /functions\/v1\/aegis-bridge-worker/)
  assert.match(tell, /action:\s*'appointment\.sync'/)
  assert.match(tell, /appointmentItemsForReplay\(currentMember, appliedChanges\)/)
  assert.match(bridge, /pepper_record_appointment_bridge/)
  assert.match(bridge, /pepper_claim_aegis_sheet_delivery/)
  assert.match(bridge, /pepper_finish_aegis_sheet_delivery/)
  assert.match(bridge, /action:\s*'publish_event'/)
  assert.match(calendar, /GOOGLE_OAUTH_SCOPE/)
  assert.match(calendar, /hasGoogleCalendarAppCreatedScope/)
  assert.match(calendar, /createPepperCalendar/)
  assert.match(calendar, /googleEventIdForPepper/)
  assert.match(migration, /create unique index[^;]+events_household_dedupe_uidx/is)
  assert.match(migration, /appointment_bridge_deliveries/)
  assert.match(migration, /scheduling_priority = 100/)
  assert.match(migration, /new\.source = 'pepper_medical_coordination'/)
  assert.match(updateMigration, /days_until_due between 0 and 2/)
  assert.match(updateMigration, /new\.priority := 'P1'/)
  assert.match(updateMigration, /new\.priority := 'P2'/)
  assert.match(updateMigration, /pepper_schedule_calendar_sync/)
})
