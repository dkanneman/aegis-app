import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)
const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const migrationPath = new URL(
  '../supabase/migrations/20260901214500_connect_meals_groceries_and_family_needs.sql',
  import.meta.url,
)
const normalizedGroceriesMigrationPath = new URL(
  '../supabase/migrations/20260908213000_normalize_open_groceries.sql',
  import.meta.url,
)

test('One Brain links groceries to meals, owners, and family meal needs', async () => {
  const migration = await readFile(migrationPath, 'utf8')

  assert.match(migration, /shopping_owner_member_id uuid/)
  assert.match(migration, /owner_member_id uuid/)
  assert.match(migration, /meal_plan_id uuid/)
  assert.match(migration, /create table if not exists public\.family_meal_needs/)
  assert.match(migration, /alter table public\.family_meal_needs enable row level security/)
})

test('family API exposes and mutates the connected meal workflow', async () => {
  const api = await readFile(apiPath, 'utf8')

  assert.match(api, /async function mealState/)
  assert.match(api, /action==='meal_upsert'/)
  assert.match(api, /action==='meal_need_upsert'/)
  assert.match(api, /action==='grocery_create'/)
  assert.match(api, /action==='grocery_update'/)
  assert.match(api, /state\.meals=/)
  assert.match(api, /state\.mealNeeds=/)
  assert.match(api, /wantsMealPlanRefresh/)
  assert.match(api, /meal_week_refreshed/)
  assert.match(api, /grocery_count/)
  assert.match(api, /origin='manual'/)
  assert.match(api, /was already open, so the existing grocery was kept/)
  assert.match(api, /merged:resultId!==id/)
})

test('One Brain enforces one open grocery row per household and records provenance', async () => {
  const migration = await readFile(normalizedGroceriesMigrationPath, 'utf8')

  assert.match(migration, /add column if not exists origin text/)
  assert.match(migration, /delete from public\.groceries grocery/)
  assert.match(migration, /create unique index if not exists groceries_one_open_item_per_household_idx/)
  assert.match(migration, /lower\(btrim\(item\)\)/)
  assert.match(migration, /where status = 'open'/)
})

test('Pepper presents meals and assignable groceries as one workflow', async () => {
  const client = await readFile(clientPath, 'utf8')

  assert.match(client, /\| "meals"/)
  assert.match(client, /\["meals", "Meals"/)
  assert.match(client, /function MealsPage/)
  assert.match(client, /action: "meal_upsert"/)
  assert.match(client, /action: "meal_need_upsert"/)
  assert.match(client, /action: "grocery_create"/)
  assert.match(client, /action: "grocery_update"/)
  assert.match(client, /Refresh week/)
  assert.match(client, /unique groceries/)
})
