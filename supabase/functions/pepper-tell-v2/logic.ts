export const TIME_ZONE = 'America/Los_Angeles'

export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function addDays(date: string, amount: number) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const MONTH_DATE_SOURCE = String.raw`\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b`
const CLOCK_TIME_SOURCE = String.raw`\b(?:at\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(?:o['’]?clock\s*)?(a\.?m\.?|p\.?m\.?)\b`
const FAMILY_MEMBER_SOURCE = 'danielle|elle|matt|lyra|chloe|posey'

function validCalendarDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day))
  return value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
}

function monthNumber(value: string) {
  const normalized = value.toLowerCase().replace(/\.$/, '')
  return MONTHS.findIndex((month) => month.startsWith(normalized.slice(0, 3))) + 1
}

export function dateFromText(text: string, today = localDate()) {
  if (/\btomorrow\b/i.test(text)) return { date: addDays(today, 1), label: 'tomorrow' }
  if (/\b(today|tonight)\b/i.test(text)) return { date: today, label: 'today' }

  const iso = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/)
  if (iso) return { date: iso[0], label: iso[0] }

  const numeric = text.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/(\d{2}|20\d{2}))?\b/)
  if (numeric) {
    const year = numeric[3]
      ? Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3])
      : Number(today.slice(0, 4))
    const month = Number(numeric[1])
    const day = Number(numeric[2])
    if (validCalendarDate(year, month, day)) {
      const date = `${year}-${numeric[1].padStart(2, '0')}-${numeric[2].padStart(2, '0')}`
      return { date, label: date }
    }
  }

  const named = text.match(new RegExp(MONTH_DATE_SOURCE, 'i'))
  if (named) {
    const month = monthNumber(named[1])
    const day = Number(named[2])
    let year = named[3] ? Number(named[3]) : Number(today.slice(0, 4))
    if (!named[3]) {
      const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (candidate < today) year += 1
    }
    if (validCalendarDate(year, month, day)) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      return { date, label: named[0] }
    }
  }

  const weekday = text.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)
  if (!weekday) return null
  const currentDay = new Date(`${today}T12:00:00Z`).getUTCDay()
  const targetDay = WEEKDAYS.indexOf(weekday[2].toLowerCase())
  let delta = (targetDay - currentDay + 7) % 7
  if (weekday[1] && delta < 7) delta += 7
  return { date: addDays(today, delta), label: weekday[0].toLowerCase() }
}

export function dayBounds(date = localDate()) {
  const start = new Date(`${date}T00:00:00-07:00`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return [start.toISOString(), end.toISOString()]
}

export function timeFromText(text: string, date = localDate()) {
  const special = text.match(/\b(?:at\s+)?(noon|midnight)\b/i)
  const match = text.match(new RegExp(CLOCK_TIME_SOURCE, 'i'))
  if (!match && !special) return null
  let hour = special
    ? special[1].toLowerCase() === 'noon' ? 12 : 0
    : Number(match?.[1])
  const minute = Number(match?.[2] || 0)
  const period = (match?.[3] || '').replace(/\./g, '').toLowerCase()
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0

  const [year, month, day] = date.split('-').map(Number)
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  let utcValue = desired
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(utcValue))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    )
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    )
    const adjustment = desired - represented
    utcValue += adjustment
    if (adjustment === 0) break
  }
  return new Date(utcValue).toISOString()
}

export function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function splitCapture(text: string) {
  const protectedText = text.replace(
    /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|Ave|Rd|Blvd)\./gi,
    '$1__PEPPER_DOT__',
  )
  return protectedText
    .split(/(?:[.;]+|\b(?:and\s+)?then\b|\band\s+(?=(?:add|create|schedule|assign|change|update|cancel|delete|complete|mark|set|move|order|buy|call|email|pick up|return|confirm|look into|find|book|pay|upload|review|send|get|bring)\b))/i)
    .map((part) => part.replace(/__PEPPER_DOT__/g, '.').trim())
    .filter(Boolean)
}

function cleanEventTitle(piece: string) {
  let title = piece
    .replace(/^please\s+/i, '')
    .replace(/^(?:(?:add|create)\s+(?:an?\s+)?(?:calendar\s+)?|new\s+)event\s*[-:–—]?\s*/i, '')
    .replace(/^(?:add|create|schedule|put|make|book)\s+(?:an?\s+)?/i, '')
    .replace(/\s+(?:on|to)\s+(?:(?:the|my)\s+)?calendar\b/gi, ' ')
    .replace(/^(?:on|to)\s+(?:(?:the|my)\s+)?calendar\s*[-:–—]?\s*/i, '')
    .replace(new RegExp(MONTH_DATE_SOURCE, 'ig'), ' ')
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])(?:\/(?:\d{2}|20\d{2}))?\b/g, ' ')
    .replace(/\b(?:next\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, ' ')
    .replace(/\b(?:today|tonight|tomorrow)\b/gi, ' ')
    .replace(new RegExp(CLOCK_TIME_SOURCE, 'ig'), ' ')
    .replace(/\b(?:at\s+)?(?:noon|midnight)\b/gi, ' ')
    .replace(/\b(?:called|titled|named)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  title = title
    .replace(
      new RegExp(String.raw`^for\s+(${FAMILY_MEMBER_SOURCE})\s+(?:(?:on|at)\s+)?for\s+`, 'i'),
      '$1 ',
    )
    .replace(new RegExp(String.raw`^for\s+(?=(?:${FAMILY_MEMBER_SOURCE})\b)`, 'i'), '')
    .replace(/^(?:on|at)\s+|\s+(?:on|at)$/gi, '')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return title ? title.charAt(0).toUpperCase() + title.slice(1) : ''
}

export function dueDateFrom(text: string, today = localDate()) {
  return dateFromText(text, today)
}

export function cleanDelegatedAction(subject: string, action: string) {
  let cleaned = action
    .replace(/\b(tomorrow|today|tonight)\b/gi, '')
    .replace(/[.]+$/, '')
    .trim()
  if (/\b(dr|doctor|doctors?)\s+app(?:ointment)?\b/i.test(cleaned)) {
    return `Make a doctor appointment for ${subject}`
  }
  cleaned = cleaned.replace(/\bhim\b/gi, subject).replace(/\bher\b/gi, subject)
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned
}

export function delegatedIntent(text: string) {
  const match = text.match(/\b(matt|lyra|chloe|posey|elle)\b\s+(?:needs|asked|wants)\s+me\s+to\s+(.+)/i)
  if (!match) return null
  return { subjectSlug: match[1].toLowerCase(), action: match[2] }
}

export function isComplexTrainingPlan(text: string) {
  return /\b(running|training)\s+plan\b/i.test(text) &&
    /\b(week|mileage|miles?|easy|tempo|intervals?|long run|pace|days?)\b/i.test(text)
}

export type PepperQuestionIntent =
  | { type: 'schedule'; date: string; dateLabel: string; personSlug: string | null }
  | { type: 'ride'; date: string; dateLabel: string; personSlug: string | null }
  | { type: 'meal'; date: string; dateLabel: string }
  | { type: 'chores'; personSlug: string | null }
  | { type: 'tasks'; personSlug: string | null }
  | { type: 'work' }
  | { type: 'front_seat'; date: string; dateLabel: string }
  | { type: 'health' }
  | { type: 'unknown' }

export function questionIntent(
  text: string,
  today = localDate(),
): PepperQuestionIntent | null {
  const clean = text.trim()
  const isQuestion = /\?$/.test(clean)
    || /^(?:question\s*[-:–—]?\s*|what|when|where|who|why|how|which|can|could|should|would|do|does|is|are|will|tell me|show me)\b/i.test(clean)
  if (!isQuestion) return null

  if (/^(?:can|could|would)\s+you\s+(?:please\s+)?(?:add|create|schedule|assign|change|update|cancel|delete|complete|mark|set|move)\b/i.test(clean)) {
    return null
  }

  const requestedDate = dateFromText(clean, today)
    || { date: today, label: 'today' }
  const personMatch = clean.match(/\b(danielle|elle|matt|lyra|chloe|posey)\b/i)
  const personSlug = personMatch
    ? personMatch[1].toLowerCase() === 'danielle'
      ? 'elle'
      : personMatch[1].toLowerCase()
    : null

  if (/\b(front\s+seat|sit(?:s|ting)?\s+(?:up\s+)?front|riding\s+(?:up\s+)?front)\b/i.test(clean)) {
    return {
      type: 'front_seat',
      date: requestedDate.date,
      dateLabel: requestedDate.label,
    }
  }
  if (/\b(dinner|meal|eating|having to eat)\b/i.test(clean) || /what are we having/i.test(clean)) {
    return { type: 'meal', date: requestedDate.date, dateLabel: requestedDate.label }
  }
  if (/\b(steps?|exercise minutes?|active minutes?|apple health|health totals?)\b/i.test(clean)) {
    return { type: 'health' }
  }
  if (/\b(pick(?:ing)?\s+up|drop(?:ping)?[ -]?off|driver|driving|ride|transportation|getting\s+(?:lyra|chloe|posey)\s+(?:to|from))\b/i.test(clean)) {
    return {
      type: 'ride',
      date: requestedDate.date,
      dateLabel: requestedDate.label,
      personSlug,
    }
  }
  if (/\bchores?\b/i.test(clean)) return { type: 'chores', personSlug }
  if (/\bwork\b/i.test(clean) && /\b(tasks?|to[ -]?dos?|priorit(?:y|ies)|due|need to do)\b/i.test(clean)) {
    return { type: 'work' }
  }
  if (/\b(tasks?|to[ -]?dos?|need(?:s)? to do)\b/i.test(clean)) {
    return { type: 'tasks', personSlug }
  }
  if (
    personSlug
    || requestedDate.label !== 'today'
    || /\b(schedule|calendar|event|appointment|rehearsal|practice|game|concert|recital|performance|birthday|doing|happening|on today|on tomorrow)\b/i.test(clean)
  ) {
    return {
      type: 'schedule',
      date: requestedDate.date,
      dateLabel: requestedDate.label,
      personSlug,
    }
  }
  return { type: 'unknown' }
}

export function clarificationFor(text: string, today = localDate()) {
  const clean = text.trim()
  const eventLanguage = /\b(event|meeting|appointment|rehearsal|practice|game|concert|recital|performance|birthday party|arrives?|visits?|comes? to visit)\b/i.test(clean)
  if (eventLanguage) {
    const date = dateFromText(clean, today)
    const eventTime = timeFromText(clean, date?.date || today)
    if (!date && !eventTime) {
      return {
        question: 'What date and time should I use for this event?',
        placeholder: 'For example: Friday at 5:00 PM',
      }
    }
    if (!date) {
      return {
        question: 'What date should I use for this event?',
        placeholder: 'For example: Friday or September 18',
      }
    }
    if (!eventTime) {
      return {
        question: `What time should I use ${date.label}?`,
        placeholder: 'For example: 5:00 PM',
      }
    }
  }
  if (/\b(pick(?:ing)?\s+up|drop(?:ping)?[ -]?off|driver|driving|ride|transportation)\b/i.test(clean)) {
    return {
      question: 'Which family member, event, and time should I update?',
      placeholder: 'For example: Matt is picking up Chloe at 4:30 PM',
    }
  }
  return {
    question: 'Should I treat this as a task, event, meal, grocery item, or question?',
    placeholder: 'Add the missing detail or restate the request',
  }
}

export type PieceIntent =
  | { type: 'event.cancel'; personSlug: string; titleWord: string; time: string | null }
  | { type: 'ride.assign'; driverSlug: string; personSlug: string; time: string | null }
  | { type: 'ride.unassign'; driverSlug: string; personSlug: string }
  | {
    type: 'event.create'
    title: string
    personSlug: string | null
    time: string
    private: boolean
  }
  | { type: 'meal'; mealName: string; time: string | null }
  | { type: 'grocery'; item: string }
  | { type: 'chore'; title: string; ownerSlug: string | null }
  | {
    type: 'task'
    title: string
    private: boolean
    category: 'task' | 'work' | 'need' | 'event_follow_up'
    ownerSlug: string | null
  }
  | { type: 'question'; query: PepperQuestionIntent }
  | { type: 'ambiguous'; text: string }

export function classifyPiece(piece: string, date = localDate()): PieceIntent {
  const politeCommand = piece.match(
    /^(?:can|could|would)\s+you\s+(?:please\s+)?((?:add|create|schedule|assign|change|update|cancel|delete|complete|mark|set|move)\b.+?)\??$/i,
  )
  if (politeCommand) return classifyPiece(politeCommand[1], date)

  const normalized = piece.trim().toLowerCase()
  const eventDate = dateFromText(piece, date)
  const time = timeFromText(piece, eventDate?.date || date)
  const explicitEvent = /^(?:please\s+)?(?:(?:add|create)\s+(?:an?\s+)?(?:calendar\s+)?|new\s+)event\b/i.test(piece)
  const calendarEvent = /^(?:please\s+)?(?:add|create|schedule|put|make|book)\b.*\b(?:on|to)\s+(?:(?:the|my)\s+)?calendar\b/i.test(piece)
  const scheduleEvent = /^(?:please\s+)?schedule\b/i.test(piece)
  const eventCommand = explicitEvent || calendarEvent || scheduleEvent
  const cancel = piece.match(
    /\b(lyra|chloe|posey|matt|elle)\b.*(?:doesn['’]?t have|does not have|skip(?:ping)?|cancel(?:ed|led)?|not going to|no)\s+(.+)/i,
  )
  if (cancel) {
    return {
      type: 'event.cancel',
      personSlug: cancel[1].toLowerCase(),
      titleWord: cancel[2].replace(/today|tonight/gi, '').trim().split(/\s+/)[0],
      time,
    }
  }

  const ride = piece.match(
    /\b(elle|matt|lyra|chloe|posey)\b.*(?:getting|picking up|driving|taking)\s+(lyra|chloe|posey)\b/i,
  )
  if (ride) {
    return {
      type: 'ride.assign',
      driverSlug: ride[1].toLowerCase(),
      personSlug: ride[2].toLowerCase(),
      time,
    }
  }

  const unassign = piece.match(
    /\b(elle|matt|lyra|chloe|posey)\b.*(?:can['’]?t|cannot|can not).*\b(lyra|chloe|posey)\b/i,
  )
  if (unassign) {
    return {
      type: 'ride.unassign',
      driverSlug: unassign[1].toLowerCase(),
      personSlug: unassign[2].toLowerCase(),
    }
  }

  if (!eventCommand && (normalized.includes('dinner') || /\b(?:we\s+(?:are|'re)\s+)?having\s+.+\b(?:tonight|update the plan)\b/i.test(piece))) {
    const match = piece.match(/dinner\s+(?:is|will be)?\s*(.*)/i)
      || piece.match(/(?:tonight\s+)?(?:we\s+(?:are|'re)\s+)?having\s+(.+)/i)
    const mealName = (match?.[1] || '')
      .replace(/\s+(?:for dinner\b.*|you can update the plan\b.*|please update the plan\b.*)$/i, '')
      .replace(/\bat\s+\d.*$/i, '')
      .trim()
    return {
      type: 'meal',
      mealName: mealName ? mealName.charAt(0).toUpperCase() + mealName.slice(1) : 'Dinner',
      time,
    }
  }

  if (/^add\s+/i.test(piece) && /(grocer|shopping|milk|bread|eggs|fruit|supplies)/i.test(piece)) {
    return {
      type: 'grocery',
      item: piece
        .replace(/^add\s+/i, '')
        .replace(/\s+to\s+(the\s+)?(groceries|shopping( list)?)$/i, '')
        .trim(),
    }
  }

  const assignedChore = piece.match(
    /^(?:assign|give)\s+(danielle|elle|matt|lyra|chloe|posey)\s+(?:a\s+)?chore\s*[-:–—]?\s*(.+)$/i,
  )
  if (assignedChore) {
    const title = assignedChore[2].trim()
    return {
      type: 'chore',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      ownerSlug: assignedChore[1].toLowerCase(),
    }
  }

  const chore = piece.match(
    /^(?:(?:add|create)\s+(?:a\s+)?|new\s+)?chore(?:\s+(?:for|to)\s+(danielle|elle|matt|lyra|chloe|posey))?\s*[-:–—]?\s*(.+)$/i,
  )
  if (chore) {
    const trailingOwner = chore[2].match(
      /^(.+?)\s+(?:for|to)\s+(danielle|elle|matt|lyra|chloe|posey)$/i,
    )
    const title = (trailingOwner?.[1] || chore[2]).trim()
    return {
      type: 'chore',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      ownerSlug: (chore[1] || trailingOwner?.[2] || '').toLowerCase() || null,
    }
  }

  const workTask = piece.match(
    /^add\s+(?:a\s+)?(?:new\s+)?work\s+(?:task|to-do|todo)\s*[-:–—]?\s*(.+)$/i,
  )
  if (workTask) {
    const title = workTask[1].trim()
    return {
      type: 'task',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      private: true,
      category: 'work',
      ownerSlug: null,
    }
  }

  const question = questionIntent(piece, date)
  if (question) return { type: 'question', query: question }

  const eventLanguage = /\b(arrives?|visits?|comes? to visit|meeting|appointment|rehearsal|practice|game|concert|recital|performance|birthday party)\b/i.test(piece)
  if (eventCommand || eventLanguage) {
    const person = piece.match(/\b(danielle|elle|matt|lyra|chloe|posey)\b/i)?.[1].toLowerCase() || null
    const title = cleanEventTitle(piece)
    if (time) {
      return {
        type: 'event.create',
        title: title || 'Family event',
        personSlug: person,
        time,
        private: !person && !/\b(family|visit|arriv)/i.test(piece),
      }
    }
    return { type: 'ambiguous', text: piece }
  }

  const need = piece.match(/^(?:add\s+(?:a\s+)?need|need|i\s+need|we\s+need)\s*[-:–—]?\s*(?!to\b)(.+)$/i)
  if (need) {
    const title = need[1].trim()
    return {
      type: 'task',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      private: !/^we\s+need\b/i.test(piece),
      category: 'need',
      ownerSlug: null,
    }
  }

  const namedNeed = piece.match(/^\b(danielle|elle|matt|lyra|chloe|posey)\b\s+needs\s+(?:to\s+)?(.+)$/i)
  if (namedNeed) {
    const title = namedNeed[2].trim()
    return {
      type: 'task',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      private: false,
      category: 'need',
      ownerSlug: namedNeed[1].toLowerCase(),
    }
  }

  const prefixedTask = piece.match(
    /^(?:add\s+(?:a\s+)?(?:new\s+)?|new\s+)(?:(personal|family|household)\s+)?(?:task|to-do|todo)\s*[-:–—]?\s*(.+)$/i,
  )
  if (prefixedTask) {
    const title = prefixedTask[2].trim()
    return {
      type: 'task',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      private: !/^(family|household)$/i.test(prefixedTask[1] || ''),
      category: 'task',
      ownerSlug: null,
    }
  }

  const explicitTask = piece.match(/^(?:i|we)\s+(?:need|have)\s+to\s+(.+)$/i)
  if (
    explicitTask ||
    /^(order|buy|call|email|pick up|return|confirm|look into|find|schedule|book|pay|upload|review|create|send|get|bring)\b/i.test(piece)
  ) {
    return {
      type: 'task',
      title: (explicitTask?.[1] || piece).trim(),
      private: /\b(private|just for me|my private)\b/i.test(piece),
      category: 'task',
      ownerSlug: null,
    }
  }

  return { type: 'ambiguous', text: piece }
}

export function buildPlan(
  extractedFacts: string[],
  writes: Record<string, unknown>[],
  remainingAmbiguities: string[],
  kind = 'initial',
) {
  const outcome = writes.length === 0
    ? 'needs_review'
    : remainingAmbiguities.length > 0
      ? 'partially_applied'
      : 'applied'
  return {
    version: 1,
    kind,
    outcome,
    safe_subset_declared: outcome === 'partially_applied',
    extracted_facts: extractedFacts,
    remaining_ambiguities: remainingAmbiguities,
    writes,
  }
}

export function replyForPlan(outcome: string, messages: string[]) {
  if (messages.length === 0) {
    return 'I saved that exactly as you said it. I could not safely change structured state yet, so it is waiting in Pepper Inbox.'
  }
  return `Done. ${messages.join(' ')}${
    outcome === 'partially_applied'
      ? ' I saved the rest in Pepper Inbox so nothing is lost.'
      : ''
  }`
}
