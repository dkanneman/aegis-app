export const AEGIS_SANDBOX_SPREADSHEET_ID = '1YkDlsRzNoLZtVMpV1vbPSRE3VLZ1Hae8p-LYMP7-Q7U'
export const AEGIS_PRODUCTION_SPREADSHEET_ID = '10v670z9ajMof7lR2mngmGbD4zwnDMjuAYzX8cG_C7y4'
export const AEGIS_SANDBOX_SHEET_NAME = 'Pepper Appointment Tests'
export const AEGIS_PRODUCTION_SHEET_NAME = 'Pepper Appointments'
export const PEPPER_TEST_ROW_PREFIX = '[PEPPER TEST]'

export const AEGIS_APPOINTMENT_HEADERS = [
  'record_id',
  'event_id',
  'capture_id',
  'status',
  'title',
  'starts_at',
  'ends_at',
  'timezone',
  'appointment_type',
  'patient_member_id',
  'patient_slug',
  'clinician',
  'facility',
  'location',
  'preparation_instructions',
  'original_source_text',
  'dedupe_key',
  'updated_at',
  'source',
] as const

export type AegisDeliveryStatus =
  | 'pending'
  | 'synced'
  | 'retry_required'
  | 'reconnect_required'
  | 'needs_review'
  | 'failed'

export type AegisDestinationMode = 'sandbox' | 'production'

export type AegisDestinationConfig = {
  mode: AegisDestinationMode
  spreadsheetId: string
  sheetName: string
  serviceAccountJson: string
  expectedServiceAccountEmail?: string
}

export type AegisAppointment = Record<string, unknown> & {
  event_id: string
  title: string
  starts_at: string
  status: string
}

export type AegisSheetRow = {
  rowNumber: number
  values: string[]
}

export type AegisSheetsGateway = {
  findRowsByRecordId(recordId: string): Promise<AegisSheetRow[]>
  appendRow(values: string[]): Promise<number>
  updateRow(rowNumber: number, values: string[]): Promise<void>
  readRow(rowNumber: number): Promise<string[]>
}

export type AegisDeliveryResult = {
  status: AegisDeliveryStatus
  recordId: string
  destination: string
  operation: 'append' | 'update' | 'none'
  attemptedAt: string
  writtenAt: string | null
  verifiedAt: string | null
  errorClass: string | null
  error: string | null
}

export class AegisSheetsError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function validateAegisDestinationConfig(config: AegisDestinationConfig) {
  if (config.mode !== 'sandbox' && config.mode !== 'production') {
    throw new AegisSheetsError(503, 'aegis_mode_not_configured', 'AEGIS destination mode must be sandbox or production.')
  }
  if (!config.serviceAccountJson.trim()) {
    throw new AegisSheetsError(401, 'service_account_missing', 'The AEGIS service account is not configured.')
  }

  const expectedSpreadsheetId = config.mode === 'sandbox'
    ? AEGIS_SANDBOX_SPREADSHEET_ID
    : AEGIS_PRODUCTION_SPREADSHEET_ID
  const expectedSheetName = config.mode === 'sandbox'
    ? AEGIS_SANDBOX_SHEET_NAME
    : AEGIS_PRODUCTION_SHEET_NAME
  if (!config.spreadsheetId || config.spreadsheetId !== expectedSpreadsheetId) {
    throw new AegisSheetsError(403, 'spreadsheet_not_allowlisted', `The configured workbook is not the approved Pepper ${config.mode} destination.`)
  }
  if (config.sheetName.trim() !== expectedSheetName) {
    throw new AegisSheetsError(403, 'sheet_not_allowlisted', `Only the dedicated ${expectedSheetName} tab is allowed in ${config.mode} mode.`)
  }

  if (config.mode === 'production') {
    const expectedEmail = String(config.expectedServiceAccountEmail || '').trim().toLowerCase()
    if (!expectedEmail) {
      throw new AegisSheetsError(503, 'production_service_account_email_missing', 'The production AEGIS service-account email allowlist is not configured.')
    }
    let credentialEmail = ''
    try {
      credentialEmail = String(JSON.parse(config.serviceAccountJson)?.client_email || '').trim().toLowerCase()
    } catch {
      throw new AegisSheetsError(401, 'service_account_invalid', 'The service-account configuration is invalid JSON.')
    }
    if (!credentialEmail || credentialEmail !== expectedEmail) {
      throw new AegisSheetsError(403, 'service_account_not_allowlisted', 'The configured service account is not approved for the production AEGIS workbook.')
    }
    if (credentialEmail.includes('sandbox')) {
      throw new AegisSheetsError(403, 'sandbox_service_account_rejected', 'The sandbox service account cannot write to production AEGIS.')
    }
  }
}

export function aegisAppointmentRecordId(eventId: string) {
  return `pepper-event:${eventId}`
}

export function aegisAppointmentDeliveryId(eventId: string) {
  return `pepper-delivery:${eventId}`
}

function cell(value: unknown) {
  return value == null ? '' : String(value)
}

export function appointmentSheetRow(
  config: AegisDestinationConfig,
  appointment: AegisAppointment,
  captureId: string,
  updatedAt: string,
) {
  const title = String(appointment.title || '')
  const sandbox = config.mode === 'sandbox'
  return [
    aegisAppointmentRecordId(appointment.event_id),
    appointment.event_id,
    captureId,
    appointment.status,
    sandbox && !title.startsWith(PEPPER_TEST_ROW_PREFIX) ? `${PEPPER_TEST_ROW_PREFIX} ${title}` : title,
    appointment.starts_at,
    appointment.ends_at,
    appointment.timezone,
    appointment.appointment_type,
    appointment.patient_member_id,
    appointment.patient_slug,
    appointment.clinician,
    appointment.facility,
    appointment.location,
    appointment.preparation_instructions,
    appointment.original_source_text,
    aegisAppointmentDeliveryId(appointment.event_id),
    updatedAt,
    sandbox ? `${PEPPER_TEST_ROW_PREFIX} Pepper appointment bridge` : 'Pepper appointment bridge',
  ].map(cell)
}

export function verifyAppointmentSheetRow(expected: string[], actual: string[]) {
  if (actual.length < expected.length) return false
  return expected.every((value, index) => actual[index] === value)
}

export function classifyAegisSheetsFailure(error: unknown): AegisDeliveryStatus {
  const status = error instanceof AegisSheetsError ? error.status : 500
  const code = error instanceof AegisSheetsError ? error.code : 'unknown_error'
  if (['ambiguous_record', 'readback_mismatch', 'invalid_sheet_schema'].includes(code)) return 'needs_review'
  if (status === 401 || status === 403 || code === 'service_account_missing') return 'reconnect_required'
  if ([408, 409, 425, 429].includes(status) || status >= 500) return 'retry_required'
  return 'failed'
}

export async function deliverAegisAppointment(
  gateway: AegisSheetsGateway,
  config: AegisDestinationConfig,
  appointment: AegisAppointment,
  captureId: string,
  now = () => new Date().toISOString(),
): Promise<AegisDeliveryResult> {
  const attemptedAt = now()
  const recordId = aegisAppointmentRecordId(appointment.event_id)
  const destination = `${config.spreadsheetId}:${config.sheetName}`
  let operation: AegisDeliveryResult['operation'] = 'none'
  let writtenAt: string | null = null

  try {
    validateAegisDestinationConfig(config)
    const matches = await gateway.findRowsByRecordId(recordId)
    if (matches.length > 1) {
      throw new AegisSheetsError(409, 'ambiguous_record', `Multiple AEGIS rows match ${recordId}.`)
    }
    const values = appointmentSheetRow(config, appointment, captureId, attemptedAt)
    let rowNumber: number
    if (matches.length === 1) {
      operation = 'update'
      rowNumber = matches[0].rowNumber
      await gateway.updateRow(rowNumber, values)
    } else {
      operation = 'append'
      rowNumber = await gateway.appendRow(values)
    }
    writtenAt = now()
    const readback = await gateway.readRow(rowNumber)
    if (!verifyAppointmentSheetRow(values, readback)) {
      throw new AegisSheetsError(409, 'readback_mismatch', 'AEGIS readback did not match the canonical appointment.')
    }
    return {
      status: 'synced',
      recordId,
      destination,
      operation,
      attemptedAt,
      writtenAt,
      verifiedAt: now(),
      errorClass: null,
      error: null,
    }
  } catch (error) {
    return {
      status: classifyAegisSheetsFailure(error),
      recordId,
      destination,
      operation,
      attemptedAt,
      writtenAt,
      verifiedAt: null,
      errorClass: error instanceof AegisSheetsError ? error.code : 'unknown_error',
      error: String((error as Error)?.message || 'AEGIS delivery failed.').slice(0, 500),
    }
  }
}
