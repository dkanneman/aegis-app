import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)
const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const migrationPath = new URL(
  '../supabase/migrations/20260901214500_connect_meals_groceries_and_family_needs.sql',
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
})
