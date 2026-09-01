import { createClient } from 'npm:@supabase/supabase-js@2'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-pepper-session',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
}

const now = () => new Date().toISOString()
const TODAY_FEED_HOURS = 72

async function member(req: Request) {
  const token = req.headers.get('x-pepper-session')
  if (!token) return null
  const { data } = await db
    .from('member_sessions')
    .select('member_id,household_members(id,slug,display_name,role,household_id)')
    .eq('token', token)
    .is('revoked_at', null)
    .gt('expires_at', now())
    .maybeSingle()
  return data?.household_members || null
}

function whenLabel(ts?: string | null) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts))
}

function severityRank(value: string) {
  if (value === 'urgent') return 0
  if (value === 'needs_attention') return 1
  if (value === 'prepare') return 2
  return 3
}

function looksLikeTransport(e: any) {
  if (!e) return false
  if (['school_dropoff', 'school_pickup'].includes(e.kind)) return true
  if (e.kind !== 'transport') return false
  if (e.person_slug) return true
  const text = `${e.title || ''} ${e.location || ''}`.toLowerCase()
  return /(pickup|pick up|dropoff|drop off|ride|driver|carpool|transport)/.test(text)
}

function overlaps(primary: any, candidate: any) {
  if (!primary?.starts_at || !candidate?.starts_at) return false
  const aStart = new Date(primary.starts_at).getTime()
  const aEnd = primary.ends_at ? new Date(primary.ends_at).getTime() : aStart + 60 * 60 * 1000
  const bStart = new Date(candidate.starts_at).getTime()
  const bEnd = candidate.ends_at ? new Date(candidate.ends_at).getTime() : bStart + 60 * 60 * 1000
  return aStart < bEnd && bStart < aEnd
}

function names(values: string[]) {
  if (values.length === 1) return values[0]
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return Response.json({ error: 'POST required.' }, { status: 405, headers: cors })

  const m: any = await member(req)
  if (!m) return Response.json({ error: 'Invalid Pepper family session.' }, { status: 401, headers: cors })

  const { data: findings, error } = await db
    .from('consequences')
    .select('id,consequence_type,severity,title,summary,event_id,related_event_id,affected_member_id,detected_at,last_seen_at,metadata')
    .eq('household_id', m.household_id)
    .eq('status', 'open')

  if (error) return Response.json({ error: 'Could not load Pepper consequences.' }, { status: 500, headers: cors })

  const eventIds = [...new Set((findings || []).flatMap((x: any) => [x.event_id, x.related_event_id]).filter(Boolean))]
  const [{ data: events }, { data: adults }] = await Promise.all([
    eventIds.length
      ? db.from('events').select('id,title,visibility,owner_member_id,person_slug,starts_at,ends_at,kind,location,status,transport_owner_member_id,transport_status,source,external_url,external_organizer_email,external_organizer_name').in('id', eventIds)
      : Promise.resolve({ data: [] as any[] }),
    db.from('household_members').select('id,slug,display_name,role').eq('household_id', m.household_id).in('role', ['adult_admin','adult']),
  ])
  const eventMap = new Map((events || []).map((e: any) => [e.id, e]))
  const adultSlugs = (adults || []).map((a: any) => a.slug)
  const currentMs = Date.now()
  const latestMs = currentMs + TODAY_FEED_HOURS * 60 * 60 * 1000
  const { data: adultEvents } = adultSlugs.length
    ? await db.from('events')
        .select('id,person_slug,starts_at,ends_at,status')
        .eq('household_id', m.household_id)
        .in('person_slug', adultSlugs)
        .in('status', ['tentative','confirmed'])
        .gte('starts_at', new Date(currentMs - 12 * 60 * 60 * 1000).toISOString())
        .lte('starts_at', new Date(latestMs + 12 * 60 * 60 * 1000).toISOString())
    : { data: [] as any[] }

  const unbookedAdults = (primary: any) => (adults || []).filter((adult: any) => {
    return !(adultEvents || []).some((event: any) => event.person_slug === adult.slug && event.id !== primary?.id && overlaps(primary, event))
  })

  const safe = (findings || []).flatMap((c: any) => {
    const primary: any = c.event_id ? eventMap.get(c.event_id) : null
    const related: any = c.related_event_id ? eventMap.get(c.related_event_id) : null
    const canSee = (e: any) => !e || e.visibility === 'household' || e.owner_member_id === m.id
    const startsAt = primary?.starts_at || c.metadata?.starts_at || c.metadata?.overlap_start || c.metadata?.ride_start || null
    const startMs = startsAt ? new Date(startsAt).getTime() : null

    // Today is for action, not the whole week's anxiety.
    if (startMs && (startMs < currentMs - 2 * 60 * 60 * 1000 || startMs > latestMs)) return []
    if (c.consequence_type === 'missing_transport' && !looksLikeTransport(primary)) return []

    let summary = c.summary
    const when = whenLabel(startsAt)
    const availableDrivers = primary ? unbookedAdults(primary) : []
    if (c.consequence_type === 'missing_transport' && primary) {
      const available = availableDrivers.map((a: any) => a.display_name)
      summary = `${primary.title}${when ? ` · ${when}` : ''} needs a driver.`
      if (available.length) summary += ` ${names(available)} ${available.length === 1 ? 'looks' : 'look'} unbooked in Pepper at that time.`
    } else if (c.consequence_type === 'missing_required_adult' && primary) {
      const available = unbookedAdults(primary).map((a: any) => a.display_name)
      summary = `${primary.title}${when ? ` · ${when}` : ''} needs an adult assigned.`
      if (available.length) summary += ` ${names(available)} ${available.length === 1 ? 'looks' : 'look'} unbooked in Pepper at that time.`
    }

    if (c.consequence_type === 'person_conflict' && (!canSee(primary) || !canSee(related))) {
      summary = `${c.title}. Two commitments overlap; one is private.`
    }
    if (c.consequence_type === 'driver_conflict' && !canSee(related)) {
      summary = `${c.title}. The assigned driver has an overlapping private commitment.`
    }

    return [{
      id: c.id,
      type: c.consequence_type,
      severity: c.severity,
      title: c.title,
      summary,
      event_id: c.event_id,
      related_event_id: c.related_event_id,
      affected_member_id: c.affected_member_id,
      starts_at: startsAt,
      detected_at: c.detected_at,
      last_seen_at: c.last_seen_at,
      primary_event: canSee(primary) ? primary : null,
      related_event: canSee(related) ? related : null,
      available_drivers: availableDrivers.map((adult: any) => ({
        id: adult.id,
        slug: adult.slug,
        display_name: adult.display_name,
      })),
    }]
  }).sort((a: any, b: any) => {
    const severity = severityRank(a.severity) - severityRank(b.severity)
    if (severity) return severity
    const at = a.starts_at ? new Date(a.starts_at).getTime() : Number.MAX_SAFE_INTEGER
    const bt = b.starts_at ? new Date(b.starts_at).getTime() : Number.MAX_SAFE_INTEGER
    return at - bt
  })

  return Response.json({ consequences: safe }, { headers: { ...cors, 'Cache-Control': 'no-store' } })
})
