import type { AppointmentType } from './appointment-intake.ts'

export type SchedulingEvent = {
  id: string
  title: string
  starts_at: string
  ends_at?: string | null
  kind?: string | null
  appointment_type?: AppointmentType | string | null
  person_slug?: string | null
  area?: string | null
  source?: string | null
}

const MEDICAL_TYPES = new Set<AppointmentType>([
  'doctor',
  'dental',
  'orthodontic',
  'physical_therapy',
  'mental_health_therapy',
  'medical_other',
])

export function isMedicalAppointment(event: SchedulingEvent) {
  if (event.appointment_type && MEDICAL_TYPES.has(event.appointment_type as AppointmentType)) return true
  if (String(event.kind || '').toLowerCase() === 'appointment') return true
  return /\b(?:appointment|doctor|physician|dent(?:al|ist)|orthodont|physical\s+therapy|mental\s+health|therap(?:y|ist)|clinic|medical|check[ -]?up)\b/i.test(event.title)
}

export function coordinationCategory(event: SchedulingEvent): 'school' | 'work' | null {
  const text = `${event.kind || ''} ${event.area || ''} ${event.source || ''} ${event.title}`
  if (/\b(?:school|class|campus|homework|rehearsal|practice|team)\b/i.test(text)) return 'school'
  if (/\b(?:work|office|client|job|shift|payroll|bid|framing|real\s+estate)\b/i.test(text)) return 'work'
  return null
}

export function eventsOverlap(left: SchedulingEvent, right: SchedulingEvent) {
  const leftStart = Date.parse(left.starts_at)
  const rightStart = Date.parse(right.starts_at)
  const leftEnd = Date.parse(left.ends_at || left.starts_at) || leftStart + 60 * 60_000
  const rightEnd = Date.parse(right.ends_at || right.starts_at) || rightStart + 60 * 60_000
  return leftStart < rightEnd && rightStart < leftEnd
}

export function medicalCoordinationMessage(medical: SchedulingEvent, overlap: SchedulingEvent) {
  const category = coordinationCategory(overlap)
  if (!category) return null
  return `${medical.title} remains the priority; coordinate ${category} coverage for ${overlap.title}.`
}

export function medicalCoordinationTaskTitle(medical: SchedulingEvent, overlap: SchedulingEvent) {
  const category = coordinationCategory(overlap)
  if (category === 'school') return `Coordinate school attendance around ${medical.title}`
  if (category === 'work') return `Arrange work coverage around ${medical.title}`
  return null
}

export type MedicalCoordinationPriority = {
  priority: 'P0' | 'P1' | 'P2'
  importance: 'critical' | 'high' | 'normal'
  urgency: 'today' | 'this_week' | 'upcoming'
  reason: string
}

export function medicalCoordinationPriority(input: {
  appointmentStartsAt: string
  now: string
  unresolvedLogistics: boolean
  routinePreparation?: boolean
}): MedicalCoordinationPriority {
  if (input.routinePreparation && !input.unresolvedLogistics) {
    return {
      priority: 'P2',
      importance: 'normal',
      urgency: 'upcoming',
      reason: 'Routine medical preparation',
    }
  }
  const milliseconds = Date.parse(input.appointmentStartsAt) - Date.parse(input.now)
  const imminent = Number.isFinite(milliseconds)
    && milliseconds >= 0
    && milliseconds <= 48 * 60 * 60 * 1000
  if (input.unresolvedLogistics && imminent) {
    return {
      priority: 'P0',
      importance: 'critical',
      urgency: 'today',
      reason: 'Imminent medical coordination remains unresolved',
    }
  }
  return {
    priority: 'P1',
    importance: 'high',
    urgency: milliseconds >= 0 && milliseconds <= 7 * 24 * 60 * 60 * 1000
      ? 'this_week'
      : 'upcoming',
    reason: 'Confirmed future medical appointment requires coordination',
  }
}
