export const APPOINTMENT_TIME_ZONE = 'America/Los_Angeles'

export type AppointmentType =
  | 'doctor'
  | 'dental'
  | 'orthodontic'
  | 'physical_therapy'
  | 'mental_health_therapy'
  | 'medical_other'

export type AppointmentTemporalSource =
  | 'explicit'
  | 'calendar_context'
  | 'user_local_default'
  | 'missing'

export type AppointmentParseContext = {
  today: string
  calendarDate?: string | null
  calendarTime?: string | null
  timeZone?: string | null
}

export type ParsedAppointment = {
  status: 'parsed' | 'needs_review'
  startsAt: string | null
  localDate: string | null
  localTime: string | null
  timeZone: string
  dateSource: AppointmentTemporalSource
  timeSource: AppointmentTemporalSource
  timezoneSource: AppointmentTemporalSource
  unresolvedFields: string[]
  appointmentType: AppointmentType
  clinician: string | null
  patientSlug: string | null
  facility: string | null
  location: string | null
  preparationInstructions: string | null
  originalText: string
}

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

const MONTH_PATTERN = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`
const DATE_SIGNAL = new RegExp(String.raw`\b(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|${MONTH_PATTERN}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|today|tonight|tomorrow|next\s+(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat)(?:day)?)\b`, 'i')
const TIME_12_HOUR = /\b(?:at\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i
const TIME_24_HOUR = /\b(?:at\s+)?([01]\d|2[0-3]):([0-5]\d)\b/i
const TIME_SIGNAL = /(?:\bat\s+\d{1,2}(?::\d{1,2})?(?:\s*(?:a\.?m\.?|p\.?m\.?|PDT|PST))?\b|\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b)/i
const SUPPORTED_ZONE = /\b(PDT|PST|Pacific(?:\s+(?:Standard|Daylight))?\s+Time|America\/Los_Angeles)\b/i
const UNSUPPORTED_ZONE = /\b(?:EDT|EST|CDT|CST|MDT|MST|UTC|GMT|America\/New_York|America\/Chicago|America\/Denver)\b/i
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function validDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day))
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day
}

function dateString(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function addDays(date: string, amount: number) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}

function nextYearWhenOmitted(year: number, month: number, day: number, today: string) {
  for (let candidate = year; candidate <= year + 8; candidate += 1) {
    if (validDate(candidate, month, day) && dateString(candidate, month, day) >= today) return candidate
  }
  return year
}

function parseExplicitDate(text: string, today: string) {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    const day = Number(iso[3])
    return validDate(year, month, day) ? dateString(year, month, day) : null
  }

  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/)
  if (numeric) {
    const month = Number(numeric[1])
    const day = Number(numeric[2])
    let year = numeric[3]
      ? Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3])
      : Number(today.slice(0, 4))
    if (!numeric[3]) year = nextYearWhenOmitted(year, month, day, today)
    return validDate(year, month, day) ? dateString(year, month, day) : null
  }

  const named = text.match(new RegExp(String.raw`\b${MONTH_PATTERN}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, 'i'))
  if (named) {
    const month = MONTHS.findIndex((candidate) => candidate.startsWith(named[1].toLowerCase().slice(0, 3))) + 1
    const day = Number(named[2])
    let year = named[3] ? Number(named[3]) : Number(today.slice(0, 4))
    if (!named[3]) year = nextYearWhenOmitted(year, month, day, today)
    return validDate(year, month, day) ? dateString(year, month, day) : null
  }

  // Absolute dates outrank relative words that commonly appear in email footers
  // such as "download our app and start today."
  if (/\btomorrow\b/i.test(text)) return addDays(today, 1)
  if (/\b(?:today|tonight)\b/i.test(text)) return today

  const weekday = text.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)
  if (!weekday) return null
  const currentDay = new Date(`${today}T12:00:00Z`).getUTCDay()
  const targetDay = WEEKDAYS.indexOf(weekday[2].toLowerCase())
  let delta = (targetDay - currentDay + 7) % 7
  if (weekday[1]) delta = delta === 0 ? 7 : delta + 7
  return addDays(today, delta)
}

function parseExplicitTime(text: string) {
  const special = text.match(/\b(?:at\s+)?(noon|midnight)\b/i)
  if (special) return special[1].toLowerCase() === 'noon' ? '12:00' : '00:00'

  const twelveHour = text.match(TIME_12_HOUR)
  if (twelveHour) {
    let hour = Number(twelveHour[1])
    const minute = Number(twelveHour[2] || 0)
    const period = twelveHour[3].replace(/\./g, '').toLowerCase()
    if (period === 'pm' && hour < 12) hour += 12
    if (period === 'am' && hour === 12) hour = 0
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  const twentyFourHour = text.match(TIME_24_HOUR)
  if (!twentyFourHour) return null
  return `${String(Number(twentyFourHour[1])).padStart(2, '0')}:${twentyFourHour[2]}`
}

function zonedInstant(date: string, time: string, timeZone: string, expectedZoneName?: string | null) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  let value = desired
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(value))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    )
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    const adjustment = desired - represented
    value += adjustment
    if (adjustment === 0) break
  }

  const matchesWallTime = (instant: number) => {
    const represented = Object.fromEntries(
      formatter.formatToParts(new Date(instant))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    )
    return represented.year === year
      && represented.month === month
      && represented.day === day
      && represented.hour === hour
      && represented.minute === minute
  }
  const candidates = [value, value - 60 * 60_000, value + 60 * 60_000]
    .filter((candidate, index, values) => values.indexOf(candidate) === index)
    .filter(matchesWallTime)
  if (!candidates.length) return null
  if (!expectedZoneName) return new Date(candidates[0])

  const zoneNameFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  })
  const matchingCandidate = candidates.find((candidate) => (
    zoneNameFormatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== 'literal')
      .find((part) => part.type === 'timeZoneName')?.value.toUpperCase() === expectedZoneName
  ))
  return matchingCandidate === undefined ? null : new Date(matchingCandidate)
}

function offsetTimestamp(date: string, time: string, timeZone: string, expectedZoneName?: string | null) {
  const instant = zonedInstant(date, time, timeZone, expectedZoneName)
  if (!instant) return null
  const local = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    local.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const offsetMinutes = Math.round((represented - instant.getTime()) / 60_000)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
  return `${date}T${time}:00${offset}`
}

export function appointmentTypeFromText(text: string): AppointmentType {
  if (/\b(?:physical\s+therapy|physical\s+therapist|physio|PT\s+(?:appointment|session|visit))\b/i.test(text)) {
    return 'physical_therapy'
  }
  if (/\b(?:mental\s+health|psych(?:iatry|iatrist|ology|ologist)?|counsel(?:ing|or)?|behavioral\s+health|therap(?:y|ist))\b/i.test(text)) {
    return 'mental_health_therapy'
  }
  if (/\b(?:orthodont(?:ic|ist|ia)|braces)\b/i.test(text)) return 'orthodontic'
  if (/\b(?:dent(?:al|ist|istry)|teeth\s+cleaning)\b/i.test(text)) return 'dental'
  if (/\b(?:doctor|Dr\.?|physician|pediatric|dermatolog|cardiolog|neurolog|MD\b|DO\b|check[ -]?up|physical\b)\b/i.test(text)) return 'doctor'
  return 'medical_other'
}

function clinicianFromText(text: string) {
  const credentialed = text.match(/\bwith\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3},\s*(?:MD|DO|NP|PA-C|PA|DDS|DMD|PT|DPT|LCSW|LMFT|PsyD|PhD))\b/)
  if (credentialed) return credentialed[1].trim()
  const doctor = text.match(/\b(?:Dr\.?|Doctor)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})\b/)
  return doctor ? `Dr. ${doctor[1].trim()}` : null
}

function memberFromText(text: string) {
  const match = text.match(/\b(danielle|elle|matt|lyra|chloe|posey)\b/i)
  if (!match) return null
  return match[1].toLowerCase() === 'danielle' ? 'elle' : match[1].toLowerCase()
}

function facilityFromText(text: string) {
  const labeled = text.match(/\b(?:facility|clinic|office)\s*[:\-]\s*([^.;\n]+)/i)
  if (labeled) return labeled[1].trim()
  const natural = text.match(/\b(?:at|in)\s+((?!\d)[A-Z][^.;\n]{2,120})(?:[.;\n]|$)/)
  return natural ? natural[1].trim() : null
}

function locationFromText(text: string) {
  const labeled = text.match(/\b(?:location|address)\s*[:\-]\s*([^.;\n]+)/i)
  return labeled ? labeled[1].trim() : null
}

function preparationFromText(text: string) {
  const instructions = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => /\b(?:arrive|bring|fast|echeck|check[ -]?in|insurance|medication|copay|prepare|preparation|wear|avoid|instruction)\b/i.test(part))
  const unique = instructions.filter((part, index) => {
    const normalized = part.toLowerCase().replace(/\s+/g, ' ')
    return instructions.findIndex((candidate) => candidate.toLowerCase().replace(/\s+/g, ' ') === normalized) === index
  })
  return unique.length ? unique.join(' ') : null
}

export function parseAppointmentText(text: string, context: AppointmentParseContext): ParsedAppointment {
  const originalText = text
  const explicitDateSignal = DATE_SIGNAL.test(text)
  const parsedExplicitDate = explicitDateSignal ? parseExplicitDate(text, context.today) : null
  const explicitTimeSignal = TIME_SIGNAL.test(text) || /\b(?:noon|midnight)\b/i.test(text)
  const parsedExplicitTime = explicitTimeSignal ? parseExplicitTime(text) : null
  const explicitZoneMatch = text.match(SUPPORTED_ZONE)
  const explicitZone = Boolean(explicitZoneMatch)
  const explicitZoneName = /^(?:PDT|PST)$/i.test(explicitZoneMatch?.[1] || '')
    ? String(explicitZoneMatch?.[1]).toUpperCase()
    : null
  const unsupportedZone = UNSUPPORTED_ZONE.test(text)
  const timeZone = explicitZone
    ? APPOINTMENT_TIME_ZONE
    : context.timeZone || APPOINTMENT_TIME_ZONE

  const localDate = parsedExplicitDate
    || (!explicitDateSignal && context.calendarDate ? context.calendarDate : null)
    || (!explicitDateSignal ? context.today : null)
  const localTime = parsedExplicitTime
    || (!explicitTimeSignal && context.calendarTime ? context.calendarTime : null)

  const dateSource: AppointmentTemporalSource = parsedExplicitDate
    ? 'explicit'
    : !explicitDateSignal && context.calendarDate
      ? 'calendar_context'
      : !explicitDateSignal
        ? 'user_local_default'
        : 'missing'
  const timeSource: AppointmentTemporalSource = parsedExplicitTime
    ? 'explicit'
    : !explicitTimeSignal && context.calendarTime
      ? 'calendar_context'
      : 'missing'
  const timezoneSource: AppointmentTemporalSource = explicitZone
    ? 'explicit'
    : context.timeZone
      ? 'calendar_context'
      : 'user_local_default'

  const unresolvedFields: string[] = []
  if (explicitDateSignal && !parsedExplicitDate) {
    unresolvedFields.push('date: the explicit date is invalid or ambiguous')
  } else if (!localDate) {
    unresolvedFields.push('date: no date could be resolved')
  }
  if (explicitTimeSignal && !parsedExplicitTime) {
    unresolvedFields.push('time: the explicit time is invalid or missing AM/PM')
  } else if (!localTime) {
    unresolvedFields.push('time: no time could be resolved')
  }
  if (unsupportedZone) {
    unresolvedFields.push('timezone: only Pacific time is supported for this household')
  }

  const startsAt = unresolvedFields.length === 0 && localDate && localTime
    ? offsetTimestamp(localDate, localTime, timeZone, explicitZoneName)
    : null
  if (!startsAt && unresolvedFields.length === 0) {
    if (explicitZoneName && localDate && localTime && offsetTimestamp(localDate, localTime, timeZone)) {
      unresolvedFields.push(`timezone: ${explicitZoneName} does not match ${localDate} at ${localTime} in America/Los_Angeles`)
    } else {
      unresolvedFields.push('time: the local time does not exist in America/Los_Angeles')
    }
  }

  const facility = facilityFromText(text)
  const location = locationFromText(text) || facility
  return {
    status: unresolvedFields.length ? 'needs_review' : 'parsed',
    startsAt,
    localDate,
    localTime,
    timeZone,
    dateSource,
    timeSource,
    timezoneSource,
    unresolvedFields,
    appointmentType: appointmentTypeFromText(text),
    clinician: clinicianFromText(text),
    patientSlug: memberFromText(text),
    facility,
    location,
    preparationInstructions: preparationFromText(text),
    originalText,
  }
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function appointmentDedupeKey(input: {
  title: string
  startsAt: string
  patientSlug: string | null
  appointmentType: AppointmentType
  clinician: string | null
}) {
  const normalized = [
    input.title,
    input.startsAt,
    input.patientSlug || '',
    input.appointmentType,
    input.clinician || '',
  ].map((part) => part.trim().toLowerCase().replace(/\s+/g, ' ')).join('|')
  return `pepper:appointment:v2:${hash32(normalized, 0x811c9dc5)}${hash32(normalized, 0x9e3779b9)}`
}

export function appointmentEventId(dedupeKey: string) {
  const hex = [
    hash32(dedupeKey, 0x811c9dc5),
    hash32(dedupeKey, 0x9e3779b9),
    hash32(dedupeKey, 0x85ebca6b),
    hash32(dedupeKey, 0xc2b2ae35),
  ].join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
