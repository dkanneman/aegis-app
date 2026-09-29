import postgres from 'npm:postgres@3.4.7'
import {
  buildPlan,
  ADULT_CALENDAR_REVIEW_REQUIRED,
  calendarProposalResponse,
  classifyPiece,
  coordinationTargets,
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
  reviewRetryText,
  splitCapture,
  isAppointmentPreparationPiece,
  type PepperQuestionIntent,
} from './logic.ts'
import {
  appointmentDedupeKey,
  appointmentEventId,
  parseAppointmentText,
  type ParsedAppointment,
} from '../_shared/appointment-intake.ts'
import {
  eventsOverlap,
  medicalCoordinationPriority,
  medicalCoordinationTaskTitle,
  type SchedulingEvent,
} from '../_shared/medical-scheduling.ts'
import {
  calendarMutationActionKey,
  calendarMutationKind,
  isAdultHouseholdRole,
} from '../_shared/calendar-contribution.ts'

const DATABASE_SSL = Deno.env.get('PEPPER_DB_SSL') === 'disable' ? false : 'require'
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
  ssl: DATABASE_SSL,
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
})
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
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
  session_id: string
  active: boolean
  removed_at: string | null
}

type EventRow = {
  id: string
  title: string
  person_slug: string | null
  starts_at: string
  ends_at: string | null
  kind: string
  source: string | null
  transport_owner_member_id: string | null
}

type FamilyMemberRow = {
  id: string
  slug: string
  display_name: string
  role: string
}

type AppointmentBridgeItem = {
  eventId: string
  dedupeKey: string
  title: string
  patientMemberId: string | null
  appointment: ParsedAppointment
}

type AppointmentEventRow = {
  id: string
  title: string
  person_slug: string | null
  starts_at: string
  appointment_type: ParsedAppointment['appointmentType'] | null
  clinician_name: string | null
  patient_member_id: string | null
  facility_name: string | null
  location: string | null
  preparation_instructions: string | null
  original_source_text: string | null
  source_timezone: string | null
  dedupe_key: string | null
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
  if (/appointment bridge failed/i.test(message)) {
    return 'The appointment was saved in Pepper, but calendar delivery is still pending. Retry the same update to resume synchronization.'
  }
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
    select m.id,m.household_id,m.slug,m.display_name,m.role,m.active,m.removed_at,s.session_id
    from public.member_sessions s
    join public.household_members m on m.id=s.member_id
    where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now()
      and m.active=true and m.removed_at is null
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
    select id,slug,display_name,role
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
  const committed = await sql.begin(async (tx) => {
    await tx`select pg_catalog.set_config('pepper.actor_member_id',${m.id}::text,true)`
    const captures = await tx<{ id: string; original_text: string }[]>`
      select id,original_text
      from public.captures
      where id=${captureId}::uuid
        and household_id=${m.household_id}::uuid
        and member_id=${m.id}::uuid
        and calendar_proposal is null
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

    const eventIds = changes.filter(change => change.entity_type === 'event').map(change => change.entity_id)
    if (priorUndo[0]) return { eventIds, replay: true }

    for (const change of changes) {
      if (!UUID.test(change.entity_id) || !change.after_state) {
        throw Object.assign(new Error('Pepper could not verify the original change.'), { status: 409 })
      }
      // Bind as text before the SQL cast: the driver's timestamp serializer
      // otherwise truncates PostgreSQL microseconds through a JavaScript Date.
      const expectedUpdatedAt = stateText(change.after_state, 'updated_at')
      const expectedRevision = change.entity_type === 'event'
        ? Number(change.after_state.revision)
        : null
      if (change.entity_type === 'event' && (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1)) {
        throw Object.assign(new Error('Pepper could not verify the original event revision.'), { status: 409 })
      }
      if (change.entity_type !== 'event' && !expectedUpdatedAt) {
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
                and updated_at=${expectedUpdatedAt}::text::timestamptz
              returning id
            `
          : await tx<{ id: string }[]>`
              update public.tasks set status='canceled',deleted_at=now(),
                deleted_by_member_id=${m.id}::uuid,completed_at=null,updated_at=now()
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and deleted_at is null
                and updated_at=${expectedUpdatedAt}::text::timestamptz
              returning id
            `
      } else if (change.entity_type === 'event') {
        const mutationAction = change.before_state ? 'update' : 'cancel'
        const actionKey = calendarMutationActionKey({
          eventId:change.entity_id,
          action:mutationAction,
          actorMemberId:m.id,
          sessionId:m.session_id,
          requestId:`undo:${captureId}:${change.entity_id}`,
        })
        const actionRows = await tx<{ id: string }[]>`
          select private.pepper_record_calendar_event_mutation(
            ${m.household_id}::uuid,${change.entity_id}::uuid,${m.id}::uuid,
            ${m.session_id}::uuid,${mutationAction},${actionKey},
            ${expectedRevision}::bigint,${expectedRevision}::bigint,${Number(expectedRevision)+1}::bigint,
            ${tx.json({capture_id:captureId,operation:'undo',record_id:change.entity_id})}::jsonb
          ) as id
        `
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
                last_modified_by_member_id=${m.id}::uuid,
                last_modified_session_id=${m.session_id}::uuid,
                last_calendar_action_id=${actionRows[0].id}::uuid,
                sync_status='pending',
                revision=revision+1,
                updated_at=now()
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and revision=${expectedRevision}::bigint
              returning id
            `
          : await tx<{ id: string }[]>`
              update public.events set status='canceled',canonical_status_override='canceled',
                deleted_by_member_id=${m.id}::uuid,
                last_modified_by_member_id=${m.id}::uuid,
                last_modified_session_id=${m.session_id}::uuid,
                last_calendar_action_id=${actionRows[0].id}::uuid,
                sync_status='pending',
                revision=revision+1,updated_at=now()
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and deleted_at is null
                and revision=${expectedRevision}::bigint
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
                and updated_at=${expectedUpdatedAt}::text::timestamptz
              returning id
            `
          : await tx<{ id: string }[]>`
              delete from public.groceries
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and updated_at=${expectedUpdatedAt}::text::timestamptz
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
                and updated_at=${expectedUpdatedAt}::text::timestamptz
              returning id
            `
          : await tx<{ id: string }[]>`
              delete from public.meal_plan
              where id=${change.entity_id}::uuid
                and household_id=${m.household_id}::uuid
                and updated_at=${expectedUpdatedAt}::text::timestamptz
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
    return { eventIds, replay: false }
  })
  const deliveries: Array<Record<string, unknown>> = []
  for (const eventId of committed.eventIds) {
    // Retry only this capture's reversal, never a newer user's mutation.
    const rows = await sql<Array<{ sync_status: string; visibility: string }>>`
      select e.sync_status,e.visibility from public.events e
      join private.calendar_event_mutation_requests mutation on mutation.id=e.last_calendar_action_id
      where e.id=${eventId}::uuid and e.household_id=${m.household_id}::uuid
        and mutation.actor_member_id=${m.id}::uuid and mutation.after_revision=e.revision
        and mutation.action_key like ${`%:undo:${captureId}:${eventId}`}
    `
    if (!rows[0]) throw Object.assign(new Error('This event changed after Undo. Refresh before retrying.'), {status:409})
    if (rows[0].visibility !== 'household') continue
    if (committed.replay && rows[0].sync_status === 'synced') {
      deliveries.push({ok:true,status:'synced',event_id:eventId}); continue
    }
    try { deliveries.push(await invokeCalendarPublisher(captureId,eventId)) }
    catch {
      await sql`update public.events set sync_status='retry_required',last_sync_error='Undo saved in Pepper; Calendar cancellation needs a retry.',sync_retry_at=now()+interval '15 minutes' where id=${eventId}::uuid and household_id=${m.household_id}::uuid`
      deliveries.push({ok:false,status:'retry_required',event_id:eventId})
    }
  }
  const complete = deliveries.every(delivery => delivery.ok === true && delivery.status === 'synced')
  return {
    status:complete?'undone':'retry_required',mode:'action',local_reversal_confirmed:true,
    reply:complete?'Undone. Pepper restored the previous family plan.':'Undone in Pepper. Google Calendar reversal is pending or needs a retry.',
    applied_changes:[],undoable:!complete,idempotent_replay:committed.replay,
    delivery_complete:complete,calendar_delivery:deliveries,
  }
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

async function invokeAppointmentBridge(captureId: string, item: AppointmentBridgeItem) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Appointment bridge service credentials are not configured.')
  }
  const response = await fetch(`${SUPABASE_URL}/functions/v1/aegis-bridge-worker`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action: 'appointment.sync',
      capture_id: captureId,
      event_id: item.eventId,
      dedupe_key: item.dedupeKey,
      normalized_appointment: {
        event_id: item.eventId,
        title: item.title,
        starts_at: item.appointment.startsAt,
        timezone: item.appointment.timeZone,
        appointment_type: item.appointment.appointmentType,
        clinician: item.appointment.clinician,
        patient_member_id: item.patientMemberId,
        patient_slug: item.appointment.patientSlug,
        facility: item.appointment.facility,
        location: item.appointment.location,
        preparation_instructions: item.appointment.preparationInstructions,
        original_source_text: item.appointment.originalText,
        date_source: item.appointment.dateSource,
        time_source: item.appointment.timeSource,
        timezone_source: item.appointment.timezoneSource,
        scheduling_priority: 100,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const responseText = await response.text()
  if (!response.ok) {
    let detail = responseText
    try { detail = String(JSON.parse(responseText)?.error || responseText) } catch { /* use response text */ }
    throw new Error(`Appointment bridge failed: ${detail.slice(0, 300)}`)
  }
  return responseText ? JSON.parse(responseText) : { ok: true }
}

async function syncAppointmentBridges(
  captureId: string,
  member: Member,
  appointments: AppointmentBridgeItem[],
) {
  if (!appointments.length) return []
  await sql.begin(async (transaction) => {
    for (const item of appointments) {
      const appointment = item.appointment
      await transaction`
        update public.events set
          appointment_type=${appointment.appointmentType},
          clinician_name=${appointment.clinician},
          patient_member_id=${item.patientMemberId}::uuid,
          facility_name=${appointment.facility},
          location=coalesce(${appointment.location},location),
          preparation_instructions=${appointment.preparationInstructions},
          original_source_text=${appointment.originalText},
          source_timezone=${appointment.timeZone},
          scheduling_priority=100,
          dedupe_key=${item.dedupeKey},
          sync_status='pending',
          updated_at=now()
        where id=${item.eventId}::uuid and household_id=${member.household_id}::uuid
      `
    }
    await transaction`
      update public.captures set
        aegis_sync_status='captured',aegis_synced_at=null,aegis_sync_error=null,
        aegis_last_attempt_at=now(),updated_at=now()
      where id=${captureId}::uuid and household_id=${member.household_id}::uuid
    `
  })

  try {
    return await Promise.all(appointments.map((item) => invokeAppointmentBridge(captureId, item)))
  } catch (error) {
    await sql`
      update public.captures set
        aegis_sync_status='failed',aegis_sync_error=${String((error as Error).message).slice(0, 500)},
        aegis_last_attempt_at=now(),updated_at=now()
      where id=${captureId}::uuid and household_id=${member.household_id}::uuid
    `
    throw error
  }
}

function appointmentDeliverySummary(results: Array<Record<string, unknown>>) {
  if (!results.length) return {}
  const complete = results.every((result) => result.delivery_state === 'synced' && result.ok === true)
  return {
    delivery_complete: complete,
    delivery_notice: complete
      ? 'Pepper, Google Calendar, and AEGIS are synchronized.'
      : 'Saved in Pepper. Google Calendar or AEGIS delivery still needs attention.',
  }
}

type AppliedEventChange = {
  operation: string
  entity_type: 'event'
  record_id: string
}

function appliedEventChanges(appliedChanges: unknown[]): AppliedEventChange[] {
  return appliedChanges.filter((change): change is AppliedEventChange => (
    Boolean(change)
    && typeof change === 'object'
    && (change as Record<string, unknown>).entity_type === 'event'
    && typeof (change as Record<string, unknown>).operation === 'string'
    && UUID.test(String((change as Record<string, unknown>).record_id || ''))
  ))
}

function requireAdultCalendarReview(member: Member, interpretation: Awaited<ReturnType<typeof interpretCapture>>) {
  if (isAdultHouseholdRole(member.role)) return interpretation
  const eventWrites = interpretation.writes.filter((write) => String(write.operation || '').startsWith('event.'))
  if (!eventWrites.length) return interpretation
  return {
    ...interpretation,
    writes: [],
    appointments: [],
    ambiguities: [
      ...interpretation.ambiguities,
      ADULT_CALENDAR_REVIEW_REQUIRED,
    ],
    messages: [
      'I saved this as a proposal for a family adult to review.',
    ],
  }
}

async function saveCalendarProposal(captureId: string, actor: Member, interpretation: Awaited<ReturnType<typeof interpretCapture>>) {
  if (!['child', 'teen'].includes(actor.role) || !interpretation.writes.some(w => String(w.operation).startsWith('event.'))) return
  const revisions: Record<string, number> = {}
  const preview: Record<string, unknown>[] = []
  for (const write of interpretation.writes.filter(w => w.operation === 'event.create')) preview.push({ ...write, visibility:'household' })
  for (const write of interpretation.writes.filter(w => w.operation === 'event.update')) {
    const rows = await sql<Array<{ revision: number; title: string; starts_at: string; ends_at: string; location: string }>>`select revision,title,starts_at,ends_at,location from public.events
      where id=${String(write.record_id)}::uuid and household_id=${actor.household_id}::uuid and visibility='household'`
    if (!rows[0]) throw Object.assign(new Error('The proposed event is not shared with this household.'), { status: 403 })
    revisions[String(write.record_id)] = Number(rows[0].revision)
    preview.push({ ...rows[0], ...write })
  }
  const proposal = {
    // A child/teen Calendar proposal is explicitly a shared-household request. The
    // parent sees this scope before approving; private existing events stay denied.
    plan: buildPlan(interpretation.facts, interpretation.writes.map(write => write.operation === 'event.create'
      ? { ...write, visibility: 'household' } : write), interpretation.ambiguities, 'review_resolution'),
    appointments: interpretation.appointments, revisions, preview,
  }
  await sql`update public.captures set calendar_proposal=${sql.json(proposal)}::jsonb,
    proposal_decision='pending',sharing_scope='household'
    where id=${captureId}::uuid and member_id=${actor.id}::uuid and calendar_proposal is null`
}

async function decideCalendarProposal(actor: Member, captureId: string, decision: string) {
  if (!isAdultHouseholdRole(actor.role)) throw Object.assign(new Error('Only an active family adult can review this proposal.'), { status: 403 })
  const committed = await sql.begin(async tx => {
    const active = await tx`select m.id from public.household_members m join public.member_sessions s on s.member_id=m.id
      where m.id=${actor.id}::uuid and m.household_id=${actor.household_id}::uuid and m.active and m.removed_at is null
        and m.role in ('adult','adult_admin') and s.session_id=${actor.session_id}::uuid and s.revoked_at is null and s.expires_at>now()
      for share of m,s`
    if (!active.length) throw Object.assign(new Error('Unlock Pepper again to continue.'), { status: 401 })
    const rows = await tx<Array<{ calendar_proposal: { plan: ReturnType<typeof buildPlan>; appointments: AppointmentBridgeItem[]; revisions: Record<string, number> }; proposal_decision: string; applied_changes: unknown[] }>>`
      select c.calendar_proposal,c.proposal_decision,c.applied_changes from public.captures c
      join public.household_members child on child.id=c.member_id and child.household_id=c.household_id and child.role in ('child','teen')
      where c.id=${captureId}::uuid and c.household_id=${actor.household_id}::uuid
        and c.sharing_scope='household' and c.calendar_proposal is not null for update of c`
    const capture = rows[0]
    if (!capture) throw Object.assign(new Error('Proposal not found.'), { status: 404 })
    if (capture.proposal_decision !== 'pending') {
      if (capture.proposal_decision !== decision) throw Object.assign(new Error('This proposal already has a different decision. Refresh the Inbox.'), { status: 409 })
      return { decision, applied: capture.applied_changes || [], events: [], replay: true }
    }
    if (decision === 'declined') {
      await tx`update public.captures set proposal_decision='declined',status='dismissed',aegis_sync_status='not_applicable',
        reconciled_by_member_id=${actor.id}::uuid,reconciled_at=now(),updated_at=now() where id=${captureId}::uuid`
      await tx`insert into public.audit_log(household_id,actor_member_id,capture_id,event_type,entity_type,entity_id,summary)
        values(${actor.household_id}::uuid,${actor.id}::uuid,${captureId}::uuid,'proposal_declined','capture',${captureId},'Adult declined the minor calendar proposal. No calendar change.')`
      return { decision, applied: [], events: [], replay: false }
    }
    const { plan, revisions } = capture.calendar_proposal
    if (plan.outcome !== 'applied') throw Object.assign(new Error('This proposal has unresolved details and cannot safely be approved.'), { status: 422 })
    for (const [id, revision] of Object.entries(revisions)) {
      const events = await tx<{ revision: number }[]>`select revision from public.events where id=${id}::uuid
        and household_id=${actor.household_id}::uuid and visibility='household' and deleted_at is null for update`
      if (Number(events[0]?.revision) !== revision) throw Object.assign(new Error('The event changed since this proposal. Decline it and request an updated proposal.'), { status: 409 })
    }
    const result = await tx<{ result: { applied_changes: unknown[] } }[]>`select private.resolve_capture_review(
      ${captureId}::uuid,${actor.id}::uuid,${`proposal:${captureId}`},${tx.json(plan)}::jsonb) as result`
    const applied = result[0].result.applied_changes
    const events = await recordAppliedCalendarMutations(captureId, actor, applied, tx)
    await tx`update public.captures set proposal_decision='approved',updated_at=now() where id=${captureId}::uuid`
    await tx`insert into public.audit_log(household_id,actor_member_id,capture_id,event_type,entity_type,entity_id,summary)
      values(${actor.household_id}::uuid,${actor.id}::uuid,${captureId}::uuid,'proposal_approved','capture',${captureId},'Adult approved the minor calendar proposal; external delivery is separate.')`
    return { decision, applied, events, replay: false }
  })
  // Canonical decision and attribution commit before external delivery. Replay reads
  // current delivery state, never re-applies writes or attributes a second decision.
  if (!committed.replay && decision === 'approved') {
    await syncSharedCalendarEvents(captureId, committed.events)
    const saved = await sql<{ calendar_proposal: { appointments: AppointmentBridgeItem[] } }[]>`select calendar_proposal from public.captures where id=${captureId}::uuid`
    const appointments = mergeAppointmentBridgeItems(saved[0].calendar_proposal.appointments, await appointmentItemsForReplay(actor, committed.applied))
    try { await syncAppointmentBridges(captureId, actor, appointments) } catch { /* persisted retry state; approval remains committed */ }
  }
  const ids = appliedEventChanges(committed.applied).map(c => c.record_id)
  const states = ids.length ? await sql<Array<{ id: string; sync_status: string }>>`select id,sync_status from public.events
    where household_id=${actor.household_id}::uuid and id=any(${ids}::uuid[])` : []
  const complete = decision === 'approved' && states.length === ids.length && states.length > 0 && states.every(e => e.sync_status === 'synced')
  return { ok: true, capture_id: captureId, proposal_decision: decision, status: decision === 'declined' ? 'dismissed' : 'applied',
    mode: 'review', undoable: false, delivery_complete: complete,
    reply: decision === 'declined' ? 'Proposal declined. No calendar event was changed.'
      : complete ? 'Proposal approved. The calendar change is synchronized.' : 'Proposal approved and saved in Pepper. Calendar delivery is pending or needs attention.',
    idempotent_replay: committed.replay }
}

async function recordAppliedCalendarMutations(
  captureId: string,
  member: Member,
  appliedChanges: unknown[],
  existingTransaction?: postgres.TransactionSql,
) {
  const changes = appliedEventChanges(appliedChanges)
  if (!changes.length) return []
  if (!isAdultHouseholdRole(member.role)) throw Object.assign(new Error('Only an active family adult can change the shared Calendar.'),{status:403})

  const record = async (transaction: postgres.TransactionSql) => {
    const recorded: Array<Record<string, unknown>> = []
    for (const [index, change] of changes.entries()) {
      const action = calendarMutationKind(change.operation)
      const actionKey = calendarMutationActionKey({
        eventId: change.record_id,
        action,
        actorMemberId: member.id,
        sessionId: member.session_id,
        requestId: `${captureId}:${index}`,
      })
      const prior = await transaction<Array<{ id: string }>>`
        select id from private.calendar_event_mutation_requests where action_key=${actionKey} limit 1
      `
      if (prior[0]) {
        const replay = await transaction<Array<Record<string, unknown>>>`
          select id,household_id,visibility,appointment_type,external_event_id,status,last_calendar_action_id,revision
          from public.events where id=${change.record_id}::uuid and household_id=${member.household_id}::uuid
        `
        if (replay[0]) recorded.push(replay[0])
        continue
      }

      const beforeRows = await transaction<Array<Record<string, unknown>>>`
        select id,household_id,visibility,appointment_type,external_event_id,status,
          created_by_member_id,last_modified_by_member_id,revision
        from public.events
        where id=${change.record_id}::uuid and household_id=${member.household_id}::uuid
        for update
      `
      const before = beforeRows[0]
      if (!before) throw Object.assign(new Error('The shared event is not in this household.'),{status:403})
      const beforeRevision = Number(before.revision || 1)
      const afterRevision = action === 'create' ? beforeRevision : beforeRevision + 1
      const actionRows = await transaction<Array<{ id: string }>>`
        select private.pepper_record_calendar_event_mutation(
          ${member.household_id}::uuid,${change.record_id}::uuid,${member.id}::uuid,
          ${member.session_id}::uuid,${action},${actionKey},
          ${beforeRevision}::bigint,${beforeRevision}::bigint,${afterRevision}::bigint,
          ${transaction.json({capture_id:captureId,operation:change.operation,record_id:change.record_id})}::jsonb
        ) as id
      `
      const afterRows = await transaction<Array<Record<string, unknown>>>`
        update public.events set
          created_by_member_id=coalesce(created_by_member_id,${member.id}::uuid),
          last_modified_by_member_id=${member.id}::uuid,
          last_modified_session_id=${member.session_id}::uuid,
          last_calendar_action_id=${actionRows[0].id}::uuid,
          revision=${afterRevision}::bigint
        where id=${change.record_id}::uuid
          and household_id=${member.household_id}::uuid
          and revision=${beforeRevision}::bigint
        returning id,household_id,visibility,appointment_type,external_event_id,status,revision,last_calendar_action_id
      `
      const after = afterRows[0]
      if (!after) throw Object.assign(new Error('That event changed somewhere else. Refresh before changing it again.'),{status:409})
      recorded.push(after)
    }
    return recorded
  }
  return existingTransaction ? record(existingTransaction) : sql.begin(record)
}

async function invokeCalendarPublisher(captureId: string, eventId: string) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Calendar publisher credentials are not configured.')
  const response = await fetch(`${SUPABASE_URL}/functions/v1/pepper-calendar`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'publish_event', capture_id: captureId, event_id: eventId }),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = {} }
  if (!response.ok) throw Object.assign(new Error(String(data.error || 'Calendar delivery failed.')),{status:response.status})
  return data
}

async function syncSharedCalendarEvents(captureId: string, recordedEvents: Array<Record<string, unknown>>) {
  const shared = recordedEvents.filter((event) => (
    event.visibility === 'household'
    && !event.appointment_type
    && String(event.status || '') !== 'completed'
  ))
  if (!shared.length) return []
  return Promise.all(shared.map(async event => {
    try { return await invokeCalendarPublisher(captureId, String(event.id)) }
    catch {
      const reason = 'Saved in Pepper. Shared Calendar delivery failed and needs a retry.'
      await sql`update public.events set sync_status='retry_required',last_sync_error=${reason},
        sync_retry_at=now()+interval '15 minutes',updated_at=now()
        where id=${String(event.id)}::uuid and household_id=${String(event.household_id)}::uuid`
      return { ok: false, status: 'retry_required', event_id: event.id, retryable: true, error: reason }
    }
  }))
}

function sharedCalendarDeliverySummary(results: Array<Record<string, unknown>>) {
  if (!results.length) return {}
  const complete = results.every((result) => result.ok === true && result.status === 'synced')
  return {
    shared_calendar_delivery: results,
    shared_calendar_complete: complete,
    shared_calendar_notice: complete
      ? 'The shared Pepper Calendar is synchronized.'
      : 'Saved in Pepper. Shared Calendar delivery still needs attention.',
  }
}

function localDateForInstant(startsAt: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(startsAt))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function appointmentItemsForReplay(
  member: Member,
  appliedChanges: unknown[],
): Promise<AppointmentBridgeItem[]> {
  const appointmentRefs = appliedChanges.filter((change): change is Record<string, unknown> => (
    Boolean(change)
    && typeof change === 'object'
    && (change as Record<string, unknown>).entity_type === 'event'
    && UUID.test(String((change as Record<string, unknown>).record_id || ''))
  ))
  const items: AppointmentBridgeItem[] = []
  for (const change of appointmentRefs) {
    const eventId = String(change.record_id)
    const rows = await sql<AppointmentEventRow[]>`
      select id,title,person_slug,starts_at,appointment_type,clinician_name,
        patient_member_id,facility_name,location,preparation_instructions,
        original_source_text,source_timezone,dedupe_key
      from public.events
      where id=${eventId}::uuid
        and household_id=${member.household_id}::uuid
        and deleted_at is null
      limit 1
    `
    const event = rows[0]
    if (!event?.original_source_text || !event.dedupe_key || !event.appointment_type) continue
    const timeZone = event.source_timezone || 'America/Los_Angeles'
    const parsed = parseAppointmentText(event.original_source_text, {
      today: localDateForInstant(event.starts_at, timeZone),
      timeZone,
    })
    if (parsed.status !== 'parsed' || !parsed.startsAt) {
      throw new Error(`Appointment bridge retry needs review: ${parsed.unresolvedFields.join('; ')}`)
    }
    items.push({
      eventId: event.id,
      dedupeKey: event.dedupe_key,
      title: event.title,
      patientMemberId: event.patient_member_id,
      appointment: {
        ...parsed,
        startsAt: event.starts_at,
        localDate: localDateForInstant(event.starts_at, timeZone),
        appointmentType: event.appointment_type,
        clinician: event.clinician_name || parsed.clinician,
        patientSlug: event.person_slug || parsed.patientSlug,
        facility: event.facility_name || parsed.facility,
        location: event.location || parsed.location,
        preparationInstructions: event.preparation_instructions || parsed.preparationInstructions,
        originalText: event.original_source_text,
      },
    })
  }
  return items
}

function mergeAppointmentBridgeItems(...groups: AppointmentBridgeItem[][]) {
  const byEvent = new Map<string, AppointmentBridgeItem>()
  for (const item of groups.flat()) byEvent.set(item.eventId, item)
  return [...byEvent.values()]
}

async function interpretCapture(m: Member, text: string) {
  const today = localDate()
  const [dayStart, dayEnd] = dayBounds(today)
  const [memberRows, eventRows, mealRows] = await Promise.all([
    sql<{ id: string; slug: string; display_name: string; role: string }[]>`
      select id,slug,display_name,role from public.household_members
      where household_id=${m.household_id}::uuid
        and active=true and removed_at is null
    `,
    sql<EventRow[]>`
      select id,title,person_slug,starts_at,ends_at,kind,source,transport_owner_member_id
      from public.events
      where household_id=${m.household_id}::uuid
        and starts_at>=${dayStart}::timestamptz
        and starts_at<${dayEnd}::timestamptz
        and status not in ('canceled','completed') and deleted_at is null
        and (visibility='household' or owner_member_id=${m.id}::uuid)
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
  const appointments: AppointmentBridgeItem[] = []
  if (isComplexTrainingPlan(text)) {
    const facts = splitCapture(text)
    return { facts, writes, messages, ambiguities: facts, appointments }
  }
  const delegated = delegatedIntent(text)

  if (delegated) {
    const subject = memberBySlug.get(delegated.subjectSlug)
    if (!subject) return { facts: [text], writes, messages, ambiguities: [text], appointments }
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
    return { facts: [text], writes, messages, ambiguities, appointments }
  }

  const facts = splitCapture(text)
  const classifiedFacts = facts.map((fact) => ({ fact, intent: classifyPiece(fact, today, familyMembers) }))
  const hasAppointment = classifiedFacts.some(({ intent }) => (
    intent.type === 'event.create' && Boolean(intent.appointment)
  ))
  for (const { fact, intent } of classifiedFacts) {
    if (hasAppointment && intent.type === 'task' && isAppointmentPreparationPiece(fact)) continue

    if (intent.type === 'event.cancel') {
      const matches = coordinationTargets(todayEvents, intent, fact, today)
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
      const matches = coordinationTargets(todayEvents, intent, fact, today)
      if (!driver || matches.length === 0) { ambiguities.push(fact); continue }
      for (const event of matches) {
        writes.push({
          operation: 'event.update', record_id: event.id,
          transport_owner_member_id: driver.id, transport_status: 'assigned',
          metadata: { type: 'driver_assigned' },
          audit_event_type: 'driver_assigned',
          audit_summary: `${driver.display_name} assigned to ${intent.personSlug}.`,
        })
      }
      const person = intent.personSlug.charAt(0).toUpperCase() + intent.personSlug.slice(1)
      messages.push(`${driver.display_name} is assigned to ${person}'s ride. Acceptance is not yet confirmed.`)
      continue
    }

    if (intent.type === 'ride.unassign') {
      const driver = memberBySlug.get(intent.driverSlug)
      const matches = coordinationTargets(todayEvents.filter(event =>
        event.transport_owner_member_id === driver?.id), intent, fact, today)
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
      const fullSourceAppointment = intent.appointment
        ? parseAppointmentText(text, { today, timeZone: intent.appointment.timeZone })
        : null
      const appointment = intent.appointment
        ? {
            ...intent.appointment,
            originalText: text,
            clinician: fullSourceAppointment?.clinician || intent.appointment.clinician,
            facility: fullSourceAppointment?.facility || intent.appointment.facility,
            location: fullSourceAppointment?.location || intent.appointment.location,
            preparationInstructions: fullSourceAppointment?.preparationInstructions
              || intent.appointment.preparationInstructions,
          }
        : null
      const subject = intent.personSlug
        ? memberBySlug.get(intent.personSlug)
          || (intent.personSlug === 'danielle' && m.display_name.toLowerCase() === 'danielle' ? m : null)
        : null
      if (intent.personSlug && !subject) { ambiguities.push(fact); continue }
      const endsAt = new Date(new Date(intent.time).getTime() + 60 * 60 * 1000).toISOString()
      const patientSlug = subject?.slug || (intent.private ? m.slug : null)
      const dedupeKey = appointment
        ? appointmentDedupeKey({
            title: intent.title,
            startsAt: intent.time,
            patientSlug,
            appointmentType: appointment.appointmentType,
            clinician: appointment.clinician,
          })
        : null
      const plannedEventId = dedupeKey ? appointmentEventId(dedupeKey) : planRecordId()
      const existingAppointment = dedupeKey
        ? await sql<{ id: string }[]>`
            select id from public.events
            where household_id=${m.household_id}::uuid
              and deleted_at is null
              and (
                id=${plannedEventId}::uuid
                or dedupe_key=${dedupeKey}
                or (
                  starts_at=${intent.time}::timestamptz
                  and person_slug is not distinct from ${patientSlug}
                  and lower(btrim(title))=lower(btrim(${intent.title}))
                )
              )
            limit 1
          `
        : []
      const eventId = existingAppointment[0]?.id || plannedEventId
      writes.push({
        operation: existingAppointment[0] ? 'event.update' : 'event.create', record_id: eventId,
        title: intent.title, person_slug: patientSlug,
        starts_at: intent.time, ends_at: endsAt,
        ...(appointment?.location || intent.location ? { location: appointment?.location || intent.location } : {}),
        visibility: intent.private ? 'private' : 'household',
        owner_member_id: intent.private ? m.id : null,
        kind: appointment ? 'appointment' : 'event', source: 'pepper',
        metadata: {
          type: existingAppointment[0] ? 'appointment_replayed' : 'event_created',
          ...(appointment ? {
            appointment_type: appointment.appointmentType,
            source_timezone: appointment.timeZone,
            scheduling_priority: 100,
            dedupe_key: dedupeKey,
          } : {}),
        },
      })

      if (appointment && dedupeKey) {
        appointments.push({
          eventId,
          dedupeKey,
          title: intent.title,
          patientMemberId: subject?.id || null,
          appointment,
        })

        const overlappingEvents = await sql<EventRow[]>`
          select id,title,person_slug,starts_at,ends_at,kind,source,transport_owner_member_id
          from public.events
          where household_id=${m.household_id}::uuid
            and id<>${eventId}::uuid
            and deleted_at is null
            and status<>'canceled'
            and starts_at<${endsAt}::timestamptz
            and coalesce(ends_at,starts_at + interval '1 hour')>${intent.time}::timestamptz
          order by starts_at
        `
        for (const overlap of overlappingEvents) {
          if (!eventsOverlap({
            ...appointment,
            id: eventId,
            title: intent.title,
            starts_at: intent.time,
            ends_at: endsAt,
            kind: 'appointment',
            appointment_type: appointment.appointmentType,
          } as SchedulingEvent, overlap)) continue
          const followUpTitle = medicalCoordinationTaskTitle({
            id: eventId,
            title: intent.title,
            starts_at: intent.time,
            ends_at: endsAt,
            kind: 'appointment',
            appointment_type: appointment.appointmentType,
          }, overlap)
          if (!followUpTitle) continue
          const coordinationPriority = medicalCoordinationPriority({
            appointmentStartsAt: intent.time,
            now: new Date().toISOString(),
            unresolvedLogistics: true,
          })
          const taskId = appointmentEventId(`coordination:${dedupeKey}:${overlap.id}`)
          const existingTask = await sql<{ id: string }[]>`
            select id from public.tasks
            where id=${taskId}::uuid and household_id=${m.household_id}::uuid
            limit 1
          `
          writes.push({
            operation: existingTask[0] ? 'task.update' : 'task.create',
            record_id: taskId,
            title: followUpTitle,
            owner_member_id: m.id,
            visibility: 'household',
            status: 'open',
            due_at: intent.time,
            source: 'pepper_medical_coordination',
            metadata: {
              type: 'medical_coordination_follow_up',
              medical_event_id: eventId,
              overlapping_event_id: overlap.id,
              coordination_priority: coordinationPriority.priority,
              priority_reason: coordinationPriority.reason,
            },
          })
        }

        if (subject && ['teen', 'child'].includes(subject.role)) {
          const transportationPriority = medicalCoordinationPriority({
            appointmentStartsAt: intent.time,
            now: new Date().toISOString(),
            unresolvedLogistics: true,
          })
          const taskId = appointmentEventId(`transport:${dedupeKey}`)
          const existingTask = await sql<{ id: string }[]>`
            select id from public.tasks
            where id=${taskId}::uuid and household_id=${m.household_id}::uuid
            limit 1
          `
          writes.push({
            operation: existingTask[0] ? 'task.update' : 'task.create',
            record_id: taskId,
            title: `Confirm transportation for ${intent.title}`,
            owner_member_id: m.id,
            visibility: 'household',
            status: 'open',
            due_at: intent.time,
            source: 'pepper_medical_coordination',
            metadata: {
              type: 'medical_transportation_follow_up',
              medical_event_id: eventId,
              coordination_priority: transportationPriority.priority,
              priority_reason: transportationPriority.reason,
            },
          })
        }
      }
      messages.push(`${intent.title} added to the calendar at ${formatTime(intent.time)}.`)
      continue
    }

    if (intent.type === 'meal') {
      writes.push({
        operation: 'meal.upsert', record_id: todayMeals[0]?.id || planRecordId(),
        meal_date: today, meal_name: intent.mealName,
        ...(intent.time ? { eat_at: intent.time } : {}),
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
      } else if (intent.time) {
        writes.push({
          operation: 'event.create', record_id: planRecordId(),
          title: `Dinner · ${intent.mealName}`,
          starts_at: intent.time,
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

    if (intent.type === 'chore') {
      const namedOwner = intent.ownerSlug ? memberBySlug.get(intent.ownerSlug) : null
      if (intent.ownerSlug && !namedOwner) { ambiguities.push(fact); continue }
      if (namedOwner && !['adult_admin', 'adult'].includes(m.role) && namedOwner.id !== m.id) {
        ambiguities.push(fact)
        continue
      }
      const due = dueDateFrom(fact, today)
      const owner = namedOwner || m
      writes.push({
        operation: 'task.create', record_id: planRecordId(), title: intent.title,
        owner_member_id: owner.id, visibility: 'household', status: 'open',
        due_at: due ? new Date(`${due.date}T17:00:00-07:00`).toISOString() : null,
        source: 'pepper_chore', metadata: { type: 'chore_created' },
      })
      messages.push(`Added “${intent.title}” to ${owner.display_name}’s chores${due ? ` for ${due.label}` : ''}.`)
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

    if (intent.type === 'ambiguous' && intent.unresolvedFields?.length) {
      ambiguities.push(...intent.unresolvedFields.map((field) => `${field}. Original: ${intent.text}`))
    } else {
      ambiguities.push(fact)
    }
  }

  return { facts, writes, messages, ambiguities, appointments }
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

    if (action === 'review_decide') {
      const id = String(body.capture_id || '')
      const decision = String(body.decision || '')
      if (!UUID.test(id) || !['approved','declined'].includes(decision)) return json({ error: 'Proposal and explicit decision required.' }, 400)
      return json(await decideCalendarProposal(currentMember, id, decision))
    }

    if (action === 'undo') {
      const captureId = String(body.capture_id || '')
      if (!UUID.test(captureId)) return json({ error: 'A valid Pepper change is required.' }, 400)
      return json(await undoCapture(currentMember, captureId))
    }

    if (action === 'review_list') {
      const rows = await sql`
        select c.id,c.original_text,c.status,c.source,c.captured_at,c.proposal_decision,
          submitter.display_name as proposed_by,
          (c.proposal_decision='pending' and ${isAdultHouseholdRole(currentMember.role)}) as can_review,
          c.calendar_proposal->'preview' as proposed_changes,
          c.calendar_proposal->'plan'->'remaining_ambiguities' as unresolved_details,
          case when c.proposal_decision='approved' then
            (select bool_and(e.sync_status='synced') from public.events e
             where e.household_id=c.household_id and e.id in
               (select (v->>'record_id')::uuid from jsonb_array_elements(c.applied_changes) v where v->>'entity_type'='event'))
          else null end as delivery_complete
        from public.captures c join public.household_members submitter on submitter.id=c.member_id
        where c.household_id=${currentMember.household_id}::uuid
          and ((c.member_id=${currentMember.id}::uuid and (c.proposal_decision is not null or
            c.id in (select capture_id from private.list_capture_reviews(${currentMember.id}::uuid,50)))) or
            (${isAdultHouseholdRole(currentMember.role)} and c.sharing_scope='household'
             and submitter.role in ('child','teen') and c.calendar_proposal is not null))
          and (c.status in ('captured','partially_applied','needs_review') or c.proposal_decision is not null)
        order by (c.proposal_decision='pending') desc nulls last,c.captured_at desc limit 50
      `
      return json({ ok: true, reviews: rows })
    }

    if (action === 'review_resolve') {
      const captureId = String(body.capture_id || '')
      const idempotencyKey = String(body.idempotency_key || '')
      if (!UUID.test(captureId) || !idempotencyKey || body.resolution !== 'no_change_required') {
        return json({ error: 'Capture, idempotency key, and an explicit no-change resolution are required.' }, 400)
      }
      const proposal = await sql`select id from public.captures where id=${captureId}::uuid and calendar_proposal is not null`
      if (proposal.length) return json({ error: 'Calendar proposals require an adult approve or decline decision.' }, 403)
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
      const proposals = await sql`select proposal_decision from public.captures where id=${captureId}::uuid
        and member_id=${currentMember.id}::uuid and household_id=${currentMember.household_id}::uuid and calendar_proposal is not null`
      if (proposals[0]) return json({ status: proposals[0].proposal_decision === 'pending' ? 'needs_review' : proposals[0].proposal_decision,
        ...calendarProposalResponse(), capture_id: captureId,
        reply: proposals[0].proposal_decision === 'pending' ? calendarProposalResponse().reply : `This proposal was ${proposals[0].proposal_decision}. No new changes were made.`, applied_changes: [] })
      const captureRows = await sql<{ original_text: string }[]>`
        select original_text
        from public.captures
        where id=${captureId}::uuid
          and member_id=${currentMember.id}::uuid
          and status in ('needs_review','partially_applied')
        limit 1
      `
      if (!captureRows[0]) return json({ error: 'That review item is no longer waiting.' }, 404)
      const clarificationText = String(body.clarification_text || '').trim()
      const retryText = reviewRetryText(captureRows[0].original_text, clarificationText)
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
      const interpretation = requireAdultCalendarReview(
        currentMember,
        await interpretCapture(currentMember, retryText),
      )
      const plan = buildPlan(
        interpretation.facts,
        interpretation.writes,
        interpretation.ambiguities,
        'review_resolution',
      )
      const result = await applyPlan(captureId, currentMember, idempotencyKey.slice(0, 200), plan)
      const outcome = String(result?.status || plan.outcome)
      const appliedChanges = Array.isArray(result?.applied_changes) ? result.applied_changes : []
      const recordedEvents = await recordAppliedCalendarMutations(captureId, currentMember, appliedChanges)
      const replayAppointments = await appointmentItemsForReplay(currentMember, appliedChanges)
      const bridgeResults = await syncAppointmentBridges(
        captureId,
        currentMember,
        mergeAppointmentBridgeItems(interpretation.appointments, replayAppointments),
      )
      const sharedCalendarResults = await syncSharedCalendarEvents(captureId, recordedEvents)
      const needsClarification = outcome === 'needs_review' || outcome === 'partially_applied'
      return json({
        status: outcome,
        mode: needsClarification ? 'clarification' : 'action',
        captureId,
        capture_id: captureId,
        reply: replyForPlan(outcome, interpretation.messages),
        applied_changes: appliedChanges,
        appointment_bridge: bridgeResults,
        ...appointmentDeliverySummary(bridgeResults),
        ...sharedCalendarDeliverySummary(sharedCalendarResults),
        undoable: appliedChanges.length > 0,
        ...(needsClarification
          ? { clarification: clarificationFor(interpretation.ambiguities.join(' ') || retryText) }
          : {}),
        ...(outcome === 'needs_review' && interpretation.ambiguities.includes(ADULT_CALENDAR_REVIEW_REQUIRED)
          ? calendarProposalResponse() : {}),
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
    if (capture.existing) {
      const decisions = await sql`select proposal_decision from public.captures where id=${capture.id}::uuid and proposal_decision in ('approved','declined')`
      if (decisions[0]) return json({ status: decisions[0].proposal_decision,mode:'review',capture_id:capture.id,
        reply:`This proposal was ${decisions[0].proposal_decision}. No new changes were made.`,undoable:false,applied_changes:[],idempotent_replay:true })
    }
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
        const recordedEvents = await recordAppliedCalendarMutations(capture.id, currentMember, appliedChanges)
        const appointments = await appointmentItemsForReplay(currentMember, appliedChanges)
        const bridgeResults = await syncAppointmentBridges(capture.id, currentMember, appointments)
        const sharedCalendarResults = await syncSharedCalendarEvents(capture.id, recordedEvents)
        return json({
          status: prior[0].result.status,
          mode: prior[0].result.status === 'needs_review' ? 'review' : 'action',
          captureId: capture.id,
          capture_id: capture.id,
          reply: prior[0].result.status === 'needs_review'
            ? 'This request is still awaiting review. No new changes have been made.'
            : prior[0].result.status === 'partially_applied'
              ? 'Pepper already handled the safe changes. The rest is still awaiting review.'
              : 'Done. Pepper already handled that update.',
          applied_changes: appliedChanges,
          appointment_bridge: bridgeResults,
          ...appointmentDeliverySummary(bridgeResults),
          ...sharedCalendarDeliverySummary(sharedCalendarResults),
          undoable: appliedChanges.length > 0,
          idempotent_replay: true,
        })
      }
    }
    const originalInterpretation = await interpretCapture(currentMember, text)
    await saveCalendarProposal(capture.id, currentMember, originalInterpretation)
    const interpretation = requireAdultCalendarReview(currentMember, originalInterpretation)
    const plan = buildPlan(interpretation.facts, interpretation.writes, interpretation.ambiguities)
    const result = await applyPlan(
      capture.id, currentMember, clientKey ? clientKey.slice(0, 200) : crypto.randomUUID(), plan,
    )
    const outcome = String(result?.status || plan.outcome)
    const appliedChanges = Array.isArray(result?.applied_changes) ? result.applied_changes : []
    const recordedEvents = await recordAppliedCalendarMutations(capture.id, currentMember, appliedChanges)
    const replayAppointments = await appointmentItemsForReplay(currentMember, appliedChanges)
    const bridgeResults = await syncAppointmentBridges(
      capture.id,
      currentMember,
      mergeAppointmentBridgeItems(interpretation.appointments, replayAppointments),
    )
    const sharedCalendarResults = await syncSharedCalendarEvents(capture.id, recordedEvents)
    const needsClarification = outcome === 'needs_review' || outcome === 'partially_applied'
    return json({
      status: outcome,
      mode: needsClarification ? 'clarification' : 'action',
      captureId: capture.id,
      capture_id: capture.id,
      reply: replyForPlan(outcome, interpretation.messages),
      applied_changes: appliedChanges,
      appointment_bridge: bridgeResults,
      ...appointmentDeliverySummary(bridgeResults),
      ...sharedCalendarDeliverySummary(sharedCalendarResults),
      undoable: appliedChanges.length > 0,
      ...(needsClarification
        ? { clarification: clarificationFor(interpretation.ambiguities.join(' ') || text) }
        : {}),
      ...(outcome === 'needs_review' && interpretation.ambiguities.includes(ADULT_CALENDAR_REVIEW_REQUIRED)
        ? calendarProposalResponse() : {}),
    })
  } catch (error) {
    console.error(error)
    const status = typeof (error as { status?: unknown })?.status === 'number'
      ? Number((error as { status: number }).status)
      : 500
    return json({ error: publicFailureMessage(error) }, status)
  }
})
