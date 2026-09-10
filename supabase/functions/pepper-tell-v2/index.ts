import postgres from 'npm:postgres@3.4.7'
import {
  buildPlan,
  classifyPiece,
  clarificationFor,
  cleanDelegatedAction,
  dayBounds,
  delegatedIntent,
  dueDateFrom,
  formatTime,
  isComplexTrainingPlan,
  localDate,
  questionIntent,
  replyForPlan,
  splitCapture,
  type PepperQuestionIntent,
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

type Answer = {
  title: string
  summary: string
  items: string[]
}

type StateChangeRow = {
  entity_type: 'task' | 'event' | 'grocery' | 'meal'
  entity_id: string
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors })
}

function publicFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (
    /aegis_sync_status|sharing_scope|capture_plan|apply_capture_plan|record_capture_apply_failure/i.test(message)
    || /column .* does not exist|relation .* does not exist|function .* does not exist/i.test(message)
  ) {
    return 'Pepper could not save that update because the beta service needs maintenance. No changes were made.'
  }
  return message || 'Pepper could not interpret that update.'
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

function dateDistance(from: string, to: string) {
  const fromParts = from.split('-').map(Number)
  const toParts = to.split('-').map(Number)
  const fromTime = Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2])
  const toTime = Date.UTC(toParts[0], toParts[1] - 1, toParts[2])
  return Math.round((toTime - fromTime) / 86_400_000)
}

function answerDateLabel(date: string, label: string) {
  if (label === 'today' || label === 'tomorrow') return label
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function memberForSlug(members: FamilyMemberRow[], slug: string | null) {
  if (!slug) return null
  return members.find((candidate) => candidate.slug === slug) || null
}

async function answerQuestion(m: Member, query: PepperQuestionIntent): Promise<Answer> {
  const members = await sql<FamilyMemberRow[]>`
    select id,slug,display_name
    from public.household_members
    where household_id=${m.household_id}::uuid
  `
  const subject = 'personSlug' in query ? memberForSlug(members, query.personSlug) : null
  const memberLabel = subject?.display_name || m.display_name

  if (query.type === 'meal') {
    const rows = await sql<{ meal_name: string; eat_at: string | null; owner_name: string | null }[]>`
      select mp.meal_name,mp.eat_at,owner.display_name as owner_name
      from public.meal_plan mp
      left join public.household_members owner on owner.id=mp.owner_member_id
      where mp.household_id=${m.household_id}::uuid and mp.meal_date=${query.date}::date
      limit 1
    `
    const label = answerDateLabel(query.date, query.dateLabel)
    if (!rows[0]) {
      return { title: `Dinner ${label}`, summary: `Dinner is not planned for ${label} yet.`, items: [] }
    }
    const meal = rows[0]
    const details = [meal.eat_at ? formatTime(meal.eat_at) : null, meal.owner_name ? `${meal.owner_name} is handling it` : null]
      .filter(Boolean)
      .join(' · ')
    return {
      title: `Dinner ${label}`,
      summary: meal.meal_name,
      items: details ? [details] : [],
    }
  }

  if (query.type === 'health') {
    const rows = await sql<{ metric_date: string; step_count: number | null; active_minutes: number | null }[]>`
      select metric_date::text,step_count,active_minutes
      from public.health_daily_metrics
      where household_id=${m.household_id}::uuid and member_id=${m.id}::uuid
      order by metric_date desc,source_updated_at desc
      limit 1
    `
    if (!rows[0]) {
      return {
        title: 'Your health',
        summary: 'Apple Health has not reported any totals to Pepper yet.',
        items: [],
      }
    }
    const latest = rows[0]
    return {
      title: 'Your health',
      summary: `${(latest.step_count || 0).toLocaleString('en-US')} steps`,
      items: [`${latest.active_minutes || 0} active minutes · ${latest.metric_date}`],
    }
  }

  if (query.type === 'front_seat') {
    const rotations = await sql<{ id: string; anchor_date: string; participant_member_ids: string[] }[]>`
      select id,anchor_date::text,participant_member_ids
      from private.family_rotations
      where household_id=${m.household_id}::uuid and rotation_key='front-seat'
      limit 1
    `
    const rotation = rotations[0]
    const label = answerDateLabel(query.date, query.dateLabel)
    if (!rotation?.participant_member_ids?.length) {
      return { title: `Front seat ${label}`, summary: 'The front-seat rotation is not configured.', items: [] }
    }
    const overrides = await sql<{ assigned_member_id: string; status: string }[]>`
      select assigned_member_id,status
      from private.family_rotation_days
      where rotation_id=${rotation.id}::uuid and rotation_date=${query.date}::date
      limit 1
    `
    const offset = dateDistance(rotation.anchor_date, query.date)
    const scheduledId = rotation.participant_member_ids[
      ((offset % rotation.participant_member_ids.length) + rotation.participant_member_ids.length)
        % rotation.participant_member_ids.length
    ]
    const assignedId = overrides[0]?.assigned_member_id || scheduledId
    const assigned = members.find((candidate) => candidate.id === assignedId)
    return {
      title: `Front seat ${label}`,
      summary: assigned ? `${assigned.display_name} has the front seat.` : 'Pepper could not identify today’s rider.',
      items: overrides[0]?.status === 'confirmed' ? ['Confirmed'] : ['Regular rotation'],
    }
  }

  if (query.type === 'schedule' || query.type === 'ride') {
    const [start, end] = dayBounds(query.date)
    const rows = subject
      ? await sql<{
        title: string
        starts_at: string
        location: string | null
        person_slug: string | null
        transport_status: string | null
        driver_name: string | null
      }[]>`
        select e.title,e.starts_at,e.location,e.person_slug,e.transport_status,driver.display_name as driver_name
        from public.events e
        left join public.household_members driver on driver.id=e.transport_owner_member_id
        where e.household_id=${m.household_id}::uuid
          and e.deleted_at is null and e.status<>'canceled'
          and e.starts_at>=${start}::timestamptz and e.starts_at<${end}::timestamptz
          and (e.person_slug=${subject.slug} or e.owner_member_id=${subject.id}::uuid)
          and (e.visibility='household' or e.owner_member_id=${m.id}::uuid or e.person_slug=${m.slug})
          ${query.type === 'ride' ? sql`and (e.transport_status is not null or e.transport_owner_member_id is not null)` : sql``}
        order by e.starts_at
        limit 12
      `
      : await sql<{
        title: string
        starts_at: string
        location: string | null
        person_slug: string | null
        transport_status: string | null
        driver_name: string | null
      }[]>`
        select e.title,e.starts_at,e.location,e.person_slug,e.transport_status,driver.display_name as driver_name
        from public.events e
        left join public.household_members driver on driver.id=e.transport_owner_member_id
        where e.household_id=${m.household_id}::uuid
          and e.deleted_at is null and e.status<>'canceled'
          and e.starts_at>=${start}::timestamptz and e.starts_at<${end}::timestamptz
          and (e.visibility='household' or e.owner_member_id=${m.id}::uuid or e.person_slug=${m.slug})
          ${query.type === 'ride' ? sql`and (e.transport_status is not null or e.transport_owner_member_id is not null)` : sql``}
        order by e.starts_at
        limit 12
      `
    const label = answerDateLabel(query.date, query.dateLabel)
    const scope = subject ? `${subject.display_name} ${label}` : `The family ${label}`
    if (!rows.length) {
      return {
        title: query.type === 'ride' ? `Rides ${label}` : scope,
        summary: query.type === 'ride'
          ? `No rides are recorded for ${scope.toLowerCase()}.`
          : `No scheduled events are recorded for ${scope.toLowerCase()}.`,
        items: [],
      }
    }
    const items = rows.slice(0, 6).map((event) => {
      const eventTime = formatTime(event.starts_at)
      if (query.type === 'ride') {
        const driver = event.driver_name || 'Driver needed'
        return `${eventTime} · ${event.title} · ${driver}`
      }
      return `${eventTime} · ${event.title}${event.location ? ` · ${event.location}` : ''}`
    })
    if (rows.length > items.length) items.push(`And ${rows.length - items.length} more.`)
    return {
      title: query.type === 'ride' ? `Rides ${label}` : scope,
      summary: query.type === 'ride'
        ? `${rows.length} ${rows.length === 1 ? 'ride' : 'rides'} found.`
        : `${rows.length} ${rows.length === 1 ? 'event' : 'events'} found.`,
      items,
    }
  }

  if (query.type === 'chores' || query.type === 'tasks' || query.type === 'work') {
    const owner = subject || (query.type === 'tasks' || query.type === 'work' ? members.find((candidate) => candidate.id === m.id) || null : null)
    const rows = await sql<{ title: string; due_at: string | null; priority: string | null; owner_name: string | null }[]>`
      select t.title,t.due_at,t.priority,owner.display_name as owner_name
      from public.tasks t
      left join public.household_members owner on owner.id=t.owner_member_id
      where t.household_id=${m.household_id}::uuid
        and t.deleted_at is null and t.status in ('open','in_progress','on_hold')
        and (t.visibility='household' or t.owner_member_id=${m.id}::uuid or t.creator_member_id=${m.id}::uuid)
        ${owner ? sql`and t.owner_member_id=${owner.id}::uuid` : sql``}
        ${query.type === 'chores'
          ? sql`and (lower(coalesce(t.area,''))='chores' or exists(select 1 from unnest(coalesce(t.tags,'{}'::text[])) tag where lower(tag) in ('chore','chores')))`
          : query.type === 'work'
            ? sql`and lower(coalesce(t.area,''))='work'`
            : sql`and not (lower(coalesce(t.area,''))='chores' or exists(select 1 from unnest(coalesce(t.tags,'{}'::text[])) tag where lower(tag) in ('chore','chores')))`}
      order by case upper(coalesce(t.priority,'')) when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 else 4 end,
        t.due_at nulls last,t.updated_at desc
      limit 12
    `
    const title = query.type === 'work'
      ? 'Your work priorities'
      : query.type === 'chores'
        ? `${subject?.display_name || 'Family'} chores`
        : `${memberLabel} tasks`
    if (!rows.length) return { title, summary: `No open ${query.type === 'work' ? 'work tasks' : query.type} found.`, items: [] }
    const items = rows.slice(0, 6).map((task) => {
      const ownerName = !owner && task.owner_name ? ` · ${task.owner_name}` : ''
      const priority = query.type === 'work' && task.priority ? `${task.priority} · ` : ''
      const due = task.due_at ? ` · due ${new Date(task.due_at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })}` : ''
      return `${priority}${task.title}${ownerName}${due}`
    })
    if (rows.length > items.length) items.push(`And ${rows.length - items.length} more.`)
    return { title, summary: `${rows.length} open ${rows.length === 1 ? 'item' : 'items'}.`, items }
  }

  return {
    title: 'Pepper cannot verify that yet',
    summary: 'I could not answer that from the family plan, and I did not add it to your Inbox.',
    items: [],
  }
}

function answeredQuestionResponse(answer: Answer) {
  return {
    status: 'answered',
    mode: 'answer',
    reply: answer.summary,
    answer,
    applied_changes: [],
  }
}

function stateText(state: Record<string, unknown> | null, key: string) {
  const value = state?.[key]
  return value == null ? null : String(value)
}

async function undoCapture(m: Member, captureId: string) {
  return sql.begin(async (tx) => {
    await tx`select pg_catalog.set_config('pepper.actor_member_id',${m.id}::text,true)`
    const captures = await tx<{ id: string; original_text: string }[]>`
      select id,original_text
      from public.captures
      where id=${captureId}::uuid
        and household_id=${m.household_id}::uuid
        and member_id=${m.id}::uuid
      for update
    `
    const capture = captures[0]
    if (!capture) throw Object.assign(new Error('That Pepper change is not available to undo.'), { status: 404 })

    const priorUndo = await tx<{ exists: boolean }[]>`
      select true as exists
      from public.audit_log
      where capture_id=${captureId}::uuid and event_type='capture_undone'
      limit 1
    `
    if (priorUndo[0]) {
      return {
        status: 'undone', mode: 'action', reply: 'That change was already undone.',
        applied_changes: [], undoable: false, idempotent_replay: true,
      }
    }

    const changes = await tx<StateChangeRow[]>`
      select entity_type,entity_id,
        (jsonb_agg(before_state order by id asc)->0) as before_state,
        (jsonb_agg(after_state order by id desc)->0) as after_state
      from public.state_changes
      where capture_id=${captureId}::uuid
        and household_id=${m.household_id}::uuid
        and entity_type in ('task','event','grocery','meal')
      group by entity_type,entity_id
      order by max(id) desc
    `
    if (!changes.length) {
      throw Object.assign(new Error('This Pepper response did not create a reversible change.'), { status: 409 })
    }

    for (const change of changes) {
      if (!UUID.test(change.entity_id) || !change.after_state) {
        throw Object.assign(new Error('Pepper could not verify the original change.'), { status: 409 })
      }
      const expectedUpdatedAt = stateText(change.after_state, 'updated_at')
      if (!expectedUpdatedAt) {
        throw Object.assign(new Error('Pepper could not verify the original change time.'), { status: 409 })
      }
      let reversed: { id: string }[] = []

      if (change.entity_type === 'task') {
        reversed = change.before_state
          ? await tx<{ id: string }[]>`
              update public.tasks set
                title=${stateText(change.before_state, 'title')},
                owner_member_id=${stateText(change.before_state, 'owner_member_id')}::uuid,
                status=${stateText(change.before_state, 'status')},
                due_at=${stateText(change.before_state, 'due_at')}::timestamptz,
                visibility=${stateText(change.before_state, 'visibility')},
                source=${stateText(change.before_state, 'source')},
                completed_at=${stateText(change.before_state, 'completed_at')}::timestamptz,
                deleted_at=${stateText(change.before_state, 'deleted_at')}::timestamptz,
                deleted_by_member_id=${stateText(change.before_state, 'deleted_by_member_id')}::uuid,
                updated_at=now()
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and updated_at=${expectedUpdatedAt}::timestamptz
              returning id
            `
          : await tx<{ id: string }[]>`
              update public.tasks set status='canceled',deleted_at=now(),
                deleted_by_member_id=${m.id}::uuid,completed_at=null,updated_at=now()
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and deleted_at is null
                and updated_at=${expectedUpdatedAt}::timestamptz
              returning id
            `
      } else if (change.entity_type === 'event') {
        reversed = change.before_state
          ? await tx<{ id: string }[]>`
              update public.events set
                title=${stateText(change.before_state, 'title')},
                person_slug=${stateText(change.before_state, 'person_slug')},
                starts_at=${stateText(change.before_state, 'starts_at')}::timestamptz,
                ends_at=${stateText(change.before_state, 'ends_at')}::timestamptz,
                location=${stateText(change.before_state, 'location')},
                status=${stateText(change.before_state, 'status')},
                visibility=${stateText(change.before_state, 'visibility')},
                owner_member_id=${stateText(change.before_state, 'owner_member_id')}::uuid,
                kind=${stateText(change.before_state, 'kind')},
                transport_owner_member_id=${stateText(change.before_state, 'transport_owner_member_id')}::uuid,
                transport_status=${stateText(change.before_state, 'transport_status')},
                source=${stateText(change.before_state, 'source')},
                deleted_at=${stateText(change.before_state, 'deleted_at')}::timestamptz,
                deleted_by_member_id=${stateText(change.before_state, 'deleted_by_member_id')}::uuid,
                updated_at=now()
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and updated_at=${expectedUpdatedAt}::timestamptz
              returning id
            `
          : await tx<{ id: string }[]>`
              update public.events set status='canceled',canonical_status_override='canceled',
                deleted_at=now(),deleted_by_member_id=${m.id}::uuid,updated_at=now()
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and deleted_at is null
                and updated_at=${expectedUpdatedAt}::timestamptz
              returning id
            `
      } else if (change.entity_type === 'grocery') {
        reversed = change.before_state
          ? await tx<{ id: string }[]>`
              update public.groceries set
                item=${stateText(change.before_state, 'item')},
                status=${stateText(change.before_state, 'status')},
                owner_member_id=${stateText(change.before_state, 'owner_member_id')}::uuid,
                meal_plan_id=${stateText(change.before_state, 'meal_plan_id')}::uuid,
                completed_by_member_id=${stateText(change.before_state, 'completed_by_member_id')}::uuid,
                origin=coalesce(${stateText(change.before_state, 'origin')},'manual'),
                updated_at=now()
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and updated_at=${expectedUpdatedAt}::timestamptz
              returning id
            `
          : await tx<{ id: string }[]>`
              delete from public.groceries
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and updated_at=${expectedUpdatedAt}::timestamptz
              returning id
            `
      } else {
        reversed = change.before_state
          ? await tx<{ id: string }[]>`
              update public.meal_plan set
                meal_date=${stateText(change.before_state, 'meal_date')}::date,
                meal_name=${stateText(change.before_state, 'meal_name')},
                prep_at=${stateText(change.before_state, 'prep_at')}::timestamptz,
                eat_at=${stateText(change.before_state, 'eat_at')}::timestamptz,
                owner_member_id=${stateText(change.before_state, 'owner_member_id')}::uuid,
                shopping_owner_member_id=${stateText(change.before_state, 'shopping_owner_member_id')}::uuid,
                updated_at=now()
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and updated_at=${expectedUpdatedAt}::timestamptz
              returning id
            `
          : await tx<{ id: string }[]>`
              delete from public.meal_plan
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and updated_at=${expectedUpdatedAt}::timestamptz
              returning id
            `
      }

      if (!reversed[0]) {
        throw Object.assign(
          new Error('Someone changed this item after Pepper handled it, so Undo was stopped.'),
          { status: 409 },
        )
      }
    }

    await tx`
      insert into public.audit_log(
        household_id,actor_member_id,capture_id,event_type,entity_type,entity_id,summary
      ) values (
        ${m.household_id}::uuid,${m.id}::uuid,${captureId}::uuid,
        'capture_undone','capture',${captureId},${`Undid: ${capture.original_text.slice(0, 400)}`}
      )
    `
    return {
      status: 'undone', mode: 'action', reply: 'Undone. Pepper restored the previous family plan.',
      applied_changes: [], undoable: false,
    }
  })
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
          ${captureId}::uuid,${m.id}::uuid,${idempotencyKey},${sql.json(plan)}::jsonb
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

    if (intent.type === 'event.create') {
      const subject = intent.personSlug
        ? memberBySlug.get(intent.personSlug)
          || (intent.personSlug === 'danielle' && m.display_name.toLowerCase() === 'danielle' ? m : null)
        : null
      if (intent.personSlug && !subject) { ambiguities.push(fact); continue }
      const endsAt = new Date(new Date(intent.time).getTime() + 60 * 60 * 1000).toISOString()
      writes.push({
        operation: 'event.create', record_id: planRecordId(),
        title: intent.title, person_slug: subject?.slug || (intent.private ? m.slug : null),
        starts_at: intent.time, ends_at: endsAt,
        visibility: intent.private ? 'private' : 'household',
        owner_member_id: intent.private ? m.id : null,
        kind: /appointment/i.test(intent.title) ? 'appointment' : 'event', source: 'pepper',
        metadata: { type: 'event_created' },
      })
      messages.push(`${intent.title} added to the calendar at ${formatTime(intent.time)}.`)
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
      const namedOwner = intent.ownerSlug ? memberBySlug.get(intent.ownerSlug) : null
      if (intent.ownerSlug && !namedOwner) { ambiguities.push(fact); continue }
      if (namedOwner && !['adult_admin', 'adult'].includes(m.role) && namedOwner.id !== m.id) {
        ambiguities.push(fact)
        continue
      }
      const due = dueDateFrom(fact, today)
      const source = intent.category === 'task'
        ? 'pepper_capture'
        : `pepper_capture_${intent.category}`
      writes.push({
        operation: 'task.create', record_id: planRecordId(), title: intent.title,
        owner_member_id: intent.private ? m.id : namedOwner?.id || null,
        visibility: intent.private ? 'private' : 'household', status: 'open',
        due_at: due ? new Date(`${due.date}T17:00:00-07:00`).toISOString() : null,
        source, metadata: { type: 'task_created', category: intent.category },
      })
      if (intent.category === 'work') {
        messages.push(`Added “${intent.title}” to your Work tasks.`)
      } else if (intent.category === 'event_follow_up') {
        messages.push(`Added a private calendar follow-up because the event still needs a date and time.`)
      } else if (intent.category === 'need') {
        messages.push(`Added “${intent.title}” to ${intent.private ? 'your private needs' : 'the family plan'}.`)
      } else {
        messages.push(`Saved ${intent.private ? 'privately: ' : ''}${intent.title}.`)
      }
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

    if (action === 'undo') {
      const captureId = String(body.capture_id || '')
      if (!UUID.test(captureId)) return json({ error: 'A valid Pepper change is required.' }, 400)
      return json(await undoCapture(currentMember, captureId))
    }

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
          ${sql.json(reviewPlan)}::jsonb
        ) as result
      `
      return json(rows[0]?.result || { ok: false })
    }

    if (action === 'review_retry') {
      const captureId = String(body.capture_id || '')
      const idempotencyKey = String(body.idempotency_key || '').trim()
      if (!UUID.test(captureId) || !idempotencyKey) {
        return json({ error: 'Capture and idempotency key are required.' }, 400)
      }
      const captureRows = await sql<{ original_text: string; remaining_ambiguities: unknown }[]>`
        select original_text,remaining_ambiguities
        from public.captures
        where id=${captureId}::uuid
          and member_id=${currentMember.id}::uuid
          and status in ('needs_review','partially_applied')
        limit 1
      `
      if (!captureRows[0]) return json({ error: 'That review item is no longer waiting.' }, 404)
      const remaining = Array.isArray(captureRows[0].remaining_ambiguities)
        ? captureRows[0].remaining_ambiguities.filter((value): value is string => typeof value === 'string')
        : []
      const clarificationText = String(body.clarification_text || '').trim()
      const unresolvedText = remaining.length ? remaining.join('. ') : captureRows[0].original_text
      const retryText = clarificationText
        ? `${unresolvedText.replace(/[?.!]+$/u, '')} ${clarificationText}`
        : unresolvedText
      const retryQuestion = questionIntent(retryText)
      if (retryQuestion) {
        const answer = await answerQuestion(currentMember, retryQuestion)
        const reviewPlan = {
          version: 1,
          kind: 'review_resolution',
          outcome: 'applied',
          resolution: 'no_change_required',
          safe_subset_declared: false,
          extracted_facts: [retryText],
          remaining_ambiguities: [],
          writes: [],
        }
        await sql`
          select private.resolve_capture_review(
            ${captureId}::uuid,${currentMember.id}::uuid,${idempotencyKey.slice(0, 200)},
            ${sql.json(reviewPlan)}::jsonb
          )
        `
        return json({ ...answeredQuestionResponse(answer), captureId, capture_id: captureId })
      }
      const interpretation = await interpretCapture(currentMember, retryText)
      const plan = buildPlan(
        interpretation.facts,
        interpretation.writes,
        interpretation.ambiguities,
        'review_resolution',
      )
      const result = await applyPlan(captureId, currentMember, idempotencyKey.slice(0, 200), plan)
      const outcome = String(result?.status || plan.outcome)
      const appliedChanges = Array.isArray(result?.applied_changes) ? result.applied_changes : []
      const needsClarification = outcome === 'needs_review' || outcome === 'partially_applied'
      return json({
        status: outcome,
        mode: needsClarification ? 'clarification' : 'action',
        captureId,
        capture_id: captureId,
        reply: replyForPlan(outcome, interpretation.messages),
        applied_changes: appliedChanges,
        undoable: appliedChanges.length > 0,
        ...(needsClarification
          ? { clarification: clarificationFor(interpretation.ambiguities.join(' ') || retryText) }
          : {}),
      })
    }

    const text = String(body.text || '').trim()
    if (!text) return json({ error: 'Tell Pepper what changed first.' }, 400)
    if (text.length > 4000) return json({ error: 'That update is too long. Keep it under 4,000 characters.' }, 400)
    const question = questionIntent(text)
    if (question) return json(answeredQuestionResponse(await answerQuestion(currentMember, question)))
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
        const appliedChanges = Array.isArray(prior[0].result.applied_changes)
          ? prior[0].result.applied_changes
          : []
        return json({
          status: prior[0].result.status,
          mode: 'action',
          captureId: capture.id,
          capture_id: capture.id,
          reply: 'Done. Pepper already handled that update.',
          applied_changes: appliedChanges,
          undoable: appliedChanges.length > 0,
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
    const appliedChanges = Array.isArray(result?.applied_changes) ? result.applied_changes : []
    const needsClarification = outcome === 'needs_review' || outcome === 'partially_applied'
    return json({
      status: outcome,
      mode: needsClarification ? 'clarification' : 'action',
      captureId: capture.id,
      capture_id: capture.id,
      reply: replyForPlan(outcome, interpretation.messages),
      applied_changes: appliedChanges,
      undoable: appliedChanges.length > 0,
      ...(needsClarification
        ? { clarification: clarificationFor(interpretation.ambiguities.join(' ') || text) }
        : {}),
    })
  } catch (error) {
    console.error(error)
    const status = typeof (error as { status?: unknown })?.status === 'number'
      ? Number((error as { status: number }).status)
      : 500
    return json({ error: publicFailureMessage(error) }, status)
  }
})
