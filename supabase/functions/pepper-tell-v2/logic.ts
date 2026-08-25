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

export function dayBounds(date = localDate()) {
  const start = new Date(`${date}T00:00:00-07:00`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return [start.toISOString(), end.toISOString()]
}

export function timeFromText(text: string, date = localDate()) {
  const match = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\b/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const period = (match[3] || '').toLowerCase()
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  return new Date(
    `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-07:00`,
  ).toISOString()
}

export function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function splitCapture(text: string) {
  return text
    .split(/(?:\.|;|\band\b|\bthen\b)/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function dueDateFrom(text: string, today = localDate()) {
  if (/\btomorrow\b/i.test(text)) return { date: addDays(today, 1), label: 'tomorrow' }
  if (/\b(today|tonight)\b/i.test(text)) return { date: today, label: 'today' }
  return null
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

export type PieceIntent =
  | { type: 'event.cancel'; personSlug: string; titleWord: string; time: string | null }
  | { type: 'ride.assign'; driverSlug: string; personSlug: string; time: string | null }
  | { type: 'ride.unassign'; driverSlug: string; personSlug: string }
  | { type: 'private.event'; eventKind: 'meeting' | 'appointment'; time: string }
  | { type: 'meal'; mealName: string; time: string | null }
  | { type: 'grocery'; item: string }
  | { type: 'task'; title: string; private: boolean }
  | { type: 'ambiguous'; text: string }

export function classifyPiece(piece: string, date = localDate()): PieceIntent {
  const normalized = piece.toLowerCase()
  const time = timeFromText(piece, date)
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

  if (/\b(meeting|appointment)\b/i.test(piece) && time) {
    return {
      type: 'private.event',
      eventKind: /meeting/i.test(piece) ? 'meeting' : 'appointment',
      time,
    }
  }

  if (normalized.includes('dinner')) {
    const match = piece.match(/dinner\s+(?:is|will be)?\s*(.*)/i)
    return {
      type: 'meal',
      mealName: (match?.[1] || '').replace(/\bat\s+\d.*$/i, '').trim() || 'Dinner',
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

  const explicitTask = piece.match(/^(?:i|we)\s+(?:need|have)\s+to\s+(.+)$/i)
  if (
    explicitTask ||
    /^(order|buy|call|email|pick up|return|confirm|look into|find|schedule|book|pay|upload|review|create|send|get|bring)\b/i.test(piece)
  ) {
    return {
      type: 'task',
      title: (explicitTask?.[1] || piece).trim(),
      private: /\b(private|just for me|my private)\b/i.test(piece),
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
