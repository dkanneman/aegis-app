export type DayPlanTask = {
  id: string
  title: string
  status?: string | null
  due_at?: string | null
  priority?: string | null
  area?: string | null
  project?: string | null
  classification?: string | null
  tags?: string[] | null
  next_action?: string | null
  source?: string | null
}

export type DayPlanEvent = {
  id: string
  title: string
  starts_at: string
  ends_at?: string | null
  location?: string | null
  person_slug?: string | null
  kind?: string | null
}

export type DayPlanMeal = {
  id: string
  meal_name: string
  eat_at: string
  owner_name?: string | null
}

export type DayPlanEmail = {
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
}

export type DailyPlan = {
  generated_at: string
  date: string
  headline: string
  summary: string
  items: DayPlanItem[]
  conflicts: string[]
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

const MINUTE = 60_000
const TASK_BLOCK = 45 * MINUTE
const CHORE_BLOCK = 30 * MINUTE
const EMAIL_BLOCK = 15 * MINUTE
const EVENT_BUFFER = 10 * MINUTE

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

function priorityRank(value: string | null | undefined) {
  const priority = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (['p0', 'critical', 'urgent', 'highest'].includes(priority)) return 0
  if (['p1', 'high'].includes(priority)) return 1
  if (['p2', 'medium', 'normal', 'planned'].includes(priority)) return 2
  if (['p3', 'low', 'later', 'someday'].includes(priority)) return 3
  return 4
}

function taskPriorityScore(task: DayPlanTask, today: string, timeZone: string) {
  const rank = priorityRank(task.priority)
  let score = [100, 75, 42, 18, 8][rank]
  const due = task.due_at ? localDate(task.due_at, timeZone) : null
  if (due && due < today) score += 70
  else if (due === today) score += 55
  if (task.status === 'in_progress') score += 20
  if (/health|medical|school|family/i.test(String(task.area || ''))) score += 5
  return score
}

function isChoreTask(task: DayPlanTask) {
  return task.source === 'pepper_chore'
    || String(task.classification || '').toLowerCase() === 'chore'
    || String(task.area || '').toLowerCase() === 'chores'
    || String(task.project || '').toLowerCase() === 'family chores'
    || (task.tags || []).some((tag) => ['chore', 'chores'].includes(String(tag).toLowerCase()))
}

function taskReason(task: DayPlanTask, today: string, timeZone: string) {
  const due = task.due_at ? localDate(task.due_at, timeZone) : null
  if (due && due < today) return 'Overdue and still open'
  if (due === today) return 'Due today'
  if (priorityRank(task.priority) === 0) return 'Critical priority'
  if (priorityRank(task.priority) === 1) return 'High priority'
  if (task.status === 'in_progress') return 'Already in progress'
  return task.next_action ? 'Ready for its next action' : 'Next useful open task'
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

function urgencyForTask(task: DayPlanTask, score: number): DayPlanItem['urgency'] {
  if (priorityRank(task.priority) === 0 || score >= 130) return 'critical'
  if (priorityRank(task.priority) === 1 || score >= 85) return 'high'
  return 'planned'
}

function ceilToQuarterHour(value: number) {
  return Math.ceil(value / (15 * MINUTE)) * 15 * MINUTE
}

type BusyBlock = { start: number; end: number }

function allocateBlock(busy: BusyBlock[], cursor: number, dayEnd: number, duration: number) {
  let candidate = ceilToQuarterHour(cursor)
  for (const block of [...busy].sort((left, right) => left.start - right.start)) {
    if (block.end <= candidate) continue
    if (candidate + duration <= block.start - EVENT_BUFFER) break
    candidate = ceilToQuarterHour(block.end + EVENT_BUFFER)
  }
  if (candidate + duration > dayEnd) return null
  busy.push({ start: candidate, end: candidate + duration })
  return candidate
}

function conflictLabels(events: DayPlanEvent[]) {
  const conflicts: string[] = []
  const sorted = [...events].sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))
  for (let index = 0; index < sorted.length; index += 1) {
    const left = sorted[index]
    const leftEnd = Date.parse(left.ends_at || left.starts_at)
    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const right = sorted[nextIndex]
      if (Date.parse(right.starts_at) >= leftEnd) break
      conflicts.push(`${left.title} overlaps ${right.title}.`)
    }
  }
  return conflicts
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

  const busy: BusyBlock[] = [
    ...appointments.map((event) => ({
      start: Date.parse(event.starts_at),
      end: Math.max(Date.parse(event.ends_at || event.starts_at), Date.parse(event.starts_at) + 30 * MINUTE),
    })),
    ...meals.map((meal) => ({
      start: Date.parse(meal.eat_at),
      end: Date.parse(meal.eat_at) + 60 * MINUTE,
    })),
  ]

  const activeTaskCandidates = input.tasks
    .filter((task) => ['open', 'in_progress'].includes(String(task.status || 'open')))
    .map((task) => ({ task, score: taskPriorityScore(task, today, input.timeZone) }))
    .sort((left, right) => right.score - left.score || left.task.title.localeCompare(right.task.title))

  const taskCandidates = activeTaskCandidates
    .filter(({ task }) => !isChoreTask(task))
    .slice(0, 5)

  const choreCandidates = activeTaskCandidates
    .filter(({ task }) => isChoreTask(task))
    .slice(0, 2)

  const emailCandidates = input.emails
    .map((email) => ({ email, score: emailActionScore(email) }))
    .filter((candidate) => candidate.score >= 3)
    .sort((left, right) => right.score - left.score || Date.parse(right.email.received_at || '0') - Date.parse(left.email.received_at || '0'))
    .slice(0, 3)

  const flexible = [
    ...taskCandidates.map((candidate) => ({
      kind: 'task' as const,
      score: candidate.score,
      duration: TASK_BLOCK,
      candidate,
    })),
    ...choreCandidates.map((candidate) => ({
      kind: 'chore' as const,
      score: candidate.score,
      duration: CHORE_BLOCK,
      candidate,
    })),
    ...emailCandidates.map((candidate) => ({
      kind: 'email' as const,
      score: 25 + candidate.score * 8,
      duration: EMAIL_BLOCK,
      candidate,
    })),
  ].sort((left, right) => right.score - left.score)

  const flexibleItems: DayPlanItem[] = flexible.map((entry) => {
    const allocated = allocateBlock(busy, cursor, dayEnd, entry.duration)
    if (entry.kind === 'task' || entry.kind === 'chore') {
      const { task, score } = entry.candidate as { task: DayPlanTask; score: number }
      return {
        id: `${entry.kind}:${task.id}`,
        record_id: task.id,
        kind: entry.kind,
        title: task.title,
        detail: task.next_action || task.project || task.area || null,
        reason: entry.kind === 'chore' && taskReason(task, today, input.timeZone) === 'Next useful open task'
          ? 'Household responsibility'
          : taskReason(task, today, input.timeZone),
        urgency: urgencyForTask(task, score),
        scheduled_for: allocated ? new Date(allocated).toISOString() : null,
        ends_at: allocated ? new Date(allocated + entry.duration).toISOString() : null,
        source: 'tasks',
      }
    }
    const { email, score } = entry.candidate as { email: DayPlanEmail; score: number }
    return {
      id: `email:${email.id}`,
      record_id: email.id,
      kind: 'email',
      title: email.subject || 'Email needing attention',
      detail: email.sender || email.snippet || null,
      reason: score >= 9 ? 'Time-sensitive email signal' : 'Email may need a response',
      urgency: score >= 9 ? 'high' : 'planned',
      scheduled_for: allocated ? new Date(allocated).toISOString() : null,
      ends_at: allocated ? new Date(allocated + entry.duration).toISOString() : null,
      source: 'email',
      external_url: email.thread_id ? `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(email.thread_id)}` : null,
    }
  })

  const fixedEventItems: DayPlanItem[] = appointments.map((event) => {
    const kind = String(event.kind || '').toLowerCase() === 'appointment'
      || /\b(?:appointment|doctor|dentist|orthodont|therapy|check[ -]?up)\b/i.test(event.title)
      ? 'appointment' as const
      : 'event' as const
    return {
      id: `${kind}:${event.id}`,
      record_id: event.id,
      kind,
      title: event.title,
      detail: event.location || null,
      reason: `${kind === 'appointment' ? 'Appointment' : 'Fixed event'} at ${timeLabel(event.starts_at, input.timeZone)}`,
      urgency: 'fixed',
      scheduled_for: event.starts_at,
      ends_at: event.ends_at || null,
      source: 'calendar',
    }
  })

  const mealItems: DayPlanItem[] = meals.map((meal) => ({
    id: `meal:${meal.id}`,
    record_id: meal.id,
    kind: 'meal',
    title: `Dinner · ${meal.meal_name}`,
    detail: meal.owner_name ? `${meal.owner_name} is handling dinner` : null,
    reason: `Family meal at ${timeLabel(meal.eat_at, input.timeZone)}`,
    urgency: 'fixed',
    scheduled_for: meal.eat_at,
    ends_at: new Date(Date.parse(meal.eat_at) + 60 * MINUTE).toISOString(),
    source: 'meals',
  }))

  const fixedItems = [...fixedEventItems, ...mealItems]
  const items = [...flexibleItems, ...fixedItems].sort((left, right) => {
    const leftTime = left.scheduled_for ? Date.parse(left.scheduled_for) : dayEnd + 1
    const rightTime = right.scheduled_for ? Date.parse(right.scheduled_for) : dayEnd + 1
    return leftTime - rightTime || left.title.localeCompare(right.title)
  })
  const nextFixed = [...fixedItems].sort((left, right) => Date.parse(left.scheduled_for || '') - Date.parse(right.scheduled_for || ''))[0]
  const firstPriority = flexibleItems[0]
  const headline = firstPriority && nextFixed
    ? `Start with ${firstPriority.title}; protect ${nextFixed.title} at ${timeLabel(nextFixed.scheduled_for!, input.timeZone)}.`
    : firstPriority
      ? `Start with ${firstPriority.title}.`
      : nextFixed
        ? `Your next fixed commitment is ${nextFixed.title} at ${timeLabel(nextFixed.scheduled_for!, input.timeZone)}.`
        : 'Your day is open from what Pepper can currently verify.'

  const appointmentCount = fixedEventItems.filter((item) => item.kind === 'appointment').length
  const eventCount = fixedEventItems.length - appointmentCount

  return {
    generated_at: input.now,
    date: today,
    headline,
    summary: `${taskCandidates.length} task priorit${taskCandidates.length === 1 ? 'y' : 'ies'}, ${choreCandidates.length} chore${choreCandidates.length === 1 ? '' : 's'}, ${fixedEventItems.length} fixed event${fixedEventItems.length === 1 ? '' : 's'}, ${mealItems.length} meal${mealItems.length === 1 ? '' : 's'}, and ${emailCandidates.length} email signal${emailCandidates.length === 1 ? '' : 's'} arranged for today.`,
    items,
    conflicts: conflictLabels(appointments),
    counts: {
      tasks: taskCandidates.length,
      chores: choreCandidates.length,
      events: eventCount,
      appointments: appointmentCount,
      meals: mealItems.length,
      emails: emailCandidates.length,
    },
  }
}
