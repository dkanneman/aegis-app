// Required separate gate, not a skipped optional test in the fast Node suite.
// Actual HTTP handler + canonical PostgreSQL. See the local-only worker wrapper.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import test from 'node:test'

const endpoint = new URL(process.env.PEPPER_TEST_CALENDAR_URL || '')
const database = new URL(process.env.PEPPER_TEST_DATABASE_URL || '')
for (const url of [endpoint, database]) {
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'local targets only')
}
const psql = process.env.PSQL_BIN || 'psql'
function query(statement) {
  return execFileSync(psql, [database.href, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}
const adult = '10000000-0000-4000-8000-000000000011'
const member = '00000000-0000-4000-8000-000000000011'
const household = '00000000-0000-4000-8000-000000000001'
const sha = value => createHash('sha256').update(value).digest('hex')
async function start(target, session = adult) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', session_token: session, return_target: target }),
    signal: AbortSignal.timeout(15000), redirect: 'manual',
  })
  return { status: response.status, body: await response.json() }
}
async function callback(state, parameters = 'error=access_denied') {
  const url = new URL('callback', endpoint.href.endsWith('/') ? endpoint : `${endpoint}/`)
  url.search = `state=${encodeURIComponent(state)}&${parameters}`
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 303)
  return new URL(response.headers.get('location'))
}
function stored(state) {
  return JSON.parse(query(`select row_to_json(s) from private.calendar_oauth_states s where state_hash='${sha(state)}'`))
}

test('canonical OAuth schema preflight is mandatory', async () => {
  const result = await start('web')
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(query("select count(*) from information_schema.columns where table_schema='private' and table_name='calendar_oauth_states' and column_name='return_target' and is_nullable='NO' and data_type='text'"), '1')
})

for (const target of ['web', 'pepper_ios', undefined, null, 42, {}, 'https://evil.invalid', '//evil.invalid', 'PEPPER_IOS']) {
  test(`return target ${JSON.stringify(target)} persists safely and callback consumes once`, async () => {
    const result = await start(target)
    assert.equal(result.status, 200)
    assert.deepEqual(Object.keys(result.body).sort(), ['authorization_url', 'ok'])
    const url = new URL(result.body.authorization_url)
    assert.equal(url.origin, 'https://accounts.google.com')
    assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), [
      'email', 'https://www.googleapis.com/auth/calendar.app.created', 'openid',
    ])
    assert.equal(url.searchParams.get('include_granted_scopes'), 'false')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    const state = url.searchParams.get('state')
    const row = stored(state)
    assert.equal(row.return_target, target === 'pepper_ios' ? target : 'web')
    assert.equal(row.member_id, member)
    assert.equal(row.household_id, household)
    assert.equal(row.consumed_at, null)
    assert.equal(url.searchParams.get('nonce'), sha(state))
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(row.code_verifier).digest('base64url'))
    // Expiry is issued by PostgreSQL; comparing with the host clock is invalid
    // when the disposable VM clock differs. Keep the exact ten-minute contract.
    assert.equal(query(`select expires_at = created_at + interval '10 minutes'
      and expires_at > clock_timestamp()
      and expires_at <= clock_timestamp() + interval '10 minutes'
      from private.calendar_oauth_states where state_hash='${sha(state)}'`), 't')
    for (const secret of [row.code_verifier, 'pepper-local-dummy-secret', 'pepper-local-dummy-service']) {
      assert.ok(!JSON.stringify(result.body).includes(secret))
    }
    const returned = await callback(state)
    assert.equal(returned.protocol, target === 'pepper_ios' ? 'pepper:' : 'http:')
    assert.equal(returned.host, target === 'pepper_ios' ? 'oauth' : '127.0.0.1:4189')
    assert.equal(returned.searchParams.get('calendar'), 'error')
    assert.notEqual(stored(state).consumed_at, null)
    assert.equal((await callback(state)).searchParams.get('reason'), 'invalid_state')
  })
}

test('invalid session and unauthorized child create no OAuth state', async () => {
  const before = query('select count(*) from private.calendar_oauth_states')
  for (const [session, status] of [['forged', 401], ['10000000-0000-4000-8000-000000000014', 403]]) {
    assert.equal((await start('web', session)).status, status)
  }
  assert.equal(query('select count(*) from private.calendar_oauth_states'), before)
})

test('expired and mismatched states cannot be consumed', async () => {
  const result = await start('web')
  const state = new URL(result.body.authorization_url).searchParams.get('state')
  query(`update private.calendar_oauth_states set expires_at=now()-interval '1 second' where state_hash='${sha(state)}'`)
  assert.equal((await callback(state)).searchParams.get('reason'), 'invalid_state')
  assert.equal(stored(state).consumed_at, null)
  assert.equal((await callback('mismatched-state')).searchParams.get('reason'), 'invalid_state')
})

test('explicit token failure double cannot activate a connection or leak secrets', async () => {
  const before = query("select count(*) from public.calendar_connections where status='connected'")
  const result = await start('pepper_ios')
  const state = new URL(result.body.authorization_url).searchParams.get('state')
  const returned = await callback(state, 'code=LOCAL_TEST_DOUBLE')
  assert.equal(returned.protocol, 'pepper:')
  assert.equal(returned.searchParams.get('calendar'), 'error')
  assert.notEqual(stored(state).consumed_at, null)
  assert.equal(query("select count(*) from public.calendar_connections where status='connected'"), before)
  assert.ok(!returned.href.includes('pepper-local-dummy-secret'))
})

test('private OAuth states remain inaccessible to browser roles', () => {
  assert.equal(query("select relrowsecurity from pg_class where oid='private.calendar_oauth_states'::regclass"), 't')
  for (const role of ['anon', 'authenticated']) {
    assert.equal(query(`select has_table_privilege('${role}','private.calendar_oauth_states','SELECT,INSERT,UPDATE,DELETE')`), 'f')
  }
})
