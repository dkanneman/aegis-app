export type ReadCapability = 'gmail' | 'calendar_read'
export const READ_SCOPES = {
  gmail: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
  calendar_read: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'],
} as const

export function assertReadScopes(capability: ReadCapability, value: unknown) {
  const scopes = new Set(String(value || '').split(/\s+/).filter(Boolean).map(s => s === 'https://www.googleapis.com/auth/userinfo.email' ? 'email' : s))
  const expected: readonly string[] = READ_SCOPES[capability]
  if (scopes.size !== expected.length || expected.some(s => !scopes.has(s))) throw new Error('Reconnect with only the requested read-only permissions.')
}

export function localMidnight(date: string, zone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid calendar date.')
  const nominal = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0,10) !== date) throw new Error('Invalid calendar date.')
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' })
  let value = nominal
  for (let i=0;i<4;i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(p=>[p.type,p.value]))
    const wall = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second)
    const next = value + nominal - wall
    if (next === value) return new Date(value).toISOString()
    value = next
  }
  throw new Error('Calendar timezone could not be resolved.')
}

type GoogleDate = { date?: string; dateTime?: string; timeZone?: string }
export type GoogleReadEvent = {
  id?: string; summary?: string; status?: string; iCalUID?: string; updated?: string;
  start?: GoogleDate; end?: GoogleDate; originalStartTime?: GoogleDate; recurringEventId?: string;
  location?: string; htmlLink?: string; transparency?: string; eventType?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
}
export function normalizeSourceEvent(event: GoogleReadEvent, calendar: {id:string; timeZone?:string}) {
  if (!event.id) throw new Error('Calendar returned an event without its identity.')
  const sourceId = `${calendar.id}:${event.id}`
  if (event.status === 'cancelled' || event.attendees?.some(a=>a.self && a.responseStatus==='declined')) return null
  const zone = event.start?.timeZone || calendar.timeZone || 'America/Los_Angeles'
  const allDay = Boolean(event.start?.date)
  const start = allDay ? localMidnight(event.start!.date!,zone) : event.start?.dateTime
  const end = allDay ? localMidnight(event.end?.date || '',zone) : event.end?.dateTime
  if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end)<=Date.parse(start)) throw new Error('Calendar returned an unresolved event time.')
  const recurrence = event.originalStartTime?.date || (event.originalStartTime?.dateTime ? new Date(event.originalStartTime.dateTime).toISOString() : allDay ? event.start!.date : new Date(start).toISOString())
  return {
    id:`source:${sourceId}`, source_id:sourceId, external_event_id:event.id, external_calendar_id:calendar.id,
    title:event.summary || 'Private calendar commitment', starts_at:new Date(start).toISOString(), ends_at:new Date(end).toISOString(),
    all_day:allDay, blocks_time:event.transparency!=='transparent', status:event.status || 'confirmed',
    location:event.location || null, source:'google_read', source_url:safeSourceUrl(event.htmlLink,'calendar.google.com'),
    source_timezone:zone, source_updated_at:event.updated || null,
    dedupe_key:event.iCalUID ? `${event.iCalUID}:${recurrence}` : sourceId,
  }
}
export function safeSourceUrl(value: unknown, host: string) {
  try { const u=new URL(String(value));return u.protocol==='https:' && u.hostname===host ? u.toString() : null } catch { return null }
}
export function deduplicateSourceEvents<T extends {dedupe_key:string;source_updated_at:string|null;starts_at:string;ends_at:string;title:string;location:string|null}>(items:T[]) {
  const seen = new Map<string,T>()
  for (const item of items) {
    // Never merge merely on a title or silently discard conflicting copies.
    const key=JSON.stringify([item.dedupe_key,item.starts_at,item.ends_at,item.title,item.location])
    const previous=seen.get(key)
    if (!previous || Date.parse(item.source_updated_at||'0')>Date.parse(previous.source_updated_at||'0')) seen.set(key,item)
  }
  return [...seen.values()]
}

export function emailSuggestion(input:{id:string;threadId:string;subject:string;sender:string;body:string;received_at:string}, account:string) {
  const text=`${input.subject}\n${input.body}`
  if (/\b(payment received|order confirmation|verification code|security code|attendance note confirmation)\b/i.test(input.subject) && !/\b(action required|past due|payment failed)\b/i.test(input.subject)) return null
  const attendance=/\battendance report\b/i.test(input.subject) && /\b(?:absent|tardy)\b/i.test(text) && /\b(?:send a note|explain the absence|contact the school)\b/i.test(text)
  const request=text.match(/\b(?:please (?:send|complete|review|confirm|sign|call|upload|pay)|can you|could you|respond by|reply by|action required)\b/i)
  const deadline=text.match(/\b(?:deadline|past due|due (?:today|tomorrow|by|on)|no later than|must be (?:received|submitted|completed|paid|signed))\b/i)
  const logistics=/\b(?:appointment|practice|school|rehearsal)\b/i.test(text) && /\b(?:rescheduled|canceled|cancelled|moved|arrival|bring|pickup)\b/i.test(text)
  if (!request && !deadline && !logistics && !attendance) return null
  return {
    id:input.id,thread_id:input.threadId,subject:input.subject || 'Email needs review',sender:input.sender,received_at:input.received_at,
    snippet:input.body.slice(0,600),reason:attendance?'Suggested: review school attendance; contact the office only if not already handled':deadline?'Suggested: review an explicit deadline':request?'Suggested: respond to an explicit request':'Suggested: review a schedule change',
    action_score:deadline?12:request||attendance?8:5,status:'suggested',
    source_url:`https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${encodeURIComponent(input.threadId || input.id)}`,
  }
}
