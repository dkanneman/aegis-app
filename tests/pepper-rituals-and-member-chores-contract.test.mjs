import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)
const cssPath = new URL('../app/pepper/pepper.module.css', import.meta.url)
const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const ritualsPath = new URL('../supabase/functions/pepper-rituals/index.ts', import.meta.url)

test('Morning Brief follows the approved one-page scan hierarchy', async () => {
  const client = await readFile(clientPath, 'utf8')

  assert.match(client, /function MorningBriefPanel/)
  assert.match(client, /Three must-protect outcomes/)
  assert.match(client, /Places to be \+ transportation/)
  assert.match(client, /Tonight(?:'s|&apos;s) dinner \+ groceries/)
  assert.match(client, /Your task plan/)
  assert.match(client, /No-surprises horizon/)
  assert.match(client, /Confirm \+ think ahead/)
  assert.match(client, /Heart \+ compass/)
  assert.match(client, /Trust \+ freshness/)
})

test('Morning Brief foregrounds each member own prioritized task plan', async () => {
  const [client, rituals, css] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(ritualsPath, 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  assert.match(rituals, /owner_member_id=\$\{m\.id\}::uuid/)
  assert.match(rituals, /focus_tasks:focusTasks/)
  assert.match(rituals, /function balancedFocusTasks/)
  assert.match(rituals, /theat\(\?:er\|re\)\|costum\|wardrobe/)
  assert.match(rituals, /dishwasher/)
  assert.match(rituals, /task_summary:/)
  assert.match(client, /task\.owner_member_id === state\.member\.id/)
  assert.match(client, /Your task plan/)
  assert.match(client, /School \+ homework/)
  assert.match(client, /Theatre/)
  assert.match(client, /real estate\|realtor\|listing\|escrow/)
  assert.match(client, /dishwasher/)
  assert.match(css, /\.morningBriefTaskGroup/)
})

test('ritual panels remain responsive and the Tomorrow Check is a link', async () => {
  const [client, css] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  assert.match(client, /aria-label="Open tomorrow's plan"/)
  assert.match(client, /onClick=\{\(\) => setView\("week"\)\}/)
  assert.match(css, /\.morningBriefColumns/)
  assert.match(css, /grid-template-columns:\s*1fr 1fr/)
  assert.match(css, /\.morningBriefColumns[\s\S]*grid-template-columns:\s*1fr/)
})

test('Evening Reflection produces an evidence-aware output after private save', async () => {
  const client = await readFile(clientPath, 'utf8')

  assert.match(client, /function EveningReflectionOutput/)
  assert.match(client, /Carry only what is truly open/)
  assert.match(client, /Enoughness Gate/)
  assert.match(client, /<h3>Future \{person\}<\/h3>/)
  assert.match(client, /Sync freshness/)
})

test('only adults can open member-page chore assignment and the API prevents cross-assignment', async () => {
  const [client, api] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(apiPath, 'utf8'),
  ])

  assert.match(client, /actorIsAdult[\s\S]*Assign a chore/)
  assert.match(client, /initialOwnerMemberId/)
  assert.match(api, /const ownerId=adult\(member\)\?requestedOwner:member\.id/)
  assert.match(api, /dishwasher/)
})

test('Next 7 does not duplicate chores or work tasks in a Prepare Decide board', async () => {
  const client = await readFile(clientPath, 'utf8')

  assert.doesNotMatch(client, /Prepare \/ decide/)
  assert.match(client, /const weekIssueCount = coordination\.length/)
  assert.match(client, /openAttention\(nextDecision\)/)
  assert.match(client, /function isFamilyWeekItem/)
  assert.match(client, /if \(item\.item_type === "task"\) return false/)
  assert.doesNotMatch(client, /day\.tasks\?\.map/)
})
