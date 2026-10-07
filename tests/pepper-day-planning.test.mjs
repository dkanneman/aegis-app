import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildDailyPlan,
  dailyPlanActionPatch,
  emailActionScore,
  rankDayPlanTasks,
} from '../supabase/functions/pepper-family-api/day-planning.ts'

const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)
const cssPath = new URL('../app/pepper/pepper.module.css', import.meta.url)
const priorityMigrationPath = new URL('../supabase/migrations/20260915175808_prioritize_daily_plan_tasks.sql', import.meta.url)

test('private email suggestions use a full-width text column at desktop and mobile widths', async () => {
  const [client, css] = await Promise.all([readFile(clientPath, 'utf8'), readFile(cssPath, 'utf8')])
  assert.match(client, /className=\{`\$\{styles\.dayPlanRow\} \$\{styles\.dayPlanEmailSuggestion\}`\}/)
  const layouts = [...css.matchAll(/\.dayPlanRow\.dayPlanEmailSuggestion\s*\{\s*grid-template-columns:\s*([^;]+);/g)]
  assert.equal(layouts.length, 2)
  for (const [, columns] of layouts) assert.match(columns, /^\d+px minmax\(0, 1fr\) \d+px$/)
})

test('day planning ranks current hard-deadline payroll above an old manuscript task', () => {
  const plan = buildDailyPlan({
    now: '2026-09-15T15:00:00.000Z',
    dayStart: '2026-09-15T07:00:00.000Z',
    dayEnd: '2026-09-16T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [
      { id: 'payroll', title: 'Run payroll today', status: 'open', importance: 'critical', urgency: 'today', deadline_type: 'hard', due_at: '2026-09-15T23:59:00.000Z', due_date_confidence: 1, area: 'Work', estimated_minutes: 45 },
      { id: 'manuscript', title: 'MC-023 - Locate manuscript drafts', status: 'open', priority: 'P1', importance: 'high', urgency: 'flexible', deadline_type: 'soft', due_at: '2026-07-31T23:59:00.000Z', due_date_confidence: 0.45, area: 'Personal', project: 'Manuscript', estimated_minutes: 90 },
      { id: 'held', title: 'Jelinda bid', status: 'on_hold', importance: 'critical', urgency: 'today', deadline_type: 'hard', due_at: '2026-09-15T23:59:00.000Z', due_date_confidence: 1, area: 'Work', blocked: true, next_action: 'Wait for further notice' },
    ],
    events: [
      { id: 'appointment', title: 'Dentist', starts_at: '2026-09-15T17:00:00.000Z', ends_at: '2026-09-15T18:00:00.000Z', location: 'Camarillo' },
    ],
    emails: [],
  })

  const taskItems = plan.items.filter((item) => item.kind === 'task')
  assert.equal(taskItems[0].record_id, 'payroll')
  assert.equal(taskItems.some((item) => item.record_id === 'held'), false)
  assert.equal(plan.items.some((item) => item.kind === 'appointment' && item.record_id === 'appointment'), true)
  assert.match(taskItems[0].reason, /payroll|hard deadline today/i)
  assert.doesNotMatch(taskItems[0].reason, /overdue and still open/i)
  assert.equal(taskItems[0].scheduled_for, null)
})

test('overdue status alone cannot create top priority', () => {
  const ranked = rankDayPlanTasks([
    { id: 'old', title: 'Old imported manuscript task', status: 'open', importance: 'high', urgency: 'flexible', deadline_type: 'soft', due_at: '2026-06-01T23:59:00.000Z', due_date_confidence: 0.4, project: 'Manuscript' },
    { id: 'current', title: 'Submit current safety filing', status: 'open', importance: 'high', urgency: 'today', deadline_type: 'hard', due_at: '2026-09-15T23:59:00.000Z', due_date_confidence: 1, area: 'Safety' },
  ], {
    now: '2026-09-15T15:00:00.000Z',
    today: '2026-09-15',
    timeZone: 'America/Los_Angeles',
  })

  assert.equal(ranked[0].task.id, 'current')
  assert.ok(ranked[0].score > ranked[1].score)
  assert.ok(ranked[1].score <= 45)
})

test('combined legacy priority labels map to importance without relying on overdue state', () => {
  const [ranked] = rankDayPlanTasks([
    { id: 'legacy', title: 'Current strategic task', status: 'open', priority: 'High/P1', urgency: 'flexible' },
  ], {
    now: '2026-09-15T15:00:00.000Z',
    today: '2026-09-15',
    timeZone: 'America/Los_Angeles',
  })
  assert.equal(ranked.importance, 'high')
  assert.equal(ranked.score, 30)
})

test('routine filing does not become a legal consequence', () => {
  const [ranked] = rankDayPlanTasks([
    { id: 'routine', title: 'Routine filing', status: 'open', importance: 'normal', urgency: 'flexible' },
  ], {
    now: '2026-09-15T15:00:00.000Z',
    today: '2026-09-15',
    timeZone: 'America/Los_Angeles',
  })
  assert.equal(ranked.rankGroup, 5)
  assert.equal(ranked.score, 20)
  assert.doesNotMatch(ranked.reason, /legal/i)
})

test('dismissed tasks stay out for the local day and return tomorrow', () => {
  const input = {
    now: '2026-09-15T15:00:00.000Z',
    dayStart: '2026-09-15T07:00:00.000Z',
    dayEnd: '2026-09-16T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [{ id: 'dismissed', title: 'Not today', status: 'open', importance: 'critical', urgency: 'today', dismissed_for_date: '2026-09-15' }],
    events: [],
    emails: [],
  }
  assert.equal(buildDailyPlan(input).items.some((item) => item.record_id === 'dismissed'), false)
  assert.equal(buildDailyPlan({ ...input, now: '2026-09-16T15:00:00.000Z', dayStart: '2026-09-16T07:00:00.000Z', dayEnd: '2026-09-17T07:00:00.000Z' }).items.some((item) => item.record_id === 'dismissed'), true)
})

test('snoozed tasks return only after the snooze expires', () => {
  const base = {
    dayStart: '2026-09-15T07:00:00.000Z',
    dayEnd: '2026-09-16T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    events: [],
    emails: [],
  }
  const task = { id: 'snoozed', title: 'Call vendor', status: 'open', importance: 'high', urgency: 'today', snoozed_until: '2026-09-15T17:00:00.000Z' }
  assert.equal(buildDailyPlan({ ...base, now: '2026-09-15T15:00:00.000Z', tasks: [task] }).items.some((item) => item.record_id === 'snoozed'), false)
  assert.equal(buildDailyPlan({ ...base, now: '2026-09-15T18:00:00.000Z', tasks: [task] }).items.some((item) => item.record_id === 'snoozed'), true)
})

test('return to task list changes only today planning state', () => {
  const patch = dailyPlanActionPatch('return_to_list', {
    today: '2026-09-15',
    now: '2026-09-15T15:00:00.000Z',
    timeZone: 'America/Los_Angeles',
  })
  assert.deepEqual(patch, {
    dismissed_for_date: '2026-09-15',
    daily_plan_state: 'returned',
    manually_pinned: false,
  })
  assert.equal('status' in patch, false)
  assert.equal('deleted_at' in patch, false)
  assert.equal('due_at' in patch, false)
})

test('waiting and non-actionable blocked tasks are excluded', () => {
  const plan = buildDailyPlan({
    now: '2026-09-15T15:00:00.000Z',
    dayStart: '2026-09-15T07:00:00.000Z',
    dayEnd: '2026-09-16T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [
      { id: 'waiting', title: 'Waiting for a callback', status: 'open', importance: 'critical', urgency: 'today', waiting_on: 'Vendor' },
      { id: 'blocked', title: 'Blocked task', status: 'open', importance: 'critical', urgency: 'today', blocked: true, next_action: '' },
      { id: 'held', title: 'Jelinda bid', status: 'on_hold', importance: 'critical', urgency: 'today', blocked: true, next_action: 'Wait for further notice' },
      { id: 'followup', title: 'Follow up now', status: 'open', importance: 'high', urgency: 'today', waiting_on: 'Vendor', waiting_follow_up_at: '2026-09-15T14:00:00.000Z' },
    ],
    events: [],
    emails: [],
  })
  const ids = plan.items.map((item) => item.record_id)
  assert.equal(ids.includes('waiting'), false)
  assert.equal(ids.includes('blocked'), false)
  assert.equal(ids.includes('held'), false)
  assert.equal(ids.includes('followup'), true)
})

test('manual pins override normal scoring', () => {
  const ranked = rankDayPlanTasks([
    { id: 'critical', title: 'Critical work', status: 'open', importance: 'critical', urgency: 'today' },
    { id: 'pinned', title: 'Chosen by user', status: 'open', importance: 'normal', urgency: 'flexible', manually_pinned: true },
  ], { now: '2026-09-15T15:00:00.000Z', today: '2026-09-15', timeZone: 'America/Los_Angeles' })
  assert.equal(ranked[0].task.id, 'pinned')
  assert.equal(ranked[0].score >= 100, true)
  assert.equal(ranked[0].reason, 'User pinned')
})

test('repeated refreshes are idempotent', () => {
  const input = {
    now: '2026-09-15T15:00:00.000Z',
    dayStart: '2026-09-15T07:00:00.000Z',
    dayEnd: '2026-09-16T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [{ id: 'one', title: 'One task', status: 'open', importance: 'high', urgency: 'today', estimated_minutes: 30 }],
    events: [],
    emails: [],
  }
  assert.deepEqual(buildDailyPlan(input), buildDailyPlan(input))
})

test('a Saturday chore is not placed in Wednesday even when due this week', () => {
  const base = {
    now: '2026-10-07T16:00:00.000Z',
    dayStart: '2026-10-07T07:00:00.000Z',
    dayEnd: '2026-10-08T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [{ id: 'saturday-reset', title: 'Saturday reset — Kitchen + adult bedroom', classification: 'Chore', recurrence: 'weekly', status: 'open', due_at: '2026-10-11T00:00:00.000Z', urgency: 'this_week' }],
    events: [],
    emails: [],
  }
  assert.equal(buildDailyPlan(base).items.some(item => item.record_id === 'saturday-reset'), false)
  const saturday = buildDailyPlan({ ...base, now: '2026-10-10T16:00:00.000Z', dayStart: '2026-10-10T07:00:00.000Z', dayEnd: '2026-10-11T07:00:00.000Z' })
  assert.equal(saturday.items.filter(item => item.record_id === 'saturday-reset').length, 1)
  const completed = buildDailyPlan({ ...base, tasks: [{ ...base.tasks[0], status: 'completed' }], now: '2026-10-10T16:00:00.000Z', dayStart: '2026-10-10T07:00:00.000Z', dayEnd: '2026-10-11T07:00:00.000Z' })
  assert.equal(completed.items.some(item => item.record_id === 'saturday-reset'), false)
})

test('a Saturday deadline remains actionable on Wednesday without claiming a time slot', () => {
  const plan = buildDailyPlan({
    now: '2026-10-07T16:00:00.000Z', dayStart: '2026-10-07T07:00:00.000Z', dayEnd: '2026-10-08T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [{ id: 'deadline', title: 'Submit form', classification: 'To-do', status: 'open', due_at: '2026-10-11T00:00:00.000Z', deadline_type: 'hard', due_date_confidence: 1 }],
    events: [], emails: [],
  })
  assert.equal(plan.items.find(item => item.record_id === 'deadline')?.scheduled_for, null)
})

test('a recurring occurrence follows Los Angeles dates across UTC midnight and DST', () => {
  const task = { id: 'saturday', title: 'Weekly home reset', classification: 'Chore', recurrence: 'weekly', status: 'open', due_at: '2026-11-08T01:00:00.000Z' }
  const base = { timeZone: 'America/Los_Angeles', tasks: [task], events: [], emails: [] }
  const friday = buildDailyPlan({ ...base, now: '2026-11-07T07:30:00.000Z', dayStart: '2026-11-06T08:00:00.000Z', dayEnd: '2026-11-07T08:00:00.000Z' })
  assert.equal(friday.items.some(item => item.record_id === task.id), false)
  const saturday = buildDailyPlan({ ...base, now: '2026-11-07T16:00:00.000Z', dayStart: '2026-11-07T08:00:00.000Z', dayEnd: '2026-11-08T08:00:00.000Z' })
  assert.equal(saturday.items.filter(item => item.record_id === task.id).length, 1)
})

test('due dates do not become invented late-night appointments', () => {
  const plan = buildDailyPlan({
    now: '2026-10-08T02:30:00.000Z',
    dayStart: '2026-10-07T07:00:00.000Z',
    dayEnd: '2026-10-08T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [
      { id: 'safety', title: 'Collect work safety sheets', status: 'open', area: 'Work', urgency: 'today' },
      { id: 'walk', title: 'Walk Maggie', status: 'open', classification: 'Chore', urgency: 'today' },
    ],
    events: [{ id: 'dinner', title: 'Dinner with family', starts_at: '2026-10-08T01:30:00.000Z', ends_at: '2026-10-08T02:30:00.000Z' }],
    emails: [],
  })
  assert.equal(plan.items.filter(item => item.source === 'tasks').length, 2)
  assert.ok(plan.items.filter(item => item.source === 'tasks').every(item => item.scheduled_for === null && item.ends_at === null))
  assert.equal(plan.items.find(item => item.record_id === 'dinner').scheduled_for, '2026-10-08T01:30:00.000Z')
})

test('all-day calendar markers do not repeat as clock-overlap conflicts', () => {
  const plan = buildDailyPlan({
    now: '2026-10-07T16:00:00.000Z',
    dayStart: '2026-10-07T07:00:00.000Z',
    dayEnd: '2026-10-08T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    events: [
      { id: 'spectator', title: 'Optional race spectator', starts_at: '2026-10-07T07:00:00.000Z', ends_at: '2026-10-08T07:00:00.000Z', all_day: true },
      { id: 'school', title: 'School pickup', starts_at: '2026-10-07T19:00:00.000Z', ends_at: '2026-10-07T19:30:00.000Z' },
      { id: 'doctor', title: 'Doctor appointment', starts_at: '2026-10-07T19:15:00.000Z', ends_at: '2026-10-07T20:00:00.000Z' },
    ],
    emails: [],
  })
  assert.equal(plan.items.filter(item => item.record_id === 'spectator').length, 1)
  assert.equal(plan.conflict_items.length, 1)
  assert.deepEqual(plan.conflict_items[0].event_ids, ['school', 'doctor'])
})

test('one project cannot flood the plan', () => {
  const projects = ['Manuscript', 'Chapter 1', 'Book revisions', 'Publishing', 'Manuscript']
  const manuscript = Array.from({ length: 5 }, (_, index) => ({
    id: `book-${index}`,
    title: `Manuscript task ${index}`,
    status: 'open',
    importance: 'high',
    urgency: 'this_week',
    project: projects[index],
    estimated_minutes: 30,
  }))
  const plan = buildDailyPlan({
    now: '2026-09-15T15:00:00.000Z',
    dayStart: '2026-09-15T07:00:00.000Z',
    dayEnd: '2026-09-16T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [...manuscript, { id: 'payroll', title: 'Prepare payroll', status: 'open', importance: 'critical', urgency: 'today', project: 'Operations', estimated_minutes: 30 }],
    events: [],
    emails: [],
  })
  assert.ok(plan.items.filter((item) => item.kind === 'task' && /manuscript|chapter|book|publishing/i.test(item.project || '')).length <= 2)
  assert.ok(plan.items.filter((item) => item.kind === 'task' && item.plan_tier === 'must_protect').length <= 3)
})

test('planner does not turn open calendar space into an unverified task slot', () => {
  const plan = buildDailyPlan({
    now: '2026-09-15T15:00:00.000Z',
    dayStart: '2026-09-15T07:00:00.000Z',
    dayEnd: '2026-09-15T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: Array.from({ length: 6 }, (_, index) => ({ id: `task-${index}`, title: `Task ${index}`, status: 'open', importance: 'high', urgency: 'today', estimated_minutes: 60 })),
    events: [{ id: 'fixed', title: 'Work commitment', starts_at: '2026-09-15T16:30:00.000Z', ends_at: '2026-09-15T18:30:00.000Z' }],
    emails: [],
  })
  const tasks = plan.items.filter((item) => item.kind === 'task')
  assert.equal(tasks.length, 5)
  assert.ok(tasks.every((item) => item.scheduled_for === null && item.ends_at === null))
  assert.equal(plan.items.find((item) => item.record_id === 'fixed').scheduled_for, '2026-09-15T16:30:00.000Z')
})

test('day planning identifies actionable email without turning ordinary mail into work', () => {
  assert.ok(emailActionScore({ subject: 'Action required: permission form due Friday', snippet: '', unread: true, important: false }) > 0)
  assert.equal(emailActionScore({ subject: 'September newsletter', snippet: 'Here are this month’s stories.', unread: true, important: false }), 0)

  const plan = buildDailyPlan({
    now: '2026-09-10T15:00:00.000Z',
    dayStart: '2026-09-10T07:00:00.000Z',
    dayEnd: '2026-09-11T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    events: [],
    emails: [
      { id: 'mail-1', thread_id: 'thread-1', subject: 'Action required: permission form due Friday', sender: 'School Office', snippet: 'Please sign and return the form.', received_at: '2026-09-10T14:30:00.000Z', unread: true, important: true },
      { id: 'mail-2', thread_id: 'thread-2', subject: 'September newsletter', sender: 'Neighborhood', snippet: 'Here are this month’s stories.', received_at: '2026-09-10T14:00:00.000Z', unread: true, important: false },
    ],
  })

  const emailItems = plan.items.filter((item) => item.kind === 'email')
  assert.equal(emailItems.length, 1)
  assert.equal(emailItems[0].record_id, 'mail-1')
  assert.match(emailItems[0].reason, /email/i)
})

test('day planning distinguishes chores, events, appointments, and meals', () => {
  const plan = buildDailyPlan({
    now: '2026-09-10T15:00:00.000Z',
    dayStart: '2026-09-10T07:00:00.000Z',
    dayEnd: '2026-09-11T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [
      { id: 'work', title: 'Send proposal', status: 'open', priority: 'P1', area: 'Work' },
      { id: 'chore', title: 'Empty dishwasher', status: 'open', source: 'pepper_chore' },
    ],
    events: [
      { id: 'school', title: 'School assembly', kind: 'event', starts_at: '2026-09-10T17:00:00.000Z' },
      { id: 'dentist', title: 'Dentist appointment', kind: 'appointment', starts_at: '2026-09-10T19:00:00.000Z' },
    ],
    meals: [
      { id: 'dinner', meal_name: 'Chicken rice bowls', eat_at: '2026-09-11T01:30:00.000Z', owner_name: 'Matt' },
    ],
    emails: [],
  })

  assert.deepEqual(
    new Set(plan.items.map((item) => item.kind)),
    new Set(['task', 'chore', 'event', 'appointment', 'meal']),
  )
  assert.equal(plan.counts.tasks, 1)
  assert.equal(plan.counts.chores, 1)
  assert.equal(plan.counts.events, 1)
  assert.equal(plan.counts.appointments, 1)
  assert.equal(plan.counts.meals, 1)
  assert.match(plan.items.find((item) => item.kind === 'meal').detail, /Matt/)
})

test('overlapping appointments are surfaced as a day-plan conflict', () => {
  const plan = buildDailyPlan({
    now: '2026-09-10T15:00:00.000Z',
    dayStart: '2026-09-10T07:00:00.000Z',
    dayEnd: '2026-09-11T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    emails: [],
    events: [
      { id: 'one', title: 'School meeting', starts_at: '2026-09-10T18:00:00.000Z', ends_at: '2026-09-10T19:00:00.000Z' },
      { id: 'two', title: 'Doctor appointment', starts_at: '2026-09-10T18:30:00.000Z', ends_at: '2026-09-10T19:30:00.000Z' },
    ],
  })

  assert.equal(plan.conflicts.length, 1)
  assert.match(plan.conflicts[0], /Doctor appointment remains the priority/i)
  assert.match(plan.conflicts[0], /coordinate school coverage for School meeting/i)
  assert.deepEqual(plan.conflict_items[0].event_ids, ['one', 'two'])
  assert.equal(plan.conflict_items[0].message, plan.conflicts[0])
})

test('read-only source conflicts retain exact record IDs for source review', () => {
  const plan = buildDailyPlan({
    now: '2026-09-10T15:00:00.000Z',
    dayStart: '2026-09-10T07:00:00.000Z',
    dayEnd: '2026-09-11T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    emails: [],
    events: [
      { id: 'source:calendar:a', title: 'School meeting', starts_at: '2026-09-10T18:00:00.000Z', ends_at: '2026-09-10T19:00:00.000Z', source_url: 'https://calendar.google.com/calendar/event?eid=a' },
      { id: 'owned', title: 'Doctor appointment', starts_at: '2026-09-10T18:30:00.000Z', ends_at: '2026-09-10T19:30:00.000Z' },
    ],
  })
  assert.deepEqual(plan.conflict_items[0].event_ids, ['source:calendar:a', 'owned'])
  assert.equal(plan.items.find(item => item.record_id === 'source:calendar:a').external_url, 'https://calendar.google.com/calendar/event?eid=a')
})

test('plan refresh is bounded and does not force a provider sync; conflicts open exact records', async () => {
  const client = await readFile(clientPath, 'utf8')
  const refresh = client.match(/async function generateDayPlan\([\s\S]*?\n  }/)?.[0] || ''
  assert.match(refresh, /refreshDayPlanFromServer\(token\)/)
  assert.doesNotMatch(refresh, /refreshDayPlanFromServer\(token, true\)/)
  assert.match(client, /AbortSignal\.timeout\(20000\)/)
  assert.match(refresh, /if \(dayPlanRequestInFlight\.current\) return/)
  assert.match(refresh, /dayPlanRequestInFlight\.current = false/)
  assert.match(client, /candidate\.record_id === eventId/)
  assert.match(client, /item\.record_id\.startsWith\("source:"\) \? "Open source"/)
})

test('daily planning is private, live, and available from Today and Ask Pepper', async () => {
  const [api, client, css, migration] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(clientPath, 'utf8'),
    readFile(cssPath, 'utf8'),
    readFile(priorityMigrationPath, 'utf8'),
  ])

  assert.match(api, /action==='day_plan'/)
  assert.match(api, /action==='day_plan_task_action'/)
  assert.match(api, /'day_plan'/)
  assert.match(api, /from public\.meal_plan mp/)
  assert.match(api, /classification,recurrence,tags,next_action,source/)
  assert.match(api, /select id,title,starts_at,ends_at,all_day,location/)
  assert.match(api, /emails:privateInputs.emails/)
  assert.match(api, /sourceItems\(sql,member\)/)
  assert.match(client, /Plan my day/)
  assert.match(client, /Pepper's promise/)
  assert.match(client, /Your day, organized/)
  assert.match(client, /Do today \/ Pin/)
  assert.match(client, /Return to task list/)
  assert.match(client, /Snooze until tomorrow/)
  assert.match(client, /Waiting on someone/)
  assert.match(client, /organize|prioritize/i)
  assert.match(client, /email, school events, chores, tasks/)
  assert.match(client, /daily flow in order of importance/)
  assert.match(client, /stay on top of everything and miss nothing/)
  assert.match(client, /Today’s plan is reorganized/)
  assert.doesNotMatch(client, /sendTell\(transcript, "voice"\)/)
  assert.match(client, /recognition\.interimResults = false/)
  assert.match(client, /Review your message, then send it/)
  assert.match(client, /idempotency_key: requestKey/)
  assert.match(client, /refreshDayPlanAfterChange\(result\.token\)/)
  assert.match(client, /isDayPlanRequest\(clean\)/)
  assert.match(client, /refresh\|replan/)
  assert.doesNotMatch(client, /preserveDayPlan/)
  const refreshAfterChange = client.match(
    /async function refreshDayPlanAfterChange[\s\S]*?\n  }/,
  )?.[0] || ''
  assert.doesNotMatch(refreshAfterChange, /setDayPlan\(null\)/)
  assert.match(css, /\.dayPlan/)
  for (const column of ['importance', 'urgency', 'deadline_type', 'due_date_confidence', 'waiting_follow_up_at', 'blocked', 'snoozed_until', 'dismissed_for_date', 'manually_pinned', 'daily_plan_state', 'priority_score', 'priority_reason']) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`))
  }
  assert.match(migration, /Legacy source priority retained/)
  assert.match(migration, /private\.task_priority_review_queue/)
  assert.match(migration, /if tg_op = 'INSERT' then/)
  assert.match(migration, /normalized_priority ~ .*\(p1\|high\).* then 'high'/)
  assert.doesNotMatch(migration, /set\s+priority\s*=/i)
})
