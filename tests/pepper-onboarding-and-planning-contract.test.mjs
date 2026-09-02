import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationPath = new URL(
  '../supabase/migrations/20260902113000_add_member_setup_profiles.sql',
  import.meta.url,
)
const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)

test('member onboarding context is private and canonical', async () => {
  const migration = await readFile(migrationPath, 'utf8')

  assert.match(migration, /create table if not exists private\.member_setup_profiles/)
  assert.match(migration, /activities text\[\]/)
  assert.match(migration, /school_name text/)
  assert.match(migration, /dietary_preferences text\[\]/)
  assert.match(migration, /medications text\[\]/)
  assert.match(migration, /goals text\[\]/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all .* anon, authenticated/)
})

test('family API enforces setup, personal-task, and meal-planning ownership', async () => {
  const api = await readFile(apiPath, 'utf8')

  assert.match(api, /action==='member_setup_save'/)
  assert.match(api, /Only an adult can add or edit another family member/)
  assert.match(api, /action==='personal_task_create'/)
  assert.match(api, /visibility[^\n]*'private'/)
  assert.match(api, /owner_member_id[^\n]*member\.id/)
  assert.match(api, /action==='meal_plan_generate'/)
  assert.match(api, /Only an adult can generate the family meal plan/)
  assert.match(api, /family_meal_needs/)
  assert.match(api, /insert into public\.groceries/)
  assert.match(api, /from public\.household_members m/)
  assert.match(api, /left join private\.member_setup_profiles p/)
  assert.match(api, /left join lateral[\s\S]*private\.school_profiles/)
})

test('Pepper exposes Family Setup, personal to-dos, and weekly generation', async () => {
  const client = await readFile(clientPath, 'utf8')

  assert.match(client, /Family setup/)
  assert.match(client, /Add family member/)
  assert.match(client, /Activities/)
  assert.match(client, /Dietary preferences/)
  assert.match(client, /Medications/)
  assert.match(client, /Goals/)
  assert.match(client, /Add my to-do/)
  assert.match(client, /action: "personal_task_create"/)
  assert.match(client, /Plan my week/)
  assert.match(client, /action: "meal_plan_generate"/)
})
