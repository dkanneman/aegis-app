import {
  APPOINTMENT_TIME_ZONE,
  appointmentDedupeKey,
  appointmentEventId,
  parseAppointmentText,
  type ParsedAppointment,
} from './appointment-intake.ts'

export type GmailConnectionState =
  | 'connected_and_current'
  | 'syncing'
  | 'stale'
  | 'reconnect_required'
  | 'error'

export type GmailAttachment = {
  filename: string
  mimeType: string
  attachmentId?: string | null
  size?: number | null
  extractedText?: string | null
}

export type GmailMessageInput = {
  id: string
  threadId: string
  subject: string
  sender: string
  receivedAt: string
  snippet?: string | null
  bodyText?: string | null
  labels?: string[]
  attachments?: GmailAttachment[]
}

export type GmailMember = {
  id: string
  slug: string
  displayName: string
}

export type GmailClassification = {
  relevant: boolean
  category:
    | 'appointment'
    | 'appointment_change'
    | 'appointment_cancellation'
    | 'task_request'
    | 'deadline'
    | 'school_family_logistics'
    | 'bill_payment'
    | 'work_client_information'
    | 'informational'
    | 'needs_review'
  confidence: number
  peopleAffected: GmailMember[]
  sender: string
  organization: string | null
  appointment: ParsedAppointment | null
  deadline: string | null
  requestedAction: string | null
  location: string | null
  preparationRequirements: string | null
  evidence: string[]
  unresolvedFields: string[]
  autoAction: 'create_appointment' | 'cancel_appointment' | 'create_task' | 'review' | 'ignore'
  title: string
  entityFingerprint: string
  entityId: string
  sourceMessageId: string
}

type GmailRawPart = {
  mimeType?: unknown
  filename?: unknown
  body?: { attachmentId?: unknown; data?: unknown; size?: unknown }
  parts?: GmailRawPart[]
}

type GmailRawMessage = {
  payload?: GmailRawPart & { headers?: Array<{ name?: unknown; value?: unknown }> }
}

type PubSubEnvelope = {
  message?: { data?: unknown; messageId?: unknown; publishTime?: unknown }
}

type GmailHistoryPage = {
  historyId?: unknown
  nextPageToken?: unknown
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: unknown } }>
    labelsAdded?: Array<{ message?: { id?: unknown } }>
  }>
}

const RELEVANT = /\b(?:appointments?|mychart|doctor|physician|dent(?:al|ist)|orthodont|therap(?:y|ist)|clinic|medical|school|teacher|campus|dismiss(?:al|ed)|pickup|pick-up|drop[ -]?off|rehearsal|practice|audition|permission slip|field trip|deadline|due\b|action required|please (?:send|complete|review|confirm|sign|pay)|invoice|bill|payment|past due|reservation|booking|itinerary|flight|hotel|client|proposal|bid|estimate|meeting|schedule|reschedul|cancel(?:ed|lation)?|location changed|time changed)\b/i
const APPOINTMENT = /\b(?:appointments?|doctor|physician|dent(?:al|ist)|orthodont|therap(?:y|ist)|clinic|medical visit|check[ -]?up|physical\s+therapy|counseling)\b/i
const CANCELLATION = /\b(?:cancelled|canceled|cancellation|will not take place|no longer scheduled)\b/i
const CHANGE = /\b(?:rescheduled|changed|new (?:date|time|location)|updated (?:date|time|location)|moved to)\b/i
const DEADLINE = /\b(?:deadline|due (?:today|tomorrow|by|on)|must be (?:received|submitted|completed|paid|signed)|no later than)\b/i
const SCHOOL = /\b(?:school|teacher|campus|homework|assignment|dismiss(?:al|ed)|pickup|pick-up|drop[ -]?off|permission slip|field trip|rehearsal|practice|audition)\b/i
const BILL = /\b(?:invoice|bill|payment|past due|balance due|copay|late fee|premium)\b/i
const WORK = /\b(?:client|proposal|bid|estimate|jobsite|job site|project|contract|closing|escrow|inspection|listing|real estate|framing)\b/i
const REQUEST = /\b(?:action required|please (?:send|complete|review|confirm|sign|call|email|upload|pay)|can you|could you|respond by|reply by)\b/i
const ACTIVITY_LOGISTICS = /\b(?:school|studio|class|practice|rehearsal|activity)\b[\s\S]{0,100}\b(?:closed|canceled|cancelled|moved|rescheduled|delayed)\b|\b(?:closed|canceled|cancelled|moved|rescheduled|delayed)\b[\s\S]{0,100}\b(?:school|studio|class|practice|rehearsal|activity)\b/i
const FAMILY_EVENT = /\b(?:reservation|booking|itinerary|vacation|theme park|concert|performance|birthday party|family event)\b/i
const DATE_SIGNAL = /\b(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{1,2}(?:st|nd|rd|th)?|today|tomorrow|next\s+(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*)\b/i
const BILL_PROBLEM = /\b(?:action required|account needs attention|declined|failed|past due|overdue|due (?:today|tomorrow|by|on)|balance due|late fee|renewal|statement)\b/i
const COMPLETED_PURCHASE = /\b(?:you paid|paid it off|payment received|payment (?:is being|being|was) processed|we.re processing your payment|order confirmation|purchase confirmation|your purchases from apple|thank you for your (?:order|purchase))\b/i

export function isKnownBulkNoise(input: Pick<GmailMessageInput, 'sender' | 'subject' | 'snippet' | 'bodyText'>) {
  const sender = input.sender.toLowerCase()
  const subject = input.subject.toLowerCase()
  const text = `${subject}\n${input.snippet || ''}\n${input.bodyText || ''}`

  if (/jobalerts-noreply@linkedin\.com|jobs-noreply@linkedin\.com/.test(sender)) return true
  if (/noreply@medium\.com|hello@classdojo\.com|info@hello\.mindvalley\.com/.test(sender)) return true
  if (/no-reply@youtube\.com/.test(sender) && /youtube kids|back-to-school toolkit/.test(`${sender} ${subject}`)) return true
  if (/school@peachjar\.com/.test(sender) && /community flyer/.test(subject)) return true
  if (/info@poshmark\.com/.test(sender) && /listing that you liked|offer made on a listing|thank you for listing/.test(subject)) return true
  if (/support@poshmark\.com/.test(sender) && /order confirmation/.test(subject)) return true
  if (/orders@poshmark\.com/.test(sender) && /purchase.+(?:shipped|delivered)/.test(subject)) return true
  if (/position-tracking@semrush\.com/.test(sender) && /position tracking update/.test(subject)) return true
  if (/@(?:[^>\s]+\.)?nextdoor\.com/.test(sender)) return true
  if (/my-home@mail\.zillow\.com/.test(sender) && /home report/.test(subject)) return true
  if (/newsletter@connect\.scpr\.org/.test(sender)) return true
  if (/noreply@patients\.pgsurveying\.com/.test(sender) && /feedback|survey/.test(subject)) return true
  if (/donotreplymychart@providence\.org/.test(sender) && /account has been recovered|verification code/.test(subject)) return true
  if (/no-reply@notification\.kiausa\.com/.test(sender) && /charge complete/.test(subject)) return true
  if (/your_order_us@orders\.apple\.com/.test(sender) && /order is being processed/.test(subject)) return true
  if (/notify@updates\.getflex\.com/.test(sender) && /new rent payment option/.test(subject)) return true
  if (/fred@fireflies\.ai/.test(sender) && /no one admitted.+bot/.test(subject)) return true
  if (COMPLETED_PURCHASE.test(subject) && !BILL_PROBLEM.test(subject)) return true
  if (COMPLETED_PURCHASE.test(text) && !BILL_PROBLEM.test(text)) return true
  return false
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function stableUuid(value: string) {
  const hex = [
    hash32(value, 0x811c9dc5),
    hash32(value, 0x9e3779b9),
    hash32(value, 0x85ebca6b),
    hash32(value, 0xc2b2ae35),
  ].join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function entityFingerprint(parts: Array<string | null | undefined>) {
  const value = parts.map((part) => normalize(String(part || ''))).join('|')
  return `${hash32(value, 0x811c9dc5)}${hash32(value, 0x9e3779b9)}`
}

export function decodeBase64Url(value: string) {
  if (!value) return ''
  const normalizedValue = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(normalizedValue), (character) => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function htmlToText(value: string) {
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim()
}

export function gmailHeader(message: GmailRawMessage, name: string) {
  const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : []
  return String(headers.find((header) => String(header?.name || '').toLowerCase() === name.toLowerCase())?.value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractGmailContent(message: GmailRawMessage) {
  const plain: string[] = []
  const html: string[] = []
  const attachments: GmailAttachment[] = []
  const visit = (part: GmailRawPart) => {
    const mimeType = String(part?.mimeType || '').toLowerCase()
    const filename = String(part?.filename || '').trim()
    const attachmentId = String(part?.body?.attachmentId || '').trim() || null
    const data = String(part?.body?.data || '')
    if (filename || attachmentId) {
      attachments.push({
        filename: filename || 'attachment',
        mimeType: mimeType || 'application/octet-stream',
        attachmentId,
        size: Number.isFinite(Number(part?.body?.size)) ? Number(part.body.size) : null,
      })
    } else if (data && mimeType === 'text/plain') {
      plain.push(decodeBase64Url(data))
    } else if (data && mimeType === 'text/html') {
      html.push(htmlToText(decodeBase64Url(data)))
    }
    for (const child of Array.isArray(part?.parts) ? part.parts : []) visit(child)
  }
  visit(message?.payload || {})
  return {
    bodyText: (plain.length ? plain : html).join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
    attachments,
  }
}

export function shouldRetrieveFullMessage(input: Pick<GmailMessageInput, 'sender' | 'subject' | 'snippet' | 'bodyText'>) {
  return !isKnownBulkNoise(input) && RELEVANT.test(`${input.subject}\n${input.snippet || ''}`)
}

export function connectionHealth(input: {
  storedState?: string | null
  lastSuccessfulScanAt?: string | null
  lastAttemptedScanAt?: string | null
  watchExpiration?: string | number | null
  now?: string | number | Date
  staleAfterMs?: number
}) : GmailConnectionState {
  if (input.storedState === 'reconnect_required') return 'reconnect_required'
  if (input.storedState === 'error') return 'error'
  const now = new Date(input.now || Date.now()).getTime()
  const attempted = input.lastAttemptedScanAt ? new Date(input.lastAttemptedScanAt).getTime() : 0
  const successful = input.lastSuccessfulScanAt ? new Date(input.lastSuccessfulScanAt).getTime() : 0
  const watchExpiration = input.watchExpiration ? new Date(Number(input.watchExpiration) > 1e12 ? Number(input.watchExpiration) : input.watchExpiration).getTime() : 0
  if (input.storedState === 'syncing' && attempted > now - 15 * 60_000) return 'syncing'
  if (!successful || successful < now - (input.staleAfterMs || 30 * 60_000)) return 'stale'
  if (!watchExpiration || watchExpiration <= now) return 'stale'
  return 'connected_and_current'
}

export function watchNeedsRenewal(input: {
  watchExpiration?: string | number | null
  lastRenewedAt?: string | null
  now?: string | number | Date
}) {
  const now = new Date(input.now || Date.now()).getTime()
  const expiration = input.watchExpiration ? new Date(Number(input.watchExpiration) > 1e12 ? Number(input.watchExpiration) : input.watchExpiration).getTime() : 0
  const renewed = input.lastRenewedAt ? new Date(input.lastRenewedAt).getTime() : 0
  return !expiration || expiration <= now + 48 * 60 * 60_000 || !renewed || renewed <= now - 24 * 60 * 60_000
}

export function classifyGoogleAuthError(status: number, detail: string): GmailConnectionState {
  return status === 401 || /\b(?:invalid_grant|revoked|expired token|invalid credentials)\b/i.test(detail)
    ? 'reconnect_required'
    : 'error'
}

export function decodePubSubNotification(body: PubSubEnvelope) {
  const encoded = String(body?.message?.data || '')
  if (!encoded) throw new Error('Pub/Sub notification did not contain Gmail data.')
  const decoded = JSON.parse(decodeBase64Url(encoded))
  const emailAddress = String(decoded?.emailAddress || '').trim().toLowerCase()
  const historyId = String(decoded?.historyId || '').trim()
  if (!emailAddress || !/^\d+$/.test(historyId)) throw new Error('Pub/Sub notification contained invalid Gmail data.')
  return {
    pubSubMessageId: String(body?.message?.messageId || '').trim(),
    publishedAt: String(body?.message?.publishTime || '').trim() || null,
    emailAddress,
    historyId,
  }
}

export async function collectHistoryMessageIds(
  startHistoryId: string,
  fetchPage: (pageToken?: string) => Promise<GmailHistoryPage>,
) {
  const ids = new Set<string>()
  let pageToken: string | undefined
  let latestHistoryId = startHistoryId
  do {
    const page = await fetchPage(pageToken)
    latestHistoryId = String(page?.historyId || latestHistoryId)
    for (const history of Array.isArray(page?.history) ? page.history : []) {
      for (const change of [
        ...(Array.isArray(history?.messagesAdded) ? history.messagesAdded : []),
        ...(Array.isArray(history?.labelsAdded) ? history.labelsAdded : []),
      ]) {
        const id = String(change?.message?.id || '').trim()
        if (id) ids.add(id)
      }
    }
    pageToken = page?.nextPageToken ? String(page.nextPageToken) : undefined
  } while (pageToken)
  return { messageIds: [...ids], latestHistoryId }
}

function senderOrganization(sender: string) {
  const address = sender.match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1] || ''
  const domain = address.split('@')[1]?.toLowerCase().replace(/^mail\./, '') || ''
  const named = sender.replace(/<[^>]+>/g, '').replace(/^['"]|['"]$/g, '').trim()
  if (named && named !== address) return named
  if (!domain) return null
  return domain.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function recognizedAppointmentProvider(sender: string, _text: string) {
  void _text
  return /\b(?:mychart|epic|health|medical|clinic|hospital|pediatric|dental|dentist|orthodont|therapy|therapist|kaiser|uclahealth|cedars|dignityhealth|providence)\b/i.test(sender)
}

function requestedActionFromText(text: string) {
  return text.split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .find((part) => REQUEST.test(part) || /\b(?:bring|arrive|complete|confirm|call|reply|pay|sign|upload)\b/i.test(part))
    ?.slice(0, 500) || null
}

function deadlineFromText(text: string, today: string) {
  if (!DEADLINE.test(text)) return null
  const parsed = parseAppointmentText(text, { today, timeZone: APPOINTMENT_TIME_ZONE })
  return parsed.startsAt
}

export function classifyGmailMessage(
  message: GmailMessageInput,
  members: GmailMember[],
  context: { today: string; timeZone?: string; ownerSlug?: string | null; ownerEmail?: string | null },
): GmailClassification {
  const attachmentText = (message.attachments || []).map((item) => item.extractedText || '').join('\n')
  const text = [message.subject, message.snippet || '', message.bodyText || '', attachmentText].filter(Boolean).join('\n')
  const knownBulkNoise = isKnownBulkNoise(message)
  const peopleAffected = members.filter((member) => new RegExp(`\\b${member.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b|\\b${member.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
  const owner = members.find((member) => member.slug === context.ownerSlug) || null
  const senderAddress = message.sender.match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1]?.toLowerCase() || ''
  const isOwnerCommand = Boolean(owner && context.ownerEmail
    && senderAddress === context.ownerEmail.toLowerCase()
    && requestedActionFromText(text))
  const affected = peopleAffected.length ? peopleAffected : owner ? [owner] : []
  const summaryText = `${message.subject}\n${message.snippet || ''}`
  const isAppointment = APPOINTMENT.test(summaryText)
    || (recognizedAppointmentProvider(message.sender, text) && APPOINTMENT.test(text))
  const isCancellation = isAppointment && CANCELLATION.test(text)
  const isChange = isAppointment && !isCancellation && CHANGE.test(text)
  let category: GmailClassification['category'] = 'informational'
  if (knownBulkNoise) category = 'informational'
  else if (isCancellation) category = 'appointment_cancellation'
  else if (isChange) category = 'appointment_change'
  else if (isAppointment) category = 'appointment'
  else if (ACTIVITY_LOGISTICS.test(text)) category = 'school_family_logistics'
  else if (DEADLINE.test(text)) category = 'deadline'
  else if (SCHOOL.test(text) || FAMILY_EVENT.test(text)) category = 'school_family_logistics'
  else if (BILL.test(text)) category = 'bill_payment'
  else if (WORK.test(text)) category = 'work_client_information'
  else if (REQUEST.test(text)) category = 'task_request'

  const relevant = !knownBulkNoise && (category !== 'informational' || RELEVANT.test(text))
  const appointment = isAppointment && !knownBulkNoise
    ? parseAppointmentText(text, { today: context.today, timeZone: context.timeZone || APPOINTMENT_TIME_ZONE })
    : null
  const unresolvedFields = [...(appointment?.unresolvedFields || [])]
  for (const attachment of message.attachments || []) {
    if (attachment.extractedText?.startsWith('Attachment needs review:')) {
      unresolvedFields.push(`attachment: ${attachment.filename} could not be parsed safely`)
    }
  }
  if (isAppointment && !affected.length) unresolvedFields.push('person: no household member could be identified')
  if (isAppointment && !recognizedAppointmentProvider(message.sender, text)) {
    unresolvedFields.push('source: appointment provider is not recognized')
  }
  if ((isCancellation || isChange) && !message.threadId) unresolvedFields.push('source: no Gmail thread is available for matching')
  if (relevant && DATE_SIGNAL.test(text) && isAppointment && appointment?.dateSource !== 'explicit') {
    unresolvedFields.push('date: the source date could not be preserved confidently')
  }

  const evidence = [
    `Subject: ${message.subject}`,
    `Sender: ${message.sender}`,
  ]
  if (appointment?.localDate) evidence.push(`Explicit date: ${appointment.localDate}`)
  if (appointment?.localTime) evidence.push(`Explicit time: ${appointment.localTime}`)
  if (appointment?.clinician) evidence.push(`Clinician: ${appointment.clinician}`)
  if (peopleAffected.length) evidence.push(`People: ${peopleAffected.map((person) => person.displayName).join(', ')}`)
  else if (isOwnerCommand && owner) evidence.push(`Connected owner command: ${owner.displayName}`)
  else if (owner) evidence.push(`Default owner: ${owner.displayName}`)

  let confidence = relevant ? 0.72 : 0.98
  if (appointment?.status === 'parsed') confidence += 0.12
  if (recognizedAppointmentProvider(message.sender, text)) confidence += 0.08
  if (peopleAffected.length) confidence += 0.05
  if (isOwnerCommand) confidence += 0.1
  if (REQUEST.test(text)) confidence += 0.08
  if (unresolvedFields.length) confidence = Math.min(confidence, 0.69)
  confidence = Math.min(0.99, Number(confidence.toFixed(3)))

  let autoAction: GmailClassification['autoAction'] = relevant ? 'review' : 'ignore'
  if (category === 'appointment' && appointment?.status === 'parsed' && affected.length === 1 && unresolvedFields.length === 0 && confidence >= 0.9) {
    autoAction = 'create_appointment'
  } else if (category === 'appointment_cancellation' && affected.length === 1 && unresolvedFields.length === 0) {
    autoAction = 'cancel_appointment'
  } else if (category === 'task_request' && (peopleAffected.length === 1 || isOwnerCommand)
      && requestedActionFromText(text) && confidence >= 0.85 && !DATE_SIGNAL.test(text)) {
    autoAction = 'create_task'
  }

  const title = message.subject.trim().slice(0, 240) || 'Email needing review'
  const fingerprint = appointment?.startsAt
    ? appointmentDedupeKey({
        title,
        startsAt: appointment.startsAt,
        patientSlug: affected[0]?.slug || appointment.patientSlug,
        appointmentType: appointment.appointmentType,
        clinician: appointment.clinician,
      })
    : entityFingerprint([category, title, affected[0]?.slug, deadlineFromText(text, context.today)])
  return {
    relevant,
    category: relevant && category === 'informational' && unresolvedFields.length ? 'needs_review' : category,
    confidence,
    peopleAffected: affected,
    sender: message.sender,
    organization: senderOrganization(message.sender),
    appointment,
    deadline: deadlineFromText(text, context.today),
    requestedAction: requestedActionFromText(text),
    location: appointment?.location || null,
    preparationRequirements: appointment?.preparationInstructions || null,
    evidence,
    unresolvedFields,
    autoAction,
    title,
    entityFingerprint: fingerprint,
    entityId: appointment?.startsAt ? appointmentEventId(fingerprint) : stableUuid(`gmail:${message.id}:${fingerprint}`),
    sourceMessageId: message.id,
  }
}

export function parseCalendarAttachment(value: string) {
  const unfolded = value.replace(/\r?\n[ \t]/g, '')
  const lines = unfolded.split(/\r?\n/)
  const field = (name: string) => lines.find((line) => line.toUpperCase().startsWith(`${name}:`) || line.toUpperCase().startsWith(`${name};`)) || ''
  const read = (line: string) => line.slice(line.indexOf(':') + 1).replace(/\\n/gi, '\n').replace(/\\,/g, ',').trim()
  const startLine = field('DTSTART')
  const endLine = field('DTEND')
  const parseIcsDate = (line: string) => {
    if (!line) return null
    const raw = read(line)
    if (/^\d{8}$/.test(raw)) return { date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, time: null, zone: null }
    const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/)
    if (!match) return null
    const zone = line.match(/TZID=([^:;]+)/i)?.[1] || (match[7] ? 'UTC' : null)
    const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}${match[7] ? 'Z' : ''}`
    return { date: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}`, zone, iso }
  }
  return {
    uid: read(field('UID')) || null,
    summary: read(field('SUMMARY')) || null,
    location: read(field('LOCATION')) || null,
    description: read(field('DESCRIPTION')) || null,
    status: read(field('STATUS')).toLowerCase() || null,
    start: parseIcsDate(startLine),
    end: parseIcsDate(endLine),
  }
}
