import postgres from 'npm:postgres@3.4.7'
import {
  buildPlan,
  classifyPiece,
  cleanDelegatedAction,
  dayBounds,
  delegatedIntent,
  dueDateFrom,
  formatTime,
  isComplexTrainingPlan,
  localDate,
  replyForPlan,
  splitCapture,
} from './logic.ts'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
  ssl: 'require',
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
})
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-pepper-session',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

type Member = {
  id: string
  household_id: string
  slug: string
  display_name: string
  role: string
}

type EventRow = {
  id: string
  title: string
  person_slug: string | null
  starts_at: string
  kind: string
  transport_owner_member_id: string | null
}

type FamilyMemberRow = {
  id: string
  slug: string
  display_name: string
}

type MealRow = { id: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors })
}

async function member(req: Request): Promise<Member | null> {
  const token = req.headers.get('x-pepper-session') || ''
  if (!UUID.test(token)) return null
  const rows = await sql<Member[]>`
    select m.id,m.household_id,m.slug,m.display_name,m.role
    from public.member_sessions s
    join public.household_members m on m.id=s.member_id
    where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now()
    limit 1
  `
  return rows[0] || null
}

function planRecordId() {
  return crypto.randomUUID()
}

async function appendCapture(m: Member, text: string, source: string, dedupeKey: string | null) {
  const captureId = planRecordId()
  const rows = await sql<{ id: string }[]>`
    insert into public.captures(
      id,household_id,member_id,source,original_text,status,extracted_facts,
      applied_changes,dedupe_key,aegis_sync_status,sharing_scope
    ) values (
      ${captureId}::uuid,${m.household_id}::uuid,${m.id}::uuid,
      ${source === 'voice' ? 'voice' : 'text'},${text},'captured','[]'::jsonb,
      '[]'::jsonb,${dedupeKey},'captured','member_private'
    )
    on conflict (household_id,dedupe_key) where dedupe_key is not null do nothing
    returning id
  `
  let id = rows[0]?.id
  const existing = !id
  if (!id && dedupeKey) {
    const existingRows = await sql<{ id: string; original_text: string; source: string }[]>`
      select id,original_text,source from public.captures
      where household_id=${m.household_id}::uuid
        and member_id=${m.id}::uuid
        and dedupe_key=${dedupeKey}
      limit 1
    `
    if (existingRows[0] && (
      existingRows[0].original_text !== text ||
      existingRows[0].source !== (source === 'voice' ? 'voice' : 'text')
    )) {
      throw new Error('That idempotency key was already used for a different update.')
    }
    id = existingRows[0]?.id
  }
  if (!id) throw new Error('Pepper could not safely save this update.')

  if (!existing) {
    await sql`
      insert into public.audit_log(
        household_id,actor_member_id,capture_id,event_type,entity_type,entity_id,summary
      ) values (
        ${m.household_id}::uuid,${m.id}::uuid,${id}::uuid,'capture_saved','capture',${id},
        'Saved original update before interpretation.'
      )
    `
  }
  return { id, existing }
}

async function applyPlan(captureId: string, m: Member, idempotencyKey: string, plan: unknown) {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rows = await sql<{ result: Record<string, unknown> }[]>`
        select private.apply_capture_plan(
          ${captureId}::uuid,${m.id}::uuid,${idempotencyKey},${JSON.stringify(plan)}::jsonb
        ) as result
      `
      return rows[0]?.result
    } catch (error) {
      lastError = error
    }
  }

  try {
    await sql`
      select private.pepper_record_capture_apply_failure(
        ${captureId}::uuid,${m.id}::uuid,
        ${lastError instanceof Error ? lastError.message : 'Capture plan failed.'}
      )
    `
  } catch (failureRecordError) {
    console.error('Could not record capture application failure.', failureRecordError)
  }
  throw lastError
}

async function interpretCapture(m: Member, text: string) {
  const today = localDate()
  const [dayStart, dayEnd] = dayBounds(today)
  const [memberRows, eventRows, mealRows] = await Promise.all([
    sql<{ id: string; slug: string; display_name: string }[]>`
      select id,slug,display_name from public.household_members
      where household_id=${m.household_id}::uuid
    `,
    sql<EventRow[]>`
      select id,title,person_slug,starts_at,kind,transport_owner_member_id
      from public.events
      where household_id=${m.household_id}::uuid
        and starts_at>=${dayStart}::timestamptz
        and starts_at<${dayEnd}::timestamptz
        and status<>'canceled'
      order by starts_at
    `,
    sql<{ id: string }[]>`
      select id from public.meal_plan
      where household_id=${m.household_id}::uuid and meal_date=${today}::date
      limit 1
    `,
  ])
  const familyMembers = memberRows as FamilyMemberRow[]
  const todayEvents = eventRows as EventRow[]
  const todayMeals = mealRows as MealRow[]
  const memberBySlug = new Map<string, FamilyMemberRow>(
    familyMembers.map((row: FamilyMemberRow) => [row.slug, row]),
  )
  const writes: Record<string, unknown>[] = []
  const messages: string[] = []
  const ambiguities: string[] = []
  if (isComplexTrainingPlan(text)) {
    const facts = splitCapture(text)
    return { facts, writes, messages, ambiguities: facts }
  }
  const delegated = delegatedIntent(text)

  if (delegated) {
    const subject = memberBySlug.get(delegated.subjectSlug)
    if (!subject) return { facts: [text], writes, messages, ambiguities: [text] }
    const due = dueDateFrom(text, today)
    const title = cleanDelegatedAction(subject.display_name, delegated.action)
    writes.push({
      operation: 'task.create',
      record_id: planRecordId(),
      title,
      owner_member_id: m.id,
      visibility: 'household',
      status: 'open',
      due_at: due ? new Date(`${due.date}T12:00:00-07:00`).toISOString() : null,
      source: 'pepper_capture',
      metadata: { type: 'task_created', subject_member_slug: delegated.subjectSlug },
      audit_event_type: 'task_created',
      audit_summary: `${title}${due ? ` due ${due.label}` : ''}.`,
    })
    messages.push(due
      ? `I added “${title}” to ${due.label}’s plan.`
      : `I added “${title}” to the family plan.`)
    return { facts: [text], writes, messages, ambiguities }
  }

  const facts = splitCapture(text)
  for (const fact of facts) {
    const intent = classifyPiece(fact, today)

    if (intent.type === 'event.cancel') {
      const matches = todayEvents.filter((event: EventRow) =>
        event.person_slug === intent.personSlug &&
        event.title.toLowerCase().includes(intent.titleWord.toLowerCase()))
      if (matches.length === 0) { ambiguities.push(fact); continue }
      for (const event of matches) {
        writes.push({
          operation: 'event.update', record_id: event.id, status: 'canceled',
          metadata: { type: 'event_canceled' },
        })
      }
      const person = intent.personSlug.charAt(0).toUpperCase() + intent.personSlug.slice(1)
      messages.push(`${person}’s ${intent.titleWord} is off the plan.`)
      continue
    }

    if (intent.type === 'ride.assign') {
      const driver = memberBySlug.get(intent.driverSlug)
      const matches = todayEvents.filter((event: EventRow) => event.person_slug === intent.personSlug)
      if (!driver || matches.length === 0) { ambiguities.push(fact); continue }
      for (const event of matches) {
        writes.push({
          operation: 'event.update', record_id: event.id,
          transport_owner_member_id: driver.id, transport_status: 'assigned',
          ...(intent.time ? { starts_at: intent.time } : {}),
          metadata: { type: 'driver_assigned' },
          audit_event_type: 'driver_assigned',
          audit_summary: `${driver.display_name} assigned to ${intent.personSlug}.`,
        })
      }
      const person = intent.personSlug.charAt(0).toUpperCase() + intent.personSlug.slice(1)
      messages.push(`${driver.display_name} is handling ${person}.`)
      continue
    }

    if (intent.type === 'ride.unassign') {
      const driver = memberBySlug.get(intent.driverSlug)
      const matches = todayEvents.filter((event: EventRow) =>
        event.person_slug === intent.personSlug &&
        event.transport_owner_member_id === driver?.id)
      if (!driver || matches.length === 0) { ambiguities.push(fact); continue }
      for (const event of matches) {
        writes.push({
          operation: 'event.update', record_id: event.id,
          transport_owner_member_id: null, transport_status: 'unassigned',
          metadata: { type: 'driver_unassigned' },
        })
      }
      const person = intent.personSlug.charAt(0).toUpperCase() + intent.personSlug.slice(1)
      messages.push(`${person} needs a new ride.`)
      continue
    }

    if (intent.type === 'private.event') {
      const endsAt = new Date(new Date(intent.time).getTime() + 60 * 60 * 1000).toISOString()
      writes.push({
        operation: 'event.create', record_id: planRecordId(),
        title: `${m.display_name} · ${intent.eventKind}`, person_slug: m.slug,
        starts_at: intent.time, ends_at: endsAt, visibility: 'private',
        owner_member_id: m.id, kind: 'private_availability', source: 'pepper',
        metadata: { type: 'event_created' },
      })
      messages.push(`${m.display_name} availability updated at ${formatTime(intent.time)}.`)
      continue
    }

    if (intent.type === 'meal') {
      writes.push({
        operation: 'meal.upsert', record_id: todayMeals[0]?.id || planRecordId(),
        meal_date: today, meal_name: intent.mealName, eat_at: intent.time,
        metadata: { type: 'meal_updated' },
      })
      const mealEvent = todayEvents.find((event: EventRow) => event.kind === 'meal')
      if (mealEvent) {
        writes.push({
          operation: 'event.update', record_id: mealEvent.id,
          title: `Dinner · ${intent.mealName}`,
          ...(intent.time ? { starts_at: intent.time } : {}),
          metadata: { type: 'meal_event_updated' },
        })
      } else {
        writes.push({
          operation: 'event.create', record_id: planRecordId(),
          title: `Dinner · ${intent.mealName}`,
          starts_at: intent.time || new Date(`${today}T18:30:00-07:00`).toISOString(),
          visibility: 'household', kind: 'meal', source: 'pepper',
          metadata: { type: 'meal_event_created' },
        })
      }
      messages.push(`Dinner updated${intent.time ? ` for ${formatTime(intent.time)}` : ''}.`)
      continue
    }

    if (intent.type === 'grocery' && intent.item) {
      writes.push({
        operation: 'grocery.create', record_id: planRecordId(), item: intent.item,
        status: 'open', metadata: { type: 'grocery_added' },
      })
      messages.push(`${intent.item} added to groceries.`)
      continue
    }

    if (intent.type === 'task') {
      writes.push({
        operation: 'task.create', record_id: planRecordId(), title: intent.title,
        owner_member_id: intent.private ? m.id : null,
        visibility: intent.private ? 'private' : 'household', status: 'open',
        source: 'pepper_capture', metadata: { type: 'task_created' },
      })
      messages.push(`Saved ${intent.private ? 'privately: ' : ''}${intent.title}.`)
      continue
    }

    ambiguities.push(fact)
  }

  return { facts, writes, messages, ambiguities }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const currentMember = await member(req)
    if (!currentMember) return json({ error: 'Pepper session required.' }, 401)
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
    const action = String(body.action || 'tell')

    if (action === 'review_list') {
      const rows = await sql<{ reviews: unknown }[]>`
        select coalesce(jsonb_agg(review_row order by review_row.captured_at desc),'[]'::jsonb) as reviews
        from private.list_capture_reviews(
          ${currentMember.id}::uuid,${Math.min(Math.max(Number(body.limit) || 50, 1), 100)}
        ) review_row
      `
      return json({ ok: true, reviews: rows[0]?.reviews || [] })
    }

    if (action === 'review_resolve') {
      const captureId = String(body.capture_id || '')
      const idempotencyKey = String(body.idempotency_key || '')
      if (!UUID.test(captureId) || !idempotencyKey || body.resolution !== 'no_change_required') {
        return json({ error: 'Capture, idempotency key, and an explicit no-change resolution are required.' }, 400)
      }
      const reviewPlan = {
        version: 1,
        kind: 'review_resolution',
        outcome: 'applied',
        resolution: 'no_change_required',
        safe_subset_declared: false,
        extracted_facts: [],
        remaining_ambiguities: [],
        writes: [],
      }
      const rows = await sql<{ result: unknown }[]>`
        select private.resolve_capture_review(
          ${captureId}::uuid,${currentMember.id}::uuid,${idempotencyKey},
          ${JSON.stringify(reviewPlan)}::jsonb
        ) as result
      `
      return json(rows[0]?.result || { ok: false })
    }

    const text = String(body.text || '').trim()
    if (!text) return json({ error: 'Tell Pepper what changed first.' }, 400)
    if (text.length > 4000) return json({ error: 'That update is too long. Keep it under 4,000 characters.' }, 400)
    const clientKey = String(body.idempotency_key || '').trim()
    const capture = await appendCapture(
      currentMember, text, String(body.source) === 'voice' ? 'voice' : 'text',
      clientKey ? clientKey.slice(0, 200) : null,
    )
    if (capture.existing && clientKey) {
      const prior = await sql<{ result: Record<string, unknown> }[]>`
        select result from private.capture_plan_applications
        where capture_id=${capture.id}::uuid and idempotency_key=${clientKey.slice(0, 200)}
        limit 1
      `
      if (prior[0]?.result) {
        return json({
          status: prior[0].result.status,
          captureId: capture.id,
          capture_id: capture.id,
          reply: 'Done. Pepper already handled that update.',
          applied_changes: prior[0].result.applied_changes || [],
          idempotent_replay: true,
        })
      }
    }
    const interpretation = await interpretCapture(currentMember, text)
    const plan = buildPlan(interpretation.facts, interpretation.writes, interpretation.ambiguities)
    const result = await applyPlan(
      capture.id, currentMember, clientKey ? clientKey.slice(0, 200) : crypto.randomUUID(), plan,
    )
    const outcome = String(result?.status || plan.outcome)
    return json({
      status: outcome,
      captureId: capture.id,
      capture_id: capture.id,
      reply: replyForPlan(outcome, interpretation.messages),
      applied_changes: result?.applied_changes || [],
    })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Pepper could not interpret that update.' }, 500)
  }
})
