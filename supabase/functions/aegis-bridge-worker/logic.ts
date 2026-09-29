export type GoogleAppointmentDeliveryStatus =
  | 'pending'
  | 'synced'
  | 'skipped'
  | 'needs_reconnect'
  | 'retry_required'
  | 'failed'

export type AegisAppointmentDeliveryStatus =
  | 'pending'
  | 'synced'
  | 'retry_required'
  | 'reconnect_required'
  | 'needs_review'
  | 'failed'

export function googleAppointmentDeliveryStatus(value: unknown): GoogleAppointmentDeliveryStatus {
  const status = String(value || '')
  if (status === 'reconnect_required') return 'needs_reconnect'
  return ['synced', 'skipped', 'needs_reconnect', 'retry_required'].includes(status)
    ? status as GoogleAppointmentDeliveryStatus
    : 'failed'
}

export function appointmentDeliveryState(
  aegisStatus: AegisAppointmentDeliveryStatus,
  googleStatus: GoogleAppointmentDeliveryStatus,
) {
  if (aegisStatus === 'synced' && googleStatus === 'synced') return 'synced'
  if (aegisStatus === 'synced' && googleStatus === 'skipped') return 'partial_calendar_not_connected'
  if (aegisStatus === 'synced' && googleStatus === 'needs_reconnect') return 'partial_reconnect_required'
  if (aegisStatus === 'synced' && ['retry_required', 'failed'].includes(googleStatus)) return 'partial_retry_required'
  if (aegisStatus === 'reconnect_required') return 'partial_reconnect_required'
  if (aegisStatus === 'needs_review') return 'partial_review_required'
  if (aegisStatus === 'retry_required') return 'partial_retry_required'
  return aegisStatus === 'failed' ? 'failed' : 'pending'
}

export function publicAppointmentSyncResult(input: {
  useBridge: boolean
  data: Record<string, unknown>
  operation: string
}) {
  const googleDeliveryStatus = googleAppointmentDeliveryStatus(
    input.data.google_status
      || input.data.status
      || (input.data.google as Record<string, unknown> | undefined)?.status,
  )
  const googleStatus = googleDeliveryStatus === 'needs_reconnect'
    ? 'reconnect_required'
    : googleDeliveryStatus

  if (!input.useBridge) {
    return {
      status: googleStatus,
      retryable: ['retry_required', 'reconnect_required'].includes(googleStatus),
      operation: input.operation,
    }
  }

  const aegisStatus = String(input.data.aegis_status || 'failed')
  const deliveryState = String(input.data.delivery_state || 'failed')
  const complete = input.data.ok === true
    && deliveryState === 'synced'
    && aegisStatus === 'synced'
    && googleDeliveryStatus === 'synced'

  if (complete) {
    return {
      status: 'synced',
      retryable: false,
      operation: input.operation,
      delivery_state: deliveryState,
      aegis_status: aegisStatus,
      google_status: googleStatus,
    }
  }

  const needsReview = aegisStatus === 'needs_review' || deliveryState === 'partial_review_required'
  const reconnectRequired = aegisStatus === 'reconnect_required'
    || ['needs_reconnect', 'skipped'].includes(googleDeliveryStatus)
    || deliveryState === 'partial_reconnect_required'

  return {
    status: needsReview ? 'needs_review' : reconnectRequired ? 'reconnect_required' : 'retry_required',
    retryable: !needsReview,
    operation: input.operation,
    delivery_state: deliveryState,
    aegis_status: aegisStatus,
    google_status: googleStatus,
  }
}
