export const ADULT_HOUSEHOLD_ROLES = new Set(['adult_admin', 'adult'])

export type CalendarContributionActor = {
  id: string
  household_id: string
  role: string
  session_id: string
  active?: boolean
  removed_at?: string | null
}

export type CalendarContributionTarget = {
  household_id: string
  visibility?: string | null
}

export type CalendarContributionDecision =
  | { allowed: true }
  | { allowed: false; state: 'forbidden' | 'needs_review'; reason: string }

export function isAdultHouseholdRole(role: string) {
  return ADULT_HOUSEHOLD_ROLES.has(role)
}

export function authorizeCalendarContribution(
  actor: CalendarContributionActor,
  event: CalendarContributionTarget,
  connection: CalendarContributionTarget,
): CalendarContributionDecision {
  if (actor.active === false || actor.removed_at) {
    return { allowed: false, state: 'forbidden', reason: 'inactive_household_member' }
  }
  if (!isAdultHouseholdRole(actor.role)) {
    return { allowed: false, state: 'needs_review', reason: 'adult_approval_required' }
  }
  if (!actor.session_id) {
    return { allowed: false, state: 'forbidden', reason: 'stable_session_required' }
  }
  if (event.household_id !== actor.household_id) {
    return { allowed: false, state: 'forbidden', reason: 'event_household_mismatch' }
  }
  if (connection.household_id !== actor.household_id) {
    return { allowed: false, state: 'forbidden', reason: 'calendar_household_mismatch' }
  }
  if (event.visibility !== 'household') {
    return { allowed: false, state: 'needs_review', reason: 'private_event_not_publishable' }
  }
  return { allowed: true }
}

export function calendarMutationActionKey(input: {
  eventId: string
  action: string
  actorMemberId: string
  sessionId: string
  requestId: string
}) {
  return [
    'pepper-calendar-action-v1',
    input.eventId,
    input.action,
    input.actorMemberId,
    input.sessionId,
    input.requestId,
  ].join(':')
}

export function parseExpectedEventRevision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw Object.assign(new Error('Refresh this event before changing it.'), { status: 409 })
  }
  return value
}

export function calendarMutationKind(operation: string): 'create' | 'update' | 'cancel' {
  if (operation === 'event.create') return 'create'
  if (operation === 'cancel' || operation === 'delete' || operation === 'event.cancel') return 'cancel'
  return 'update'
}
