/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  appointmentDeliveryState,
  googleAppointmentDeliveryStatus,
} from './logic.ts'
import { createAegisSheetsGateway } from './google-sheets.ts'
import {
  aegisAppointmentRecordId,
  classifyAegisSheetsFailure,
  deliverAegisAppointment,
  type AegisDestinationMode,
  type AegisDeliveryResult,
  type AegisDeliveryStatus,
} from './sheets.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const REST = `${SUPABASE_URL}/rest/v1`
const CALENDAR = `${SUPABASE_URL}/functions/v1/pepper-calendar`
const PRODUCER_KEY = 'aegis-v11-sites'
const AEGIS_MODE_VALUE = Deno.env.get('AEGIS_MODE') || ''
if (!['sandbox', 'production'].includes(AEGIS_MODE_VALUE)) {
  throw new Error('AEGIS_MODE must be configured as sandbox or production.')
}
const AEGIS_MODE = AEGIS_MODE_VALUE as AegisDestinationMode
const AEGIS_SANDBOX_ID = Deno.env.get('AEGIS_SANDBOX_SPREADSHEET_ID') || ''
const AEGIS_SANDBOX_SHEET_NAME = Deno.env.get('AEGIS_SANDBOX_SHEET_NAME') || ''
const AEGIS_PRODUCTION_ID = Deno.env.get('AEGIS_PRODUCTION_SPREADSHEET_ID') || ''
const AEGIS_PRODUCTION_SHEET_NAME = Deno.env.get('AEGIS_PRODUCTION_SHEET_NAME') || ''
const AEGIS_PRODUCTION_SERVICE_ACCOUNT_EMAIL = Deno.env.get('AEGIS_PRODUCTION_SERVICE_ACCOUNT_EMAIL') || ''
const AEGIS_SERVICE_ACCOUNT_JSON = Deno.env.get('AEGIS_GOOGLE_SERVICE_ACCOUNT_JSON') || ''
const AEGIS_SPREADSHEET_ID = AEGIS_MODE === 'sandbox' ? AEGIS_SANDBOX_ID : AEGIS_PRODUCTION_ID
const AEGIS_SHEET_NAME = AEGIS_MODE === 'sandbox' ? AEGIS_SANDBOX_SHEET_NAME : AEGIS_PRODUCTION_SHEET_NAME
const INTAKE_ID = /^AEGIS-IN-[0-9]{8}-[0-9]{3,}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TASK_STATUSES = new Set(['open', 'in_progress', 'on_hold', 'completed', 'canceled'])
const VISIBILITIES = new Set(['private', 'household'])
const REFLECTION_TYPES = new Set(['gratitude', 'reflection', 'good_moment', 'memory', 'lesson', 'concern', 'win'])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function secureEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cleanString(value: unknown, max: number, required = false) {
  const result = String(value ?? '').trim()
  if (required && !result) throw Object.assign(new Error('A required text value is missing.'), { status: 400 })
  if (result.length > max) throw Object.assign(new Error('A text value is too long.'), { status: 400 })
  return result
}

function stringList(value: unknown, maxItems = 40, maxLength = 200) {
  if (value == null) return []
  if (!Array.isArray(value)) throw Object.assign(new Error('Expected a list.'), { status: 400 })
  const list = value.map((item) => cleanString(item, maxLength, true))
  if (list.length > maxItems) throw Object.assign(new Error('A list contains too many items.'), { status: 400 })
  return [...new Set(list)]
}

function optionalTimestamp(value: unknown) {
  if (value == null || value === '') return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('Invalid timestamp.'), { status: 400 })
  return date.toISOString()
}

function validDate(value: unknown) {
  const date = cleanString(value, 10, true)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('reflection_date must be YYYY-MM-DD.'), { status: 400 })
  }
  return date
}

function queryValue(value: unknown) {
  return encodeURIComponent(String(value))
}

async function rest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('apikey', SERVICE_ROLE_KEY)
  headers.set('authorization', `Bearer ${SERVICE_ROLE_KEY}`)
  headers.set('content-type', 'application/json')
  headers.set('accept', 'application/json')
  const response = await fetch(REST + path, { ...init, headers })
  const text = await response.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) {
    console.error('AEGIS bridge REST error', response.status, path, String(text).slice(0, 500))
    throw Object.assign(new Error('Pepper storage rejected a bridge operation.'), { status: 502 })
  }
  return data as any
}

async function producerTokenMatches(token: string) {
  if (!token || token.length < 64 || token.length > 200) return false
  const rows = await rest(
    `/aegis_bridge_producer_credentials?producer_key=eq.${queryValue(PRODUCER_KEY)}&active=is.true&revoked_at=is.null&select=secret_sha256&limit=1`,
  )
  return secureEqual(rows?.[0]?.secret_sha256 || '', await sha256(token))
}

async function getActor(memberSlug: string) {
  const households = await rest('/households?slug=eq.eriksen&select=id&limit=1')
  const householdId = households?.[0]?.id
  if (!householdId) throw Object.assign(new Error('Eriksen household was not found.'), { status: 422 })
  const members = await rest(
    `/household_members?household_id=eq.${queryValue(householdId)}&slug=eq.${queryValue(memberSlug)}&select=id,household_id,slug,display_name,role&limit=1`,
  )
  if (!members?.[0]) throw Object.assign(new Error('AEGIS bridge member was not found.'), { status: 422 })
  return members[0]
}

async function upsertTask(actor: any, raw: any) {
  const sourceRecord = cleanString(raw?.source_record, 160, true)
  const title = cleanString(raw?.title, 240, true)
  const ownerSlug = cleanString(raw?.owner_slug || actor.slug, 80, true)
  const owners = await rest(
    `/household_members?household_id=eq.${queryValue(actor.household_id)}&slug=eq.${queryValue(ownerSlug)}&select=id&limit=1`,
  )
  if (!owners?.[0]) throw Object.assign(new Error('Task owner was not found in the Eriksen household.'), { status: 422 })

  const existingRows = await rest(
    `/tasks?household_id=eq.${queryValue(actor.household_id)}&source_record=eq.${queryValue(sourceRecord)}&select=*&order=updated_at.desc&limit=1`,
  )
  const current = existingRows?.[0] || {}
  const status = cleanString(raw?.status ?? current.status ?? 'open', 40, true)
  const visibility = cleanString(raw?.visibility ?? current.visibility ?? 'household', 40, true)
  if (!TASK_STATUSES.has(status)) throw Object.assign(new Error('Unsupported task status.'), { status: 400 })
  if (!VISIBILITIES.has(visibility)) throw Object.assign(new Error('Unsupported task visibility.'), { status: 400 })
  const payload = {
    household_id: actor.household_id,
    title,
    owner_member_id: owners[0].id,
    creator_member_id: current.creator_member_id || actor.id,
    visibility,
    status,
    due_at: raw?.due_at === undefined ? (current.due_at || null) : optionalTimestamp(raw.due_at),
    source: 'aegis_bridge',
    area: cleanString(raw?.area ?? current.area ?? 'Personal', 100, true),
    project: cleanString(raw?.project ?? current.project ?? '', 160),
    priority: cleanString(raw?.priority ?? current.priority ?? 'P2', 40, true),
    classification: cleanString(raw?.classification ?? current.classification ?? 'Open', 100, true),
    tags: raw?.tags === undefined ? (current.tags || []) : stringList(raw.tags, 30, 80),
    notes: cleanString(raw?.notes ?? current.notes ?? '', 4000),
    source_record: sourceRecord,
    waiting_on: cleanString(raw?.waiting_on ?? current.waiting_on ?? '', 240),
    recurrence: cleanString(raw?.recurrence ?? current.recurrence ?? 'none', 120, true),
    next_action: cleanString(raw?.next_action ?? current.next_action ?? '', 1000),
  }
  if (current.id) {
    const rows = await rest(`/tasks?id=eq.${queryValue(current.id)}&select=id`, {
      method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload),
    })
    return { id: rows[0].id, operation: 'updated' }
  }
  const rows = await rest('/tasks?select=id', {
    method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(payload),
  })
  return { id: rows[0].id, operation: 'created' }
}

async function upsertReflection(actor: any, raw: any) {
  const reflectionDate = validDate(raw?.reflection_date)
  const type = cleanString(raw?.type || 'reflection', 40, true)
  const originalText = cleanString(raw?.original_text, 4000, true)
  if (!REFLECTION_TYPES.has(type)) throw Object.assign(new Error('Unsupported reflection type.'), { status: 400 })
  const rows = await rest(
    `/reflections?household_id=eq.${queryValue(actor.household_id)}&member_id=eq.${queryValue(actor.id)}&reflection_date=eq.${queryValue(reflectionDate)}&type=eq.${queryValue(type)}&select=id,original_text`,
  )
  const existing = (rows || []).find((item: any) => item.original_text === originalText)
  if (existing) return { id: existing.id, operation: 'replayed' }
  const inserted = await rest('/reflections?select=id', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      household_id: actor.household_id,
      member_id: actor.id,
      reflection_date: reflectionDate,
      type,
      original_text: originalText,
    }),
  })
  return { id: inserted[0].id, operation: 'created' }
}

async function syncAppointment(body: any) {
  const captureId = cleanString(body?.capture_id, 36, true)
  const eventId = cleanString(body?.event_id, 36, true)
  const dedupeKey = cleanString(body?.dedupe_key, 200, true)
  if (!UUID.test(captureId) || !UUID.test(eventId)) {
    throw Object.assign(new Error('A valid capture and event are required.'), { status: 400 })
  }
  const records = await rest(
    `/events?id=eq.${queryValue(eventId)}&dedupe_key=eq.${queryValue(dedupeKey)}&select=id,household_id,title,starts_at,ends_at,status,source_timezone,appointment_type,clinician_name,patient_member_id,person_slug,facility_name,location,preparation_instructions,original_source_text,dedupe_key&limit=1`,
  )
  const captures = await rest(
    `/captures?id=eq.${queryValue(captureId)}&select=id,household_id&limit=1`,
  )
  if (!records?.[0] || !captures?.[0] || records[0].household_id !== captures[0].household_id) {
    throw Object.assign(new Error('The appointment bridge evidence does not match.'), { status: 409 })
  }
  const event = records[0]
  const suppliedNormalized = body?.normalized_appointment
  const supplied = suppliedNormalized && typeof suppliedNormalized === 'object' && !Array.isArray(suppliedNormalized)
    ? suppliedNormalized
    : {}
  const normalized = {
    ...supplied,
    event_id: event.id,
    title: event.title,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    status: event.status,
    timezone: event.source_timezone || 'America/Los_Angeles',
    appointment_type: event.appointment_type,
    clinician: event.clinician_name,
    patient_member_id: event.patient_member_id,
    patient_slug: event.person_slug,
    facility: event.facility_name,
    location: event.location,
    preparation_instructions: event.preparation_instructions,
    original_source_text: event.original_source_text || supplied.original_source_text || event.title,
    scheduling_priority: 100,
  }
  if (normalized.event_id !== eventId || !normalized.starts_at || !normalized.original_source_text) {
    throw Object.assign(new Error('The normalized appointment is incomplete.'), { status: 400 })
  }

  const recordDelivery = async (
    aegisStatus: AegisDeliveryStatus,
    googleStatus: string,
    lastError: string | null,
  ) => {
    await rest('/rpc/pepper_record_appointment_bridge', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        event_id_input: eventId,
        capture_id_input: captureId,
        normalized_payload_input: normalized,
        aegis_status_input: aegisStatus,
        google_status_input: googleStatus,
        last_error_input: lastError,
      }),
    })
  }

  const leaseToken = crypto.randomUUID()
  const destination = `${AEGIS_SPREADSHEET_ID || 'unconfigured'}:${AEGIS_SHEET_NAME || 'unconfigured'}`
  let aegisResult: AegisDeliveryResult
  let leaseClaimed = false
  try {
    const claimResponse = await rest('/rpc/pepper_claim_aegis_sheet_delivery', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        event_id_input: eventId,
        capture_id_input: captureId,
        normalized_payload_input: normalized,
        lease_token_input: leaseToken,
      }),
    })
    const claim = Array.isArray(claimResponse) ? claimResponse[0] : claimResponse
    leaseClaimed = Boolean(claim?.claimed)
    if (!leaseClaimed) {
      aegisResult = {
        status: 'retry_required',
        recordId: aegisAppointmentRecordId(eventId),
        destination,
        operation: 'none',
        attemptedAt: new Date().toISOString(),
        writtenAt: null,
        verifiedAt: null,
        errorClass: 'delivery_busy',
        error: 'Another AEGIS delivery attempt currently owns this appointment.',
      }
    } else {
      const config = {
        mode: AEGIS_MODE,
        spreadsheetId: AEGIS_SPREADSHEET_ID,
        sheetName: AEGIS_SHEET_NAME,
        serviceAccountJson: AEGIS_SERVICE_ACCOUNT_JSON,
        expectedServiceAccountEmail: AEGIS_MODE === 'production'
          ? AEGIS_PRODUCTION_SERVICE_ACCOUNT_EMAIL
          : undefined,
      }
      aegisResult = await deliverAegisAppointment(
        createAegisSheetsGateway(config),
        config,
        normalized,
        captureId,
      )
    }
  } catch (error) {
    aegisResult = {
      status: classifyAegisSheetsFailure(error),
      recordId: aegisAppointmentRecordId(eventId),
      destination,
      operation: 'none',
      attemptedAt: new Date().toISOString(),
      writtenAt: null,
      verifiedAt: null,
      errorClass: String((error as { code?: unknown })?.code || 'aegis_delivery_failed').slice(0, 100),
      error: String((error as Error)?.message || 'AEGIS delivery failed.').slice(0, 500),
    }
  }

  if (!leaseClaimed && aegisResult.errorClass === 'delivery_busy') {
    return {
      ok: false,
      worker: 'aegis-bridge-worker',
      version: 6,
      action: 'appointment.sync',
      capture_id: captureId,
      event_id: eventId,
      replayed: true,
      aegis_status: aegisResult.status,
      google_status: 'pending',
      delivery_state: appointmentDeliveryState(aegisResult.status, 'pending'),
      aegis: {
        record_id: aegisResult.recordId,
        operation: aegisResult.operation,
        attempted_at: aegisResult.attemptedAt,
        written_at: null,
        verified_at: null,
        error_class: aegisResult.errorClass,
      },
      google: { status: 'pending', reason: 'delivery_busy' },
    }
  }

  if (leaseClaimed) {
    try {
      await rest('/rpc/pepper_finish_aegis_sheet_delivery', {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({
          event_id_input: eventId,
          lease_token_input: leaseToken,
          aegis_status_input: aegisResult.status,
          destination_input: aegisResult.destination,
          record_id_input: aegisResult.recordId,
          error_class_input: aegisResult.errorClass,
          last_error_input: aegisResult.error,
          written_at_input: aegisResult.writtenAt,
          verified_at_input: aegisResult.verifiedAt,
        }),
      })
    } catch (error) {
      aegisResult = {
        ...aegisResult,
        status: 'retry_required',
        verifiedAt: null,
        errorClass: 'delivery_ledger_failed',
        error: String((error as Error)?.message || 'AEGIS delivery ledger update failed.').slice(0, 500),
      }
    }
  }

  let calendarResult: any = {}
  let googleStatus = googleAppointmentDeliveryStatus('failed')
  try {
    const calendarResponse = await fetch(CALENDAR, {
      method: 'POST',
      headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'publish_event', event_id: eventId, capture_id: captureId }),
      signal: AbortSignal.timeout(20_000),
    })
    const calendarText = await calendarResponse.text()
    try { calendarResult = calendarText ? JSON.parse(calendarText) : {} } catch { calendarResult = {} }
    googleStatus = googleAppointmentDeliveryStatus(calendarResult.status)
    if (!calendarResponse.ok && googleStatus === 'failed') {
      calendarResult.reason = calendarResult.error || 'Google Calendar publishing failed.'
    }
  } catch (error) {
    calendarResult = {
      status: 'failed',
      reason: String((error as Error)?.message || 'Google Calendar publishing failed.').slice(0, 500),
    }
    googleStatus = googleAppointmentDeliveryStatus('failed')
  }
  const deliveryError = ['retry_required', 'failed'].includes(googleStatus)
    ? cleanString(calendarResult.reason || 'Google Calendar delivery requires retry.', 500)
    : null
  const combinedError = [aegisResult.error, deliveryError].filter(Boolean).join(' ').slice(0, 500) || null
  const deliveryState = appointmentDeliveryState(aegisResult.status, googleStatus)

  await recordDelivery(aegisResult.status, googleStatus, combinedError)
  await rest(`/captures?id=eq.${queryValue(captureId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      aegis_sync_status: aegisResult.status === 'synced'
        ? 'synced'
        : aegisResult.status === 'needs_review' ? 'needs_review' : 'failed',
      aegis_last_attempt_at: new Date().toISOString(),
      aegis_synced_at: aegisResult.verifiedAt,
      aegis_destination: aegisResult.destination,
      aegis_record_ids: aegisResult.status === 'synced'
        ? [{ entity_type: 'event', record_id: eventId, external_record_id: aegisResult.recordId }]
        : [],
      aegis_sync_error: aegisResult.error,
    }),
  })
  return {
    ok: deliveryState === 'synced',
    worker: 'aegis-bridge-worker',
    version: 6,
    action: 'appointment.sync',
    capture_id: captureId,
    event_id: eventId,
    replayed: Boolean(calendarResult.replayed),
    aegis_status: aegisResult.status,
    google_status: googleStatus,
    delivery_state: deliveryState,
    aegis: {
      record_id: aegisResult.recordId,
      operation: aegisResult.operation,
      attempted_at: aegisResult.attemptedAt,
      written_at: aegisResult.writtenAt,
      verified_at: aegisResult.verifiedAt,
      error_class: aegisResult.errorClass,
    },
    google: calendarResult,
  }
}

async function processAegisIntake(body: any) {
  const intakeId = cleanString(body?.intake_id, 80, true)
  const originalText = typeof body?.original_text === 'string' ? body.original_text : ''
  if (!originalText.trim() || originalText.length > 4000) {
    throw Object.assign(new Error('The original intake text is required and must be 4,000 characters or fewer.'), { status: 400 })
  }
  const memberSlug = cleanString(body?.member_slug || 'elle', 80, true)
  if (!INTAKE_ID.test(intakeId)) throw Object.assign(new Error('Invalid AEGIS Intake ID.'), { status: 400 })
  if (memberSlug !== 'elle') throw Object.assign(new Error('The initial bridge is restricted to Elle intake.'), { status: 403 })
  const canonicalRecords = stringList(body?.canonical_records || [intakeId])
  if (!canonicalRecords.includes(intakeId)) canonicalRecords.unshift(intakeId)
  const actor = await getActor(memberSlug)
  const dedupeKey = `aegis:${intakeId}`
  let captures = await rest(
    `/captures?household_id=eq.${queryValue(actor.household_id)}&dedupe_key=eq.${queryValue(dedupeKey)}&select=id,original_text,member_id&limit=1`,
  )
  const existing = captures?.[0]
  if (existing && (existing.original_text !== originalText || existing.member_id !== actor.id)) {
    throw Object.assign(new Error('That AEGIS Intake ID already belongs to different evidence.'), { status: 409 })
  }
  if (!existing) {
    try {
      captures = await rest('/captures?select=id,original_text,member_id', {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({
          household_id: actor.household_id,
          member_id: actor.id,
          source: 'sync',
          original_text: originalText,
          status: 'captured',
          extracted_facts: [{ type: 'aegis_intake', intake_id: intakeId }],
          applied_changes: [],
          dedupe_key: dedupeKey,
          aegis_sync_status: 'captured',
          aegis_last_attempt_at: new Date().toISOString(),
          aegis_destination: 'AEGIS HOME -> Pepper',
          aegis_record_ids: canonicalRecords,
          sharing_scope: 'member_private',
          remaining_ambiguities: [],
        }),
      })
    } catch (error) {
      captures = await rest(
        `/captures?household_id=eq.${queryValue(actor.household_id)}&dedupe_key=eq.${queryValue(dedupeKey)}&select=id,original_text,member_id&limit=1`,
      )
      if (!captures?.[0]) throw error
    }
  }
  const captureId = (existing || captures?.[0])?.id
  if (!captureId) throw new Error('Pepper did not return the preserved capture.')
  const task = body?.task ? await upsertTask(actor, body.task) : null
  const reflection = body?.reflection ? await upsertReflection(actor, body.reflection) : null
  const appliedChanges = [
    ...canonicalRecords.map((recordId) => ({ destination: 'AEGIS HOME', record_id: recordId })),
    ...(task ? [{ destination: 'Pepper task', record_id: task.id, operation: task.operation }] : []),
    ...(reflection ? [{ destination: 'Pepper reflection', record_id: reflection.id, operation: reflection.operation }] : []),
  ]
  await rest(`/captures?id=eq.${queryValue(captureId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'applied',
      applied_changes: appliedChanges,
      aegis_sync_status: 'synced',
      aegis_last_attempt_at: new Date().toISOString(),
      aegis_synced_at: new Date().toISOString(),
      aegis_destination: 'AEGIS HOME -> Pepper',
      aegis_record_ids: canonicalRecords,
      aegis_sync_error: null,
      reconciled_by_member_id: actor.id,
      reconciled_at: new Date().toISOString(),
      reconciliation_version: 1,
    }),
  })
  return {
    ok: true,
    worker: 'aegis-bridge-worker',
    version: 4,
    intake_id: intakeId,
    replayed: Boolean(existing),
    capture_id: captureId,
    task,
    reflection,
    canonical_records: canonicalRecords,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const serviceToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const producerToken = req.headers.get('x-aegis-bridge-token') || ''
  const serviceAuthorized = secureEqual(serviceToken, SERVICE_ROLE_KEY)
  const producerAuthorized = serviceAuthorized ? false : await producerTokenMatches(producerToken)
  if (!serviceAuthorized && !producerAuthorized) return json({ error: 'Server authorization required.' }, 403)
  try {
    const body = await req.json()
    if (body?.action === 'appointment.sync' && !serviceAuthorized) {
      return json({ error: 'Service authorization required for appointment delivery.' }, 403)
    }
    return json(body?.action === 'appointment.sync'
      ? await syncAppointment(body)
      : await processAegisIntake(body))
  } catch (error) {
    console.error('AEGIS bridge error', error)
    const status = Number((error as any)?.status) || 500
    return json({
      error: status >= 500 ? 'AEGIS bridge could not complete the requested write.' : String((error as Error).message),
    }, status)
  }
})
