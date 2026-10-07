import {
  isMedicalAppointment,
  medicalCoordinationMessage,
} from '../_shared/medical-scheduling.ts'

export type TaskImportance = 'critical' | 'high' | 'normal' | 'low' | 'someday'
export type TaskUrgency = 'today' | 'this_week' | 'upcoming' | 'flexible'
export type DeadlineType = 'hard' | 'soft' | 'none'
export type DailyPlanState = 'eligible' | 'selected' | 'optional' | 'dismissed' | 'snoozed' | 'waiting' | 'blocked' | 'returned' | 'complete'

export type DayPlanTask = {
  id: string
  title: string
  status?: string | null
  due_at?: string | null
  priority?: string | null
  area?: string | null
  project?: string | null
  classification?: string | null
  recurrence?: string | null
  tags?: string[] | null
  next_action?: string | null
  source?: string | null
  source_url?: string | null
  source_capture_id?: string | null
  importance?: TaskImportance | string | null
  urgency?: TaskUrgency | string | null
  deadline_type?: DeadlineType | string | null
  due_date_confidence?: number | string | null
  waiting_on?: string | null
  waiting_follow_up_at?: string | null
  blocked?: boolean | null
  snoozed_until?: string | null
  dismissed_for_date?: string | null
  manually_pinned?: boolean | null
  daily_plan_state?: DailyPlanState | string | null
  priority_score?: number | null
  priority_reason?: string | null
  estimated_minutes?: number | null
  completed_at?: string | null
}

export type DayPlanEvent = {
  all_day?: boolean
  blocks_time?: boolean
  id: string
  title: string
  starts_at: string
  ends_at?: string | null
  location?: string | null
  person_slug?: string | null
  kind?: string | null
  appointment_type?: string | null
  transport_status?: string | null
  area?: string | null
  source?: string | null
  source_url?: string | null
  source_capture_id?: string | null
}

export type DayPlanMeal = {
  id: string
  meal_name: string
  eat_at: string
  owner_name?: string | null
}

export type DayPlanEmail = {
  reason?: string
  action_score?: number
  source_url?: string | null
  id: string
  thread_id?: string | null
  subject: string
  sender?: string | null
  snippet?: string | null
  received_at?: string | null
  unread?: boolean
  important?: boolean
}

export type DayPlanItem = {
  all_day?: boolean
  id: string
  record_id: string
  kind: 'task' | 'chore' | 'event' | 'appointment' | 'meal' | 'email'
  title: string
  detail: string | null
  reason: string
  urgency: 'critical' | 'high' | 'planned' | 'fixed'
  scheduled_for: string | null
  ends_at: string | null
  source: 'tasks' | 'calendar' | 'meals' | 'email'
  external_url?: string | null
  priority_score?: number
  plan_tier: 'fixed' | 'must_protect' | 'optional'
  project?: string | null
  estimated_minutes?: number | null
}

export type DailyPlan = {
  generated_at: string
  date: string
  headline: string
  summary: string
  items: DayPlanItem[]
  conflicts: string[]
  conflict_items: Array<{ key: string; fingerprint: string; message: string; event_ids: string[] }>
  counts: { tasks: number; chores: number; events: number; appointments: number; meals: number; emails: number }
}

type DayPlanInput = {
  now: string
  dayStart: string
  dayEnd: string
  timeZone: string
  tasks: DayPlanTask[]
  events: DayPlanEvent[]
  meals?: DayPlanMeal[]
  emails: DayPlanEmail[]
}

export type RankedDayPlanTask = {
  task: DayPlanTask
  score: number
  reason: string
  rankGroup: number
  importance: TaskImportance
  urgency: TaskUrgency
  deadlineType: DeadlineType
  trustedDeadline: boolean
}

export type DailyPlanTaskAction =
  | 'pin'
  | 'not_today'
  | 'snooze_tomorrow'
  | 'snooze_next_week'
  | 'choose_date'
  | 'return_to_list'
  | 'lower_priority'
  | 'waiting_on'
  | 'complete'

type DailyPlanActionContext = {
  today: string
  now: string
  timeZone: string
  selectedDate?: string | null
  currentImportance?: TaskImportance | string | null
  waitingOn?: string | null
  followUpAt?: string | null
}

const MINUTE = 60_000
const DEFAULT_TASK_MINUTES = 45
const DEFAULT_CHORE_MINUTES = 30
const EMAIL_BLOCK = 15 * MINUTE
const TRUSTED_DUE_CONFIDENCE = 0.75
const MAX_MUST_PROTECT = 3
const MAX_OPTIONAL = 2

function localDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function timeLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function addLocalDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function localDayDifference(left: string, right: string) {
  return Math.round((Date.parse(`${left}T00:00:00.000Z`) - Date.parse(`${right}T00:00:00.000Z`)) / (24 * 60 * MINUTE))
}

function legacyImportance(value: string | null | undefined): TaskImportance {
  const priority = String(value || '').trim().toLowerCase()
  const labels = priority.split(/[^a-z0-9]+/).filter(Boolean)
  if (labels.some((label) => ['p0', 'critical', 'urgent', 'highest'].includes(label))) return 'critical'
  if (labels.some((label) => ['p1', 'high'].includes(label))) return 'high'
  if (labels.some((label) => ['p3', 'low', 'later'].includes(label))) return 'low'
  if (labels.includes('someday')) return 'someday'
  return 'normal'
}

function taskImportance(task: DayPlanTask): TaskImportance {
  const value = String(task.importance || '').toLowerCase()
  return ['critical', 'high', 'normal', 'low', 'someday'].includes(value)
    ? value as TaskImportance
    : legacyImportance(task.priority)
}

function taskDeadlineType(task: DayPlanTask): DeadlineType {
  const value = String(task.deadline_type || '').toLowerCase()
  return ['hard', 'soft', 'none'].includes(value) ? value as DeadlineType : 'none'
}

function dueConfidence(task: DayPlanTask) {
  const value = Number(task.due_date_confidence ?? 0)
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function trustedDeadline(task: DayPlanTask) {
  return Boolean(task.due_at)
    && taskDeadlineType(task) !== 'none'
    && dueConfidence(task) >= TRUSTED_DUE_CONFIDENCE
}

function taskUrgency(task: DayPlanTask, today: string, timeZone: string): TaskUrgency {
  const explicit = String(task.urgency || '').toLowerCase()
  if (['today', 'this_week', 'upcoming', 'flexible'].includes(explicit)) {
    return explicit as TaskUrgency
  }
  if (!trustedDeadline(task) || !task.due_at) return 'flexible'
  const days = localDayDifference(localDate(task.due_at, timeZone), today)
  if (days <= 0) return 'today'
  if (days <= 7) return 'this_week'
  if (days <= 30) return 'upcoming'
  return 'flexible'
}

function taskText(task: DayPlanTask) {
  return [task.title, task.area, task.project, task.classification, task.next_action, ...(task.tags || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function consequenceKind(task: DayPlanTask) {
  const text = taskText(task)
  if (/\b(doctor|medical|dentist|dental|orthodont|physical therapy|pt appointment|clinic|hospital|health appointment|eye appointment|hearing appointment|pediatric|pulmonology|blood work|blood-work|mental health therapy)\b/.test(text)) return 'medical'
  if (/\b(payroll|pay employees|paycheck)\b/.test(text)) return 'payroll'
  if (/\b(safety|osha|injury log|tailgate training)\b/.test(text)) return 'safety'
  if (/\b(legal|court|legal filing|court filing|regulatory filing|compliance deadline|subpoena|contract deadline)\b/.test(text)) return 'legal'
  if (/\b(financial loss|late fee|penalty|past due bill|lease-end bill|lien|insurance lapse)\b/.test(text)) return 'financial_loss'
  return null
}

function blockingLabel(task: DayPlanTask) {
  const text = [task.title, task.next_action, ...(task.tags || [])].filter(Boolean).join(' ')
  const named = text.match(/\bblocks?\s+([A-Z][A-Za-z'-]*)/)
  if (named) return named[1]
  return /\b(blocks?|blocking|dependency)\b/i.test(text) ? 'another person or project' : null
}

function taskEligibility(task: DayPlanTask, now: number, today: string, timeZone: string) {
  const status = String(task.status || 'open')
  if (['completed', 'canceled'].includes(status)) return 'already handled'
  if (task.snoozed_until && Date.parse(task.snoozed_until) > now) return 'snoozed'
  if (task.dismissed_for_date === today) return 'not selected today'
  if (isChoreTask(task) && task.recurrence && task.recurrence !== 'none'
    && task.due_at && localDate(task.due_at, timeZone) > today && !task.manually_pinned) return 'scheduled for a later occurrence'
  if (task.waiting_on) {
    const followUp = task.waiting_follow_up_at ? Date.parse(task.waiting_follow_up_at) : Number.NaN
    if (!Number.isFinite(followUp) || followUp > now) return 'waiting on someone'
  }
  const nextAction = String(task.next_action || '').trim()
  const actionableNextStep = Boolean(nextAction)
    && !/^(wait|waiting|on hold|pending|no action|none)\b/i.test(nextAction)
  if (task.blocked && !actionableNextStep) return 'blocked without a next action'
  if (taskImportance(task) === 'someday' && !task.manually_pinned) return 'someday'
  return null
}

function importancePoints(value: TaskImportance) {
  return { critical: 40, high: 30, normal: 20, low: 10, someday: 0 }[value]
}

function urgencyPoints(value: TaskUrgency) {
  return { today: 30, this_week: 20, upcoming: 10, flexible: 0 }[value]
}

function deadlinePoints(task: DayPlanTask, today: string, timeZone: string) {
  if (!trustedDeadline(task) || !task.due_at) return 0
  const days = localDayDifference(localDate(task.due_at, timeZone), today)
  const hard = taskDeadlineType(task) === 'hard'
  if (days <= 0) return hard ? 20 : 14
  if (days <= 2) return hard ? 18 : 12
  if (days <= 7) return hard ? 14 : 8
  if (days <= 30) return hard ? 8 : 4
  return 0
}

function priorityReason(task: DayPlanTask, urgency: TaskUrgency, today: string, timeZone: string) {
  if (task.manually_pinned) return 'User pinned'
  const consequence = consequenceKind(task)
  const due = task.due_at ? localDate(task.due_at, timeZone) : null
  if (trustedDeadline(task) && taskDeadlineType(task) === 'hard' && due === today) return 'Hard deadline today'
  if (consequence === 'medical') return 'Medical care'
  if (consequence === 'financial_loss') return 'Prevents financial loss'
  if (consequence === 'payroll') return 'Payroll obligation'
  if (consequence === 'safety') return 'Safety obligation'
  if (consequence === 'legal') return 'Legal obligation'
  const blocker = blockingLabel(task)
  if (blocker) return blocker === 'another person or project' ? 'Blocks other work' : `Blocks ${blocker}`
  if (task.waiting_on && task.waiting_follow_up_at) return `Follow up with ${task.waiting_on}`
  if (urgency === 'today') return 'Due today'
  if (urgency === 'this_week') return 'Due this week'
  if (taskImportance(task) === 'critical') return 'Critical importance'
  if (taskImportance(task) === 'high') return 'High importance'
  return task.next_action ? 'Ready next action' : 'Fits available time'
}

function rankGroup(task: DayPlanTask, importance: TaskImportance) {
  if (task.manually_pinned) return 1
  if (consequenceKind(task) || (trustedDeadline(task) && taskDeadlineType(task) === 'hard')) return 2
  if (blockingLabel(task) || task.blocked) return 3
  if (importance === 'critical' || importance === 'high') return 4
  if (importance === 'normal') return 5
  return 6
}

export function rankDayPlanTasks(
  tasks: DayPlanTask[],
  context: { now: string; today: string; timeZone: string },
) {
  const now = Date.parse(context.now)
  return tasks
    .filter((task) => !taskEligibility(task, now, context.today, context.timeZone))
    .map((task): RankedDayPlanTask => {
      const importance = taskImportance(task)
      const urgency = taskUrgency(task, context.today, context.timeZone)
      const deadlineType = taskDeadlineType(task)
      const consequence = consequenceKind(task)
      const blocker = blockingLabel(task)
      const due = task.due_at ? localDate(task.due_at, context.timeZone) : null
      const overdue = trustedDeadline(task) && due !== null && due < context.today ? 5 : 0
      const impact = consequence || blocker ? 10 : 0
      const score = importancePoints(importance)
        + urgencyPoints(urgency)
        + deadlinePoints(task, context.today, context.timeZone)
        + impact
        + (task.manually_pinned ? 100 : 0)
        + overdue
      return {
        task,
        score,
        reason: priorityReason(task, urgency, context.today, context.timeZone),
        rankGroup: rankGroup(task, importance),
        importance,
        urgency,
        deadlineType,
        trustedDeadline: trustedDeadline(task),
      }
    })
    .sort((left, right) => left.rankGroup - right.rankGroup
      || right.score - left.score
      || left.task.title.localeCompare(right.task.title))
}

function localDateAtSeven(date: string, timeZone: string) {
  const desired = Date.parse(`${date}T07:00:00.000Z`)
  let candidate = desired
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]))
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
    candidate += desired - represented
  }
  return new Date(candidate).toISOString()
}

export function dailyPlanActionPatch(action: DailyPlanTaskAction, context: DailyPlanActionContext): Partial<DayPlanTask> {
  if (action === 'pin') return { manually_pinned: true, dismissed_for_date: null, snoozed_until: null, daily_plan_state: 'selected' }
  if (action === 'not_today') return { dismissed_for_date: context.today, daily_plan_state: 'dismissed', manually_pinned: false }
  if (action === 'return_to_list') return { dismissed_for_date: context.today, daily_plan_state: 'returned', manually_pinned: false }
  if (action === 'snooze_tomorrow') return { snoozed_until: localDateAtSeven(addLocalDays(context.today, 1), context.timeZone), dismissed_for_date: null, daily_plan_state: 'snoozed', manually_pinned: false }
  if (action === 'snooze_next_week') {
    const weekday = new Date(`${context.today}T12:00:00.000Z`).getUTCDay()
    const days = ((8 - weekday) % 7) || 7
    return { snoozed_until: localDateAtSeven(addLocalDays(context.today, days), context.timeZone), dismissed_for_date: null, daily_plan_state: 'snoozed', manually_pinned: false }
  }
  if (action === 'choose_date') {
    if (!context.selectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(context.selectedDate)) throw new Error('Choose a valid snooze date.')
    return { snoozed_until: localDateAtSeven(context.selectedDate, context.timeZone), dismissed_for_date: null, daily_plan_state: 'snoozed', manually_pinned: false }
  }
  if (action === 'lower_priority') {
    const current = ['critical', 'high', 'normal', 'low', 'someday'].includes(String(context.currentImportance || ''))
      ? context.currentImportance as TaskImportance
      : 'normal'
    const next: Record<TaskImportance, TaskImportance> = { critical: 'high', high: 'normal', normal: 'low', low: 'someday', someday: 'someday' }
    return { importance: next[current], manually_pinned: false, daily_plan_state: 'eligible' }
  }
  if (action === 'waiting_on') {
    const waitingOn = String(context.waitingOn || '').trim()
    if (!waitingOn) throw new Error('Name who or what this task is waiting on.')
    return { waiting_on: waitingOn, waiting_follow_up_at: context.followUpAt || null, daily_plan_state: 'waiting', manually_pinned: false }
  }
  if (action === 'complete') return { status: 'completed', completed_at: context.now, daily_plan_state: 'complete', manually_pinned: false }
  throw new Error('Unknown daily plan action.')
}

function isChoreTask(task: DayPlanTask) {
  return task.source === 'pepper_chore'
    || String(task.classification || '').toLowerCase() === 'chore'
    || String(task.area || '').toLowerCase() === 'chores'
    || String(task.project || '').toLowerCase() === 'family chores'
    || (task.tags || []).some((tag) => ['chore', 'chores'].includes(String(tag).toLowerCase()))
}

export function emailActionScore(email: Pick<DayPlanEmail, 'subject' | 'snippet' | 'unread' | 'important'>) {
  const text = `${email.subject || ''} ${email.snippet || ''}`.toLowerCase()
  let score = 0
  if (/action required|response required|needs? your attention|urgent/.test(text)) score += 6
  if (/\b(due|deadline|overdue|past due|by (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday))\b/.test(text)) score += 5
  if (/\b(confirm|rsvp|respond|reply|sign|submit|complete|approve|review|pay|payment)\b/.test(text)) score += 4
  if (/\b(appointment|schedule|reschedule|pickup|drop[ -]?off|rehearsal|audition|homework|assignment|permission|invoice)\b/.test(text)) score += 3
  if (!score) return 0
  if (email.important) score += 2
  if (email.unread) score += 1
  return score
}

function displayUrgency(candidate: RankedDayPlanTask): DayPlanItem['urgency'] {
  if (candidate.rankGroup <= 2 || candidate.score >= 80) return 'critical'
  if (candidate.rankGroup <= 4 || candidate.score >= 50) return 'high'
  return 'planned'
}

function taskDuration(task: DayPlanTask) {
  const fallback = isChoreTask(task) ? DEFAULT_CHORE_MINUTES : DEFAULT_TASK_MINUTES
  const requested = Number(task.estimated_minutes || fallback)
  return Math.max(5, Math.min(8 * 60, Number.isFinite(requested) ? requested : fallback)) * MINUTE
}

export type WarningDecision = { key: string; fingerprint: string; decision: 'dismissed' | 'snoozed'; snoozed_until?: string | null }

export function warningIsHidden(warning: DailyPlan['conflict_items'][number], decision: WarningDecision | undefined, now: string) {
  return Boolean(decision && decision.fingerprint === warning.fingerprint &&
    (decision.decision === 'dismissed' || (decision.decision === 'snoozed' && Boolean(decision.snoozed_until) && Date.parse(decision.snoozed_until!) > Date.parse(now))))
}

function warningDigest(value: string) {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  return hash.toString(16).padStart(16, '0')
}

function conflictItems(events: DayPlanEvent[]) {
  // Group connected overlaps so one broad work block cannot flood Today with pairwise warnings.
  const sorted = [...new Map(events.map((event) => [event.id, event])).values()].filter((event) => !event.all_day && event.blocks_time !== false &&
    !(['transport', 'school_dropoff', 'school_pickup'].includes(event.kind || '') &&
      ['confirmed', 'completed'].includes(event.transport_status || '')))
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))
  const parent = sorted.map((_, index) => index)
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]))
  const overlapping = new Set<number>()
  for (let index = 0; index < sorted.length; index += 1) {
    const leftEnd = Date.parse(sorted[index].ends_at || sorted[index].starts_at)
    for (let next = index + 1; next < sorted.length; next += 1) {
      if (Date.parse(sorted[next].starts_at) >= leftEnd) break
      if (sorted[next].id === sorted[index].id) continue
      parent[find(next)] = find(index)
      overlapping.add(index)
      overlapping.add(next)
    }
  }
  const groups = new Map<number, DayPlanEvent[]>()
  for (const index of overlapping) {
    const root = find(index)
    groups.set(root, [...(groups.get(root) || []), sorted[index]])
  }
  return [...groups.values()].map((group) => {
    const identities = group.map((event) => event.id).sort()
    const medical = group.find(isMedicalAppointment)
    const other = medical ? group.find((event) => event.id !== medical.id) : null
    const message = medical && other ? group.filter((event) => event.id !== medical.id)
      .map((event) => medicalCoordinationMessage(medical, event)).filter(Boolean).join(' ') : null
    const anchor = group.length > 2 ? group.map((event) => ({ event, count: group.filter((candidate) =>
      candidate.id !== event.id && Date.parse(candidate.starts_at) < Date.parse(event.ends_at || event.starts_at) &&
      Date.parse(event.starts_at) < Date.parse(candidate.ends_at || candidate.starts_at)).length }))
      .sort((left, right) => right.count - left.count)[0].event : null
    const others = anchor ? group.filter((event) => event.id !== anchor.id) : []
    return {
      key: warningDigest(JSON.stringify(identities)),
      fingerprint: warningDigest(JSON.stringify(group.map((event) => [event.id, event.title, event.starts_at, event.ends_at, event.location, event.transport_status]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))),
      message: message || (group.length === 2 ? `${group[0].title} overlaps ${group[1].title}.` : `${anchor?.title} conflicts with ${others.length} other commitments, including ${others.slice(0, 2).map((event) => event.title).join(' and ')}. Review timing or coverage.`),
      event_ids: group.map((event) => event.id),
    }
  })
}

function projectLimited(candidates: RankedDayPlanTask[]) {
  const counts = new Map<string, number>()
  return candidates.filter((candidate) => {
    const rawProject = String(candidate.task.project || '').trim().toLowerCase()
    const project = /\b(manuscript|chapter|book|publishing)\b/.test(rawProject)
      ? 'manuscript'
      : rawProject
    if (!project) return true
    const exception = candidate.task.manually_pinned
      || candidate.importance === 'critical'
      || (candidate.deadlineType === 'hard' && candidate.trustedDeadline)
    const count = counts.get(project) || 0
    if (count >= 2 && !exception) return false
    counts.set(project, count + 1)
    return true
  })
}

function taskPlanItem(candidate: RankedDayPlanTask, tier: 'must_protect' | 'optional', duration: number): DayPlanItem {
  const kind = isChoreTask(candidate.task) ? 'chore' as const : 'task' as const
  return {
    id: `${kind}:${candidate.task.id}`,
    record_id: candidate.task.id,
    kind,
    title: candidate.task.title,
    detail: candidate.task.next_action || candidate.task.project || candidate.task.area || null,
    reason: candidate.reason,
    urgency: displayUrgency(candidate),
    scheduled_for: null,
    ends_at: null,
    source: 'tasks',
    external_url: candidate.task.source_url || null,
    priority_score: candidate.score,
    plan_tier: tier,
    project: candidate.task.project || null,
    estimated_minutes: duration / MINUTE,
  }
}

export function buildDailyPlan(input: DayPlanInput): DailyPlan {
  const now = Date.parse(input.now)
  const dayStart = Date.parse(input.dayStart)
  const dayEnd = Date.parse(input.dayEnd)
  const today = localDate(input.dayStart, input.timeZone)
  const cursor = Math.max(now, dayStart)

  const appointments = input.events
    .filter((event) => {
      const start = Date.parse(event.starts_at)
      const end = Date.parse(event.ends_at || event.starts_at)
      return start < dayEnd && Math.max(end, start + MINUTE) >= cursor
    })
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))

  const meals = (input.meals || [])
    .filter((meal) => {
      const start = Date.parse(meal.eat_at)
      return start < dayEnd && start + 60 * MINUTE >= cursor
    })
    .sort((left, right) => Date.parse(left.eat_at) - Date.parse(right.eat_at))

  const rankedTasks = projectLimited(rankDayPlanTasks(input.tasks, { now: input.now, today, timeZone: input.timeZone }))
  const mustPool = rankedTasks.filter((candidate) => candidate.rankGroup <= 4 || candidate.score >= 40)
  const selectedIds = new Set<string>()
  const flexibleItems: DayPlanItem[] = []

  for (const candidate of mustPool) {
    if (flexibleItems.filter((item) => item.plan_tier === 'must_protect').length >= MAX_MUST_PROTECT) break
    const duration = taskDuration(candidate.task)
    flexibleItems.push(taskPlanItem(candidate, 'must_protect', duration))
    selectedIds.add(candidate.task.id)
  }

  const optionalTaskPool = rankedTasks.filter((candidate) => !selectedIds.has(candidate.task.id))
  const optionalEmailPool = input.emails
    .map((email) => ({ email, score: email.action_score ?? emailActionScore(email) }))
    .filter((candidate) => candidate.score >= 3)
    .sort((left, right) => right.score - left.score || Date.parse(right.email.received_at || '0') - Date.parse(left.email.received_at || '0'))

  const optional = [
    ...optionalTaskPool.map((candidate) => ({ kind: 'task' as const, score: candidate.score, candidate })),
    ...optionalEmailPool.map((candidate) => ({ kind: 'email' as const, score: 25 + candidate.score, candidate })),
  ].sort((left, right) => right.score - left.score)

  for (const entry of optional) {
    if (flexibleItems.filter((item) => item.plan_tier === 'optional').length >= MAX_OPTIONAL) break
    if (entry.kind === 'task') {
      const candidate = entry.candidate as RankedDayPlanTask
      const duration = taskDuration(candidate.task)
      flexibleItems.push(taskPlanItem(candidate, 'optional', duration))
      selectedIds.add(candidate.task.id)
      continue
    }
    const { email, score } = entry.candidate as { email: DayPlanEmail; score: number }
    flexibleItems.push({
      id: `email:${email.id}`,
      record_id: email.id,
      kind: 'email',
      title: email.subject || 'Email needing attention',
      detail: email.sender || email.snippet || null,
      reason: email.reason || (score >= 9 ? 'Suggested: review time-sensitive email' : 'Suggested: respond to email'),
      urgency: score >= 9 ? 'high' : 'planned',
      scheduled_for: null,
      ends_at: null,
      source: 'email',
      external_url: email.source_url || (email.thread_id ? `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(email.thread_id)}` : null),
      priority_score: 25 + score,
      plan_tier: 'optional',
      estimated_minutes: EMAIL_BLOCK / MINUTE,
    })
  }

  const fixedEventItems: DayPlanItem[] = appointments.map((event) => {
    const medical = isMedicalAppointment(event)
    const kind = medical ? 'appointment' as const : 'event' as const
    return {
      id: `${kind}:${event.id}`,
      all_day: event.all_day,
      record_id: event.id,
      kind,
      title: event.title,
      detail: event.location || null,
      reason: medical
        ? 'Medical appointment; school and work coordinate around it'
        : 'Fixed commitment',
      urgency: medical ? 'critical' : 'fixed',
      scheduled_for: event.starts_at,
      ends_at: event.ends_at || null,
      source: 'calendar',
      external_url: event.source_url || null,
      priority_score: medical ? 1000 : 900,
      plan_tier: 'fixed',
    }
  })

  const mealItems: DayPlanItem[] = meals.map((meal) => ({
    id: `meal:${meal.id}`,
    record_id: meal.id,
    kind: 'meal',
    title: `Dinner · ${meal.meal_name}`,
    detail: meal.owner_name ? `${meal.owner_name} is handling dinner` : null,
    reason: 'Fixed family meal',
    urgency: 'fixed',
    scheduled_for: meal.eat_at,
    ends_at: new Date(Date.parse(meal.eat_at) + 60 * MINUTE).toISOString(),
    source: 'meals',
    priority_score: 850,
    plan_tier: 'fixed',
  }))

  const fixedItems = [...fixedEventItems, ...mealItems]
  const items = [...flexibleItems, ...fixedItems].sort((left, right) => {
    const leftTime = left.scheduled_for ? Date.parse(left.scheduled_for) : dayEnd + 1
    const rightTime = right.scheduled_for ? Date.parse(right.scheduled_for) : dayEnd + 1
    return leftTime - rightTime || (right.priority_score || 0) - (left.priority_score || 0) || left.title.localeCompare(right.title)
  })
  const nextFixed = [...fixedItems].sort((left, right) => Date.parse(left.scheduled_for || '') - Date.parse(right.scheduled_for || ''))[0]
  const nextMedical = fixedEventItems.find((item) => item.kind === 'appointment')
  const firstPriority = [...flexibleItems].sort((left, right) => (right.priority_score || 0) - (left.priority_score || 0))[0]
  const headline = nextMedical
    ? `${nextMedical.title} is today's top fixed priority at ${timeLabel(nextMedical.scheduled_for!, input.timeZone)}; coordinate school and work around it.`
    : firstPriority && nextFixed
      ? `Prioritize ${firstPriority.title}; protect ${nextFixed.title} at ${timeLabel(nextFixed.scheduled_for!, input.timeZone)}.`
      : firstPriority
        ? `Prioritize ${firstPriority.title}.`
        : nextFixed
          ? `Your next fixed commitment is ${nextFixed.title} at ${timeLabel(nextFixed.scheduled_for!, input.timeZone)}.`
          : 'Your day is open from what Pepper can currently verify.'

  const appointmentCount = fixedEventItems.filter((item) => item.kind === 'appointment').length
  const eventCount = fixedEventItems.length - appointmentCount
  const selectedTasks = flexibleItems.filter((item) => item.kind === 'task')
  const selectedChores = flexibleItems.filter((item) => item.kind === 'chore')
  const selectedEmails = flexibleItems.filter((item) => item.kind === 'email')
  const mustCount = flexibleItems.filter((item) => item.plan_tier === 'must_protect').length
  const optionalCount = flexibleItems.filter((item) => item.plan_tier === 'optional').length
  const conflict_items = conflictItems(appointments)

  return {
    generated_at: input.now,
    date: today,
    headline,
    summary: `${fixedItems.length} fixed, ${mustCount} priority, and ${optionalCount} optional item${optionalCount === 1 ? '' : 's'} to plan. Only confirmed commitments have times.`,
    items,
    conflicts: conflict_items.map((conflict) => conflict.message),
    conflict_items,
    counts: {
      tasks: selectedTasks.length,
      chores: selectedChores.length,
      events: eventCount,
      appointments: appointmentCount,
      meals: mealItems.length,
      emails: selectedEmails.length,
    },
  }
}
