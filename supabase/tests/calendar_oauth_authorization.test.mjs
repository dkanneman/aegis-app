import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'

const endpoint = 'http://127.0.0.1:54339/functions/v1/pepper-calendar/'
const control = 'http://127.0.0.1:54339/__test/'
const psql = process.env.PSQL_BIN
assert.ok(psql, 'Local-only psql adapter required')
const q = statement => execFileSync(psql, ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim()
const member = randomUUID(), token = randomUUID(), household = randomUUID()
q(`insert into public.households(id,slug,name) values('${household}','auth-${household}','[PEPPER TEST] OAuth authorization');
   insert into public.household_members(id,household_id,slug,display_name,role) values('${member}','${household}','adult','[PEPPER TEST] Adult','adult_admin');
   insert into public.member_sessions(token,member_id,expires_at) values('${token}','${member}',now()+interval '1 day')`)
const hash = value => createHash('sha256').update(value).digest('hex')
async function reset(config = {}) {
  q(`update public.member_sessions set revoked_at=null, expires_at=now()+interval '1 day' where token='${token}'; update public.household_members set active=true, removed_at=null, role='adult_admin' where id='${member}'`)
  await fetch(control+'reset', { method: 'POST', body: JSON.stringify(config) })
}
async function start() {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', session_token: token }) })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return new URL(body.authorization_url).searchParams.get('state')
}
async function callback(state) {
  const response = await fetch(endpoint+'callback?code=LOCAL_ONLY&state='+state, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 303)
  return new URL(response.headers.get('location'))
}
const counts = () => q(`select json_build_array((select count(*) from public.calendar_connections),(select count(*) from private.calendar_tokens),(select count(*) from public.audit_log))`)

test('revoked initiating session is rejected before exchange or connection writes', async () => {
  await reset()
  const before = counts(), state = await start()
  q(`update public.member_sessions set revoked_at=now() where token='${token}'`)
  // Another active session for the same adult must not rescue this OAuth state.
  const otherToken=randomUUID()
  q(`insert into public.member_sessions(token,member_id,expires_at) values('${otherToken}','${member}',now()+interval '1 day')`)
  try {
    const result = await callback(state)
    const metrics = await (await fetch(control+'metrics')).json()
    console.log(JSON.stringify({ revokedCallback: result.searchParams.get('reason'), exchanges: metrics.exchanges, unchanged: counts() === before }))
    assert.equal(metrics.exchanges, 0)
    assert.equal(result.searchParams.get('reason'), 'oauth_initiator_unauthorized')
    assert.equal(counts(), before)
    assert.equal((await callback(state)).searchParams.get('reason'), 'invalid_state')
  } finally { q(`delete from public.member_sessions where token='${otherToken}'`); await reset() }
})

if (!process.env.PEPPER_REPRO_ONLY) {
  test('deleted initiating session nulls its binding and cannot be replaced', async () => {
    await reset()
    const before=counts(), state=await start()
    q(`delete from public.member_sessions where token='${token}'; insert into public.member_sessions(token,member_id,expires_at) values('${token}','${member}',now()+interval '1 day')`)
    assert.equal(q(`select initiating_session_id is null from private.calendar_oauth_states where state_hash='${hash(state)}'`),'t')
    assert.equal((await callback(state)).searchParams.get('reason'),'oauth_initiator_unauthorized')
    assert.equal((await (await fetch(control+'metrics')).json()).exchanges,0)
    assert.equal(counts(),before)
  })
  for (const [name, change] of [
    ['expired', `update public.member_sessions set expires_at=now()-interval '1 second' where token='${token}'`],
    ['inactive/removed', `update public.household_members set active=false, removed_at=now() where id='${member}'`],
    ['child', `update public.household_members set role='child' where id='${member}'`],
    ['unbound legacy state', null],
    ['wrong household', 'household'],
    ['wrong member', 'member'],
  ]) test(`${name} initiator fails closed with no exchange/write`, async () => {
    await reset()
    const before=counts(), state=await start()
    if (change === 'household') q(`update private.calendar_oauth_states set household_id='90000000-0000-4000-8000-000000000001' where state_hash='${hash(state)}'`)
    else if (change === 'member') q(`update private.calendar_oauth_states set member_id='00000000-0000-4000-8000-000000000014' where state_hash='${hash(state)}'`)
    else if (change) q(change)
    else q(`update private.calendar_oauth_states set initiating_session_id=null where state_hash='${hash(state)}'`)
    try {
      assert.equal((await callback(state)).searchParams.get('reason'), 'oauth_initiator_unauthorized')
      assert.equal((await (await fetch(control+'metrics')).json()).exchanges, 0)
      assert.equal(counts(), before)
    } finally { await reset() }
  })
  test('authorized callback exchanges once; replay cannot exchange again', async () => {
    await reset()
    const state=await start()
    assert.equal(q(`select s.session_id=o.initiating_session_id from private.calendar_oauth_states o join public.member_sessions s on s.token='${token}' where o.state_hash='${hash(state)}'`), 't')
    const results=await Promise.all([callback(state), callback(state)])
    assert.deepEqual(results.map(r=>r.searchParams.get('reason')).sort(), ['invalid_state', 'oauth_exchange_failed'])
    assert.equal((await (await fetch(control+'metrics')).json()).exchanges, 1)
  })
  test('valid signed identity and probe activate; revocation during probe cannot activate', async () => {
    // Only a synthetic fixture household is touched, never the preview household.
    assert.equal(q(`select count(*) from public.calendar_connections where household_id='${household}'`), '0')
    for (const revoke of [false, true]) {
      await reset()
      const state=await start(), session=q(`select session_id from public.member_sessions where token='${token}'`)
      await fetch(control+'reset', {method:'POST', body:JSON.stringify({success:true,nonce:hash(state),revokeAfterProbe:revoke?session:null})})
      const auditBefore=q(`select count(*) from public.audit_log where household_id='${household}' and event_type='calendar.connected'`)
      try {
        const result=await callback(state)
        assert.equal(result.searchParams.get('calendar'), revoke?'error':'connected', result.href)
        const active=q(`select count(*) from public.calendar_connections where household_id='${household}' and status='connected' and jsonb_typeof(calendar_probe_evidence)='object' and calendar_probe_evidence->>'success'='true'`)
        assert.equal(active,revoke?'0':'1')
        if(revoke) {
          assert.equal(result.searchParams.get('reason'),'oauth_initiator_unauthorized')
          assert.equal(q(`select count(*) from public.audit_log where household_id='${household}' and event_type='calendar.connected'`),auditBefore)
          assert.equal(q(`select count(*) from private.calendar_tokens t join public.calendar_connections c on c.id=t.connection_id where c.household_id='${household}'`),'0')
        }
      } finally {
        q(`delete from vault.secrets where id in(select t.vault_secret_id from private.calendar_tokens t join public.calendar_connections c on c.id=t.connection_id where c.household_id='${household}'); delete from public.calendar_connections where household_id='${household}'`)
        await reset()
      }
    }
  })
  test('revocation after exchange prevents calendar creation and pending persistence', async () => {
    await reset()
    const before=counts(), state=await start(), session=q(`select session_id from public.member_sessions where token='${token}'`)
    await fetch(control+'reset', {method:'POST',body:JSON.stringify({success:true,nonce:hash(state),revokeAfterExchange:session})})
    try {
      assert.equal((await callback(state)).searchParams.get('reason'),'oauth_initiator_unauthorized')
      const metrics=await (await fetch(control+'metrics')).json()
      assert.equal(metrics.exchanges,1)
      assert.equal(metrics.calls.filter(c=>c.path.startsWith('/calendar/')).length,0)
      assert.equal(counts(),before)
    } finally { await reset() }
  })
}
