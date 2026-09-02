import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationPath = new URL(
  '../supabase/migrations/20260902103000_route_eriksen_costuming_to_danielle.sql',
  import.meta.url,
)

test('Steel Magnolias and Beetlejuice costuming stays with Danielle', async () => {
  const migration = await readFile(migrationPath, 'utf8')

  assert.match(migration, /household\.slug = 'eriksen'/)
  assert.match(migration, /member\.slug = 'elle'/)
  assert.match(migration, /steel\[\[:space:\]\]\+magnolias\|beetlejuice/)
  assert.match(migration, /costume\|costuming\|wardrobe/)
  assert.match(migration, /new\.owner_member_id := danielle_member_id/)
  assert.match(migration, /new\.visibility := 'private'/)
  assert.match(migration, /new\.area := 'Costuming'/)
  assert.match(migration, /before insert or update/)
  assert.match(migration, /update public\.tasks task/)
})

