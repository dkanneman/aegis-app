import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildDailyPlan,
  emailActionScore,
} from '../supabase/functions/pepper-family-api/day-planning.ts'

const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const integrationsPath = new URL('../supabase/functions/pepper-integrations/index.ts', import.meta.url)
const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)
const cssPath = new URL('../app/pepper/pepper.module.css', import.meta.url)

test('day planning ranks active work around fixed appointments and excludes held work', () => {
  const plan = buildDailyPlan({
    now: '2026-09-10T15:00:00.000Z',
    dayStart: '2026-09-10T07:00:00.000Z',
    dayEnd: '2026-09-11T07:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [
      { id: 'due', title: 'Send the framing bid', status: 'open', priority: 'P1', due_at: '2026-09-10T23:59:00.000Z', area: 'Work' },
      { id: 'critical', title: 'Prepare payroll', status: 'open', priority: 'P0', due_at: '2026-09-11T23:59:00.000Z', area: 'Work' },
      { id: 'old', title: 'Return school form', status: 'open', priority: 'P3', due_at: '2026-09-09T23:59:00.000Z', area: 'Family' },
      { id: 'held', title: 'Jelinda bid', status: 'on_hold', priority: 'P0', due_at: '2026-09-10T23:59:00.000Z', area: 'Work' },
    ],
    events: [
      { id: 'appointment', title: 'Dentist', starts_at: '2026-09-10T17:00:00.000Z', ends_at: '2026-09-10T18:00:00.000Z', location: 'Camarillo' },
    ],
    emails: [],
  })

  const taskItems = plan.items.filter((item) => item.kind === 'task')
  assert.equal(taskItems[0].record_id, 'due')
  assert.equal(taskItems.some((item) => item.record_id === 'held'), false)
  assert.equal(plan.items.some((item) => item.kind === 'appointment' && item.record_id === 'appointment'), true)
  assert.match(taskItems[0].reason, /due today/i)
  assert.ok(taskItems[0].scheduled_for)
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
  assert.match(plan.conflicts[0], /School meeting.*Doctor appointment/)
})

test('daily planning is private, on demand, and available from Today and Ask Pepper', async () => {
  const [api, integrations, client, css] = await Promise.all([
    readFile(apiPath, 'utf8'),
    readFile(integrationsPath, 'utf8'),
    readFile(clientPath, 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  assert.match(api, /action==='day_plan'/)
  assert.match(api, /'day_plan'/)
  assert.match(api, /gmail_digest/)
  assert.match(integrations, /body\.action==='gmail_digest'/)
  assert.match(integrations, /member_id=\$\{member\.id\}::uuid/)
  assert.match(integrations, /vault\.decrypted_secrets/)
  assert.match(integrations, /format',\s*'metadata'/)
  assert.match(client, /Plan my day/)
  assert.match(client, /Pepper's promise/)
  assert.match(client, /Your day, organized/)
  assert.match(client, /organize|prioritize/i)
  assert.match(client, /email, school events, chores, tasks/)
  assert.match(client, /daily flow in order of importance/)
  assert.match(client, /stay on top of everything and miss nothing/)
  assert.match(css, /\.dayPlan/)
})
