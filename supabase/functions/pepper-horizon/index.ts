import postgres from 'npm:postgres@3.4.7'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
  ssl: 'require',
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
})
const TZ = 'America/Los_Angeles'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-pepper-session',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function dateLA(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function localDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
}

function dayLabel(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`))
}

function timeLabel(timestamp: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function namesLabel(names: string[]) {
  const unique = [...new Set(names)]
  if (unique.length < 2) return unique[0] || ''
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(', ')}, and ${unique.at(-1)}`
}

function transportRelevant(item: any) {
  if (!item) return false
  if (['school_dropoff', 'school_pickup'].includes(item.kind)) return true
  if (item.kind !== 'transport') return false
  if (item.person_slug) return true
  const text = `${item.title || ''} ${item.location || ''}`.toLowerCase()
  return /(pickup|pick up|dropoff|drop off|ride|driver|carpool|transport)/.test(text)
}

function groupSchoolChanges(rows: any[]) {
  const groups = new Map<string, any[]>()
  for (const row of rows) {
    const key = [
      row.schedule_date,
      row.schedule_kind,
      row.schedule_title,
      row.dismissal_at || 'all-day',
    ].join('|')
    groups.set(key, [...(groups.get(key) || []), row])
  }

  return [...groups.values()].map((group) => {
    const first = group[0]
    const names = group.map((row) => row.display_name)
    const people = namesLabel(names)
    const schools = [...new Set(group.map((row) => row.school_name))]
    const allDay = first.schedule_kind === 'no_school'
    const dated = first.resolution_level === 'dated_exception'
    const detail = allDay
      ? `${people} ${group.length === 1 ? 'has' : 'have'} no school. School transportation routines are removed.`
      : dated
        ? `${people} ${group.length === 1 ? 'dismisses' : 'dismiss'} at ${timeLabel(first.dismissal_at)}. This replaces the normal pickup time.`
        : `${people} ${group.length === 1 ? 'dismisses' : 'dismiss'} at ${timeLabel(first.dismissal_at)} on the recurring school schedule.`
    const title = allDay
      ? `No school - ${first.schedule_title}`
      : group.length === 1
        ? `${first.display_name} - ${first.schedule_title}`
        : first.schedule_title

    return {
      id: `school:${first.schedule_date}:${group.map((row) => row.school_profile_id).sort().join(':')}`,
      title,
      person_slug: group.length === 1 ? first.person_slug : null,
      starts_at: first.dismissal_at || first.day_starts_at,
      ends_at: null,
      location: schools.length === 1 ? schools[0] : `${schools.length} schools`,
      status: 'confirmed',
      visibility: 'household',
      kind: 'school_schedule',
      source: 'official_school_schedule',
      source_label: first.source_label,
      source_url: first.source_url,
      item_type: 'school_schedule',
      date: first.schedule_date,
      all_day: allDay,
      detail,
      affected_people: people,
      schedule_kind: first.schedule_kind,
      schedule_title: first.schedule_title,
      schedule_precedence: first.precedence,
      resolution_level: first.resolution_level,
      importance: dated ? 'high' : 'normal',
    }
  })
}

async function member(req: Request) {
  const token = req.headers.get('x-pepper-session') || ''
  if (!UUID.test(token)) return null
  const rows = await sql<any[]>`
    select m.id, m.household_id, m.slug, m.display_name, m.role
    from public.member_sessions s
    join public.household_members m on m.id = s.member_id
    where s.token = ${token}::uuid
      and s.revoked_at is null
      and s.expires_at > now()
    limit 1
  `
  return rows[0] || null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: cors,
    })
  }

  try {
    const currentMember = await member(req)
    if (!currentMember) {
      return new Response(JSON.stringify({ error: 'Pepper session required.' }), {
        status: 401,
        headers: cors,
      })
    }

    const start = dateLA()
    const end7 = addDays(start, 6)
    const end30 = addDays(start, 30)
    const [events, routines, tasks, calendar, members, consequences, watch, schoolSchedule] =
      await Promise.all([
        sql<any[]>`
          select id, title, person_slug, starts_at, ends_at, location, status,
            visibility, owner_member_id, kind, transport_owner_member_id,
            transport_status, source, adult_required, adult_requirement_label,
            adult_owner_member_id, adult_requirement_status
          from public.events
          where household_id = ${currentMember.household_id}::uuid
            and status <> 'canceled'
            and starts_at >= (${start}::date::timestamp at time zone ${TZ})
            and starts_at < ((${end30}::date + 1)::timestamp at time zone ${TZ})
            and (visibility = 'household' or owner_member_id = ${currentMember.id}::uuid)
          order by starts_at
        `,
        sql<any[]>`
          select r.id, r.title, r.person_slug, r.location, r.kind,
            r.transport_owner_member_id, r.importance, r.days_of_week,
            r.starts_local::text, r.ends_local::text, r.effective_start,
            r.effective_end, gs::date::text occurrence_date,
            ((gs::date + r.starts_local) at time zone ${TZ}) starts_at,
            case when r.ends_local is null then null
              else ((gs::date + r.ends_local) at time zone ${TZ}) end ends_at
          from private.family_routines r
          cross join generate_series(${start}::date, ${end30}::date, interval '1 day') gs
          where r.household_id = ${currentMember.household_id}::uuid
            and r.active = true
            and extract(dow from gs)::int = any(r.days_of_week)
            and (r.effective_start is null or gs::date >= r.effective_start)
            and (r.effective_end is null or gs::date <= r.effective_end)
          order by starts_at
        `,
        sql<any[]>`
          select id, title, owner_member_id, visibility, status, due_at, source
          from public.tasks
          where household_id = ${currentMember.household_id}::uuid
            and status not in ('completed', 'canceled')
            and due_at is not null
            and due_at >= (${start}::date::timestamp at time zone ${TZ})
            and due_at < ((${end30}::date + 1)::timestamp at time zone ${TZ})
            and (visibility = 'household' or owner_member_id = ${currentMember.id}::uuid)
          order by due_at
        `,
        sql<any[]>`
          select calendar_name, status, sync_status, scan_window_days,
            last_attempt_at, last_synced_at, last_error
          from public.calendar_connections
          where household_id = ${currentMember.household_id}::uuid
            and provider = 'google'
          limit 1
        `,
        sql<any[]>`
          select id, slug, display_name
          from public.household_members
          where household_id = ${currentMember.household_id}::uuid
        `,
        sql<any[]>`
          select c.id, c.consequence_type, c.title, c.summary, c.severity,
            c.status, c.event_id, c.related_event_id, c.affected_member_id,
            c.detected_at, c.last_seen_at, e.starts_at event_starts_at,
            e.title event_title, e.person_slug event_person_slug,
            e.ends_at event_ends_at, e.location event_location,
            e.status event_status, e.visibility event_visibility,
            e.owner_member_id event_owner_member_id, e.kind event_kind,
            e.transport_owner_member_id event_transport_owner_member_id,
            e.transport_status event_transport_status, e.source event_source,
            e.external_url event_external_url,
            e.external_organizer_email event_external_organizer_email,
            e.external_organizer_name event_external_organizer_name,
            re.title related_title, re.person_slug related_person_slug,
            re.starts_at related_starts_at, re.ends_at related_ends_at,
            re.location related_location, re.status related_status,
            re.visibility related_visibility,
            re.owner_member_id related_owner_member_id, re.kind related_kind,
            re.transport_owner_member_id related_transport_owner_member_id,
            re.transport_status related_transport_status, re.source related_source,
            re.external_url related_external_url,
            re.external_organizer_email related_external_organizer_email,
            re.external_organizer_name related_external_organizer_name
          from public.consequences c
          left join public.events e on e.id = c.event_id
          left join public.events re on re.id = c.related_event_id
          where c.household_id = ${currentMember.household_id}::uuid
            and c.status = 'open'
          order by case c.severity
            when 'urgent' then 0 when 'needs_attention' then 1 else 2 end,
            c.last_seen_at desc
        `,
        sql<any[]>`
          select id, title, person_slug, category, starts_on::text, ends_on::text,
            status, preparation_required, preparation_summary, prep_lead_days,
            owner_member_id, visibility, source, source_ref, confidence
          from private.future_watch_items
          where household_id = ${currentMember.household_id}::uuid
            and status not in ('canceled', 'completed')
            and starts_on between ${start}::date and ${end30}::date
            and (visibility = 'household' or owner_member_id = ${currentMember.id}::uuid)
          order by starts_on
        `,
        sql<any[]>`
          select school_profile_id, household_id, student_member_id, person_slug,
            display_name, school_name, district_name, grade_label,
            schedule_date::text, day_starts_at, dismissal_at,
            dismissal_local::text, schedule_kind, schedule_title,
            attendance_required, transportation_impact, precedence,
            resolution_level, source_label, source_url,
            schedule_source_label, schedule_source_url, source_checked_on
          from private.resolve_school_schedule(
            ${currentMember.household_id}::uuid,
            ${start}::date,
            ${end30}::date
          )
          order by schedule_date, precedence desc, display_name
        `,
      ])

    const scheduleByPersonDate = new Map(
      (schoolSchedule || []).map((schedule: any) => [
        `${schedule.person_slug}|${schedule.schedule_date}`,
        schedule,
      ]),
    )
    const memberName = (id: string | null) =>
      members.find((candidate: any) => candidate.id === id)?.display_name || null
    const actualSchoolKeys = new Set<string>()
    const actual = (events || []).map((event: any) => {
      const date = localDate(event.starts_at)
      const schoolKey = `${event.person_slug}|${date}`
      const schedule = scheduleByPersonDate.get(schoolKey) as any
      const eventText = `${event.title || ''} ${event.location || ''}`.toLowerCase()
      const namedScheduleChange = /(minimum day|early (release|dismissal)|finals?|no school)/.test(eventText)
      const sameDismissal = schedule?.dismissal_at
        && Math.abs(+new Date(event.starts_at) - +new Date(schedule.dismissal_at)) <= 30 * 60 * 1000
      const canonicalSchoolChange = schedule?.resolution_level !== 'normal_rule'
        && (namedScheduleChange || sameDismissal)
      if (canonicalSchoolChange) actualSchoolKeys.add(schoolKey)
      return {
        ...event,
        item_type: canonicalSchoolChange ? 'school_schedule' : 'event',
        date,
        transport_owner_name: memberName(event.transport_owner_member_id),
        schedule_kind: canonicalSchoolChange ? schedule.schedule_kind : null,
        resolution_level: canonicalSchoolChange ? schedule.resolution_level : null,
        all_day: canonicalSchoolChange && schedule.schedule_kind === 'no_school',
        detail: canonicalSchoolChange
          ? schedule.schedule_kind === 'no_school'
            ? `${schedule.display_name} has no school. School transportation routines are removed.`
            : `${schedule.display_name} dismisses at ${timeLabel(schedule.dismissal_at)}. The official schedule replaces the normal pickup time.`
          : null,
      }
    })

    const routineItems = (routines || []).flatMap((routine: any) => {
      const schedule = scheduleByPersonDate.get(
        `${routine.person_slug}|${routine.occurrence_date}`,
      ) as any
      const schoolRoutine = ['school_dropoff', 'school_pickup'].includes(routine.kind)
      if (schoolRoutine && schedule?.schedule_kind === 'no_school') return []

      const pickupOverride = routine.kind === 'school_pickup' && schedule?.dismissal_at
      return [{
        id: `routine:${routine.id}:${routine.occurrence_date}`,
        routine_id: routine.id,
        title: pickupOverride && schedule.resolution_level !== 'normal_rule'
          ? `${routine.title} - ${schedule.schedule_title}`
          : routine.title,
        person_slug: routine.person_slug,
        starts_at: pickupOverride ? schedule.dismissal_at : routine.starts_at,
        ends_at: routine.ends_at,
        location: routine.location,
        status: 'confirmed',
        visibility: 'household',
        kind: routine.kind,
        transport_owner_member_id: routine.transport_owner_member_id,
        transport_owner_name: memberName(routine.transport_owner_member_id),
        source: pickupOverride ? 'official_school_schedule' : 'routine',
        importance: pickupOverride && schedule?.resolution_level === 'dated_exception'
          ? 'high'
          : routine.importance,
        item_type: 'routine',
        date: routine.occurrence_date,
        days_of_week: routine.days_of_week,
        starts_local: routine.starts_local,
        schedule_kind: pickupOverride ? schedule.schedule_kind : null,
        resolution_level: pickupOverride ? schedule.resolution_level : null,
      }]
    })

    const pickupKeys = new Set(
      routineItems
        .filter((item: any) => item.kind === 'school_pickup')
        .map((item: any) => `${item.person_slug}|${item.date}`),
    )
    const schoolChanges = groupSchoolChanges(
      (schoolSchedule || []).filter((schedule: any) =>
        schedule.resolution_level !== 'normal_rule'
        && !actualSchoolKeys.has(`${schedule.person_slug}|${schedule.schedule_date}`)
        && (schedule.schedule_kind === 'no_school'
          || !pickupKeys.has(`${schedule.person_slug}|${schedule.schedule_date}`))
      ),
    )
    const schoolWeekItems = schoolChanges.filter((item: any) => item.date <= end7)
    const schoolAhead = schoolChanges.filter(
      (item: any) => item.date > end7 && item.resolution_level === 'dated_exception',
    )

    const watchItems = (watch || []).map((item: any) => ({
      ...item,
      item_type: 'watch',
      date: item.starts_on,
      owner_name: memberName(item.owner_member_id),
      prep_on: item.preparation_required && item.prep_lead_days > 0
        ? addDays(item.starts_on, -item.prep_lead_days)
        : item.starts_on,
    }))
    const combined = [...actual, ...routineItems, ...schoolWeekItems]
      .sort((a: any, b: any) => +new Date(a.starts_at) - +new Date(b.starts_at))
    const weekItems = combined.filter((item: any) => item.date <= end7)
    const aheadItems = actual.filter((item: any) => item.date > end7)
    const weekWatch = watchItems.filter((item: any) => item.date <= end7)
    const aheadWatch = watchItems.filter((item: any) => item.date > end7)
    const weekTasks = (tasks || [])
      .filter((task: any) => localDate(task.due_at) <= end7)
      .map((task: any) => ({
        ...task,
        date: localDate(task.due_at),
        owner_name: memberName(task.owner_member_id),
      }))
    const routineMap = new Map<string, any>()
    for (const routine of routines || []) {
      if (routine.occurrence_date <= end7 || routineMap.has(routine.id)) continue
      const schoolRoutine = ['school_dropoff', 'school_pickup'].includes(routine.kind)
      routineMap.set(routine.id, {
        id: routine.id,
        title: routine.title,
        person_slug: routine.person_slug,
        location: routine.location,
        kind: routine.kind,
        transport_owner_member_id: routine.transport_owner_member_id,
        transport_owner_name: memberName(routine.transport_owner_member_id),
        days_of_week: routine.days_of_week,
        starts_local: routine.starts_local,
        importance: routine.importance,
        summary: `${routine.title} continues on applicable days${routine.transport_owner_member_id ? ` - ${memberName(routine.transport_owner_member_id)} owns it` : ''}.${schoolRoutine ? ' Official school exceptions are applied automatically.' : ''}`,
      })
    }
    const routineSummaries = [...routineMap.values()]

    const days = [] as any[]
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(start, offset)
      days.push({
        date,
        label: dayLabel(date),
        items: weekItems.filter((item: any) => item.date === date),
        tasks: weekTasks.filter((task: any) => task.date === date),
        watch: weekWatch.filter((item: any) => item.date === date),
      })
    }

    const readiness = [] as any[]
    for (const item of weekItems) {
      if (transportRelevant(item) && !item.transport_owner_member_id) {
        readiness.push({
          type: 'transport',
          severity: 'needs_attention',
          date: item.date,
          title: item.title,
          summary: `${item.title}${item.starts_at ? ` - ${timeLabel(item.starts_at)}` : ''} needs a driver.`,
          event_id: item.item_type === 'event' ? item.id : null,
          primary_event: item.item_type === 'event' ? item : null,
        })
      }
      if (item.adult_required && !item.adult_owner_member_id) {
        readiness.push({
          type: 'adult_required',
          severity: 'needs_attention',
          date: item.date,
          title: item.title,
          summary: `${item.title}${item.starts_at ? ` - ${timeLabel(item.starts_at)}` : ''} needs an adult assigned.`,
          event_id: item.item_type === 'event' ? item.id : null,
          primary_event: item.item_type === 'event' ? item : null,
        })
      }
    }
    for (const task of weekTasks) {
      readiness.push({
        type: 'due_task',
        severity: 'prepare',
        date: task.date,
        title: task.title,
        summary: `Due ${dayLabel(task.date)}${task.owner_name ? ` - ${task.owner_name}` : ''}.`,
      })
    }
    for (const item of watchItems) {
      if (item.preparation_required && item.prep_on <= end7) {
        readiness.push({
          type: 'future_prepare',
          severity: 'prepare',
          date: item.prep_on,
          title: item.title,
          summary: item.preparation_summary
            || `Prepare for ${item.title} before ${dayLabel(item.starts_on)}.`,
        })
      }
    }
    const conflictTypes = new Set(['person_conflict', 'driver_conflict'])
    for (const consequence of consequences || []) {
      if (!conflictTypes.has(consequence.consequence_type)) continue
      const consequenceDate = consequence.event_starts_at
        ? localDate(consequence.event_starts_at)
        : null
      if (consequenceDate && consequenceDate <= end7) {
        const canSeePrimary = consequence.event_visibility === 'household'
          || consequence.event_owner_member_id === currentMember.id
        const canSeeRelated = !consequence.related_event_id
          || consequence.related_visibility === 'household'
          || consequence.related_owner_member_id === currentMember.id
        readiness.push({
          type: 'consequence',
          severity: consequence.severity,
          date: consequenceDate,
          title: consequence.title,
          summary: canSeePrimary && canSeeRelated
            ? consequence.summary
            : `${consequence.title}. Two commitments overlap; one is private.`,
          consequence_id: consequence.id,
          consequence_type: consequence.consequence_type,
          event_id: consequence.event_id,
          related_event_id: consequence.related_event_id,
          primary_event: consequence.event_id && canSeePrimary ? {
            id: consequence.event_id,
            title: consequence.event_title,
            person_slug: consequence.event_person_slug,
            starts_at: consequence.event_starts_at,
            ends_at: consequence.event_ends_at,
            location: consequence.event_location,
            status: consequence.event_status,
            visibility: consequence.event_visibility,
            owner_member_id: consequence.event_owner_member_id,
            kind: consequence.event_kind,
            transport_owner_member_id: consequence.event_transport_owner_member_id,
            transport_status: consequence.event_transport_status,
            source: consequence.event_source,
            external_url: consequence.event_external_url,
            external_organizer_email: consequence.event_external_organizer_email,
            external_organizer_name: consequence.event_external_organizer_name,
          } : null,
          related_event: consequence.related_event_id && canSeeRelated ? {
            id: consequence.related_event_id,
            title: consequence.related_title,
            person_slug: consequence.related_person_slug,
            starts_at: consequence.related_starts_at,
            ends_at: consequence.related_ends_at,
            location: consequence.related_location,
            status: consequence.related_status,
            visibility: consequence.related_visibility,
            owner_member_id: consequence.related_owner_member_id,
            kind: consequence.related_kind,
            transport_owner_member_id: consequence.related_transport_owner_member_id,
            transport_status: consequence.related_transport_status,
            source: consequence.related_source,
            external_url: consequence.related_external_url,
            external_organizer_email: consequence.related_external_organizer_email,
            external_organizer_name: consequence.related_external_organizer_name,
          } : null,
        })
      }
    }

    const calendarState = calendar[0] || null
    const connected = calendarState?.status === 'connected'
    const coordinationProblems = readiness.filter((item) =>
      item.severity === 'urgent' || item.severity === 'needs_attention'
    ).length
    const knownWeek = weekItems.length + weekWatch.length
    const coverage = {
      calendar_connected: connected,
      calendar_name: calendarState?.calendar_name || null,
      sync_status: calendarState?.sync_status || 'never',
      last_synced_at: calendarState?.last_synced_at || null,
      scan_window_days: calendarState?.scan_window_days || 14,
      known_week_items: knownWeek,
      due_week_tasks: weekTasks.length,
      future_watch_week: weekWatch.length,
      official_school_changes_week: schoolWeekItems.length
        + actual.filter((item: any) =>
          item.date <= end7 && item.item_type === 'school_schedule'
        ).length,
      school_profiles: new Set((schoolSchedule || []).map((row: any) => row.school_profile_id)).size,
      coordination_issues: coordinationProblems,
      headline: connected
        ? coordinationProblems
          ? `Pepper sees ${coordinationProblems} coordination ${coordinationProblems === 1 ? 'issue' : 'issues'} to solve in the next seven days.`
          : 'The next seven days look covered from the calendar and family state Pepper currently knows.'
        : `Pepper has ${knownWeek} known plans for the next seven days. Connect Google Calendar to make this view more complete.`,
    }

    const aheadConsequences = (consequences || [])
      .filter((consequence: any) =>
        conflictTypes.has(consequence.consequence_type)
        && consequence.event_starts_at
        && localDate(consequence.event_starts_at) > end7
        && localDate(consequence.event_starts_at) <= end30
      )
      .map((consequence: any) => ({
        type: 'consequence',
        date: localDate(consequence.event_starts_at),
        title: consequence.title,
        when: dayLabel(localDate(consequence.event_starts_at)),
        category: 'coordination',
        preparation_required: true,
        preparation_summary: consequence.summary,
      }))
    const futureWatch = [
      ...schoolAhead.map((item: any) => ({
        type: 'school_schedule',
        date: item.date,
        title: item.title,
        when: dayLabel(item.date),
        category: 'school_schedule',
        preparation_required: true,
        preparation_summary: item.detail,
        location: item.location,
      })),
      ...aheadWatch.map((item: any) => ({
        type: 'watch',
        date: item.date,
        title: item.title,
        when: dayLabel(item.date),
        category: item.category,
        preparation_required: item.preparation_required,
        preparation_summary: item.preparation_summary || null,
        prep_on: item.prep_on,
        owner_name: item.owner_name || null,
      })),
      ...aheadConsequences,
      ...aheadItems.map((item: any) => ({
        type: 'event',
        date: item.date,
        title: item.title,
        when: `${dayLabel(item.date)} - ${timeLabel(item.starts_at)}`,
        location: item.location || null,
      })),
    ].sort((a: any, b: any) => a.date.localeCompare(b.date)).slice(0, 30)

    return new Response(JSON.stringify({
      ok: true,
      start_date: start,
      end7_date: end7,
      end30_date: end30,
      coverage,
      calendar: calendarState,
      days,
      ahead: {
        items: aheadItems.slice(0, 20),
        watch: aheadWatch,
        routine_summaries: routineSummaries,
        future_watch: futureWatch,
      },
      readiness,
    }), { headers: cors })
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({
      error: error instanceof Error
        ? error.message
        : 'Pepper could not build the planning horizon.',
    }), { status: 500, headers: cors })
  }
})
