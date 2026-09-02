import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationPath = new URL(
  '../supabase/migrations/20260902144500_add_front_seat_rotation.sql',
  import.meta.url,
)
const indexMigrationPath = new URL(
  '../supabase/migrations/20260902150500_index_front_seat_rotation_references.sql',
  import.meta.url,
)
const apiPath = new URL('../supabase/functions/pepper-family-api/index.ts', import.meta.url)
const clientPath = new URL('../app/pepper/pepper-client.tsx', import.meta.url)
const cssPath = new URL('../app/pepper/pepper.module.css', import.meta.url)

test('front-seat rotation starts with Posey and persists only exceptions and confirmations', async () => {
  const [migration, indexMigration] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(indexMigrationPath, 'utf8'),
  ])

  assert.match(migration, /create table if not exists private\.family_rotations/)
  assert.match(migration, /create table if not exists private\.family_rotation_days/)
  assert.match(migration, /date '2026-09-02'/)
  assert.match(migration, /when 'posey' then 1 when 'chloe' then 2 when 'lyra' then 3/)
  assert.match(migration, /unique \(rotation_id, rotation_date\)/)
  assert.match(migration, /status in \('planned', 'confirmed'\)/)
  assert.match(migration, /alter table private\.family_rotations enable row level security/)
  assert.match(migration, /revoke all on table private\.family_rotation_days from public, anon, authenticated/)
  assert.match(indexMigration, /family_rotations_created_by_member_idx/)
  assert.match(indexMigration, /family_rotations_updated_by_member_idx/)
  assert.match(indexMigration, /family_rotation_days_assigned_member_idx/)
  assert.match(indexMigration, /family_rotation_days_updated_by_member_idx/)
  assert.match(indexMigration, /family_rotation_days_confirmed_by_member_idx/)
})

test('family API derives the rotation and enforces adult changes with self confirmation', async () => {
  const api = await readFile(apiPath, 'utf8')

  assert.match(api, /function rotationMemberId/)
  assert.match(api, /dayDistance\(config\.anchor_date,date\)/)
  assert.match(api, /Array\.from\(\{length:7\}/)
  assert.match(api, /action==='front_seat_update'/)
  assert.match(api, /Only Danielle or Matt can change the front-seat turn/)
  assert.match(api, /member\.id!==currentMemberId/)
  assert.match(api, /front_seat_\$\{operation\}/)
  assert.match(api, /state\.frontSeat=frontSeat/)
})

test('Today presents a compact interactive front-seat rotation', async () => {
  const [client, css] = await Promise.all([
    readFile(clientPath, 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  assert.match(client, /Front seat today/)
  assert.match(client, /Posey → Chloe → Lyra/)
  assert.match(client, /Youngest to oldest, one day at a time/)
  assert.match(client, /Confirm today’s ride/)
  assert.match(client, /Restore regular turn/)
  assert.match(client, /aria-label="Choose today’s front-seat rider"/)
  assert.match(css, /\.frontSeatCard/)
  assert.match(css, /\.frontSeatChoices/)
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
})
