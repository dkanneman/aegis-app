// Real PostgreSQL, dummy OAuth, strict in-process provider double; no Google traffic.
import test, {after} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {registerHooks} from 'node:module'
import {beginReadSource,finishReadSource,readSourceStatus,sourceItems,discoverReadCalendars,selectReadCalendars,syncReadSource,disconnectReadSource} from '../functions/_shared/planning-source-runtime.ts'

const url=new URL(process.env.PEPPER_TEST_DATABASE_URL||'')
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.password,'postgres')
const {default:postgres}=await import(process.env.PEPPER_TEST_POSTGRES_MODULE)
const sql=postgres(url.href,{ssl:false,prepare:false,max:2})
const household=randomUUID(),member=randomUUID(),session=randomUUID(),other=randomUUID()
const actor={id:member,household_id:household,session_id:session,role:'adult_admin'}
const config={clientId:'dummy-client',clientSecret:'dummy-secret',callback:'http://127.0.0.1:54329/functions/v1/pepper-gmail-callback',appUrl:'http://127.0.0.1:4189/pepper'}
await sql`insert into public.households(id,slug,name) values(${household},${household},'[PEPPER TEST] private sources')`
await sql`insert into public.household_members(id,household_id,slug,display_name,role) values(${member},${household},${member},'Source parent','adult_admin'),(${other},${household},${other},'Other parent','adult')`
await sql`insert into public.member_sessions(session_id,member_id,expires_at) values(${session},${member},now()+interval '1 day')`
let capability='gmail',mode='ok',exchanges=0,refreshes=0,providerWrites=0,eventCanceled=false
const calls=[]
const actualFetch=globalThis.fetch
const handlers=new Map()
globalThis.fetch=async(input,init={})=>{
  const u=new URL(String(input));calls.push(u.pathname)
  if(u.hostname==='127.0.0.1'&&handlers.has(u.pathname))return mode==='transport_failure'?Response.json({error:'test unavailable'},{status:503}):handlers.get(u.pathname)(new Request(input,init))
  if(init.method==='POST'&&u.hostname!=='oauth2.googleapis.com'){providerWrites++;throw new Error('Provider writes forbidden')}
  if(u.hostname==='oauth2.googleapis.com') {
    const body=new URLSearchParams(init.body)
    if(body.get('grant_type')==='authorization_code')exchanges++;else refreshes++
    if(mode==='expired')return Response.json({error:'invalid_grant'},{status:400})
    const scope=capability==='gmail'?'openid email https://www.googleapis.com/auth/gmail.readonly':'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly'
    return Response.json({access_token:'DUMMY-ACCESS',refresh_token:'DUMMY-REFRESH',scope:mode==='broad'?scope+' https://www.googleapis.com/auth/calendar':scope})
  }
  if(u.hostname==='openidconnect.googleapis.com')return Response.json({sub:mode==='identity'?'wrong':'synthetic-sub',email:'synthetic@example.invalid',email_verified:true})
  if(u.pathname.endsWith('/calendarList'))return Response.json({items:[{id:'source@example.invalid',summary:'Test selected',accessRole:'reader',timeZone:'America/Los_Angeles'},{id:'other@example.invalid',summary:'Not selected',accessRole:'owner'}]})
  if(u.pathname.endsWith('/events')) {
    assert.ok(u.pathname.includes(encodeURIComponent('source@example.invalid')))
    assert.equal(u.searchParams.get('singleEvents'),'true');assert.equal(u.searchParams.get('showDeleted'),'true')
    if(mode==='failure')return Response.json({error:'unavailable'},{status:503})
    return Response.json({items:[{id:'event1',summary:'[PEPPER TEST] existing',status:eventCanceled?'cancelled':'confirmed',start:{dateTime:'2026-09-30T09:00:00-07:00'},end:{dateTime:'2026-09-30T10:00:00-07:00'},iCalUID:'instance1'}]})
  }
  if(u.pathname.endsWith('/messages'))return Response.json({messages:[{id:'m1'}]})
  if(u.pathname.endsWith('/messages/m1'))return Response.json({id:'m1',threadId:'t1',internalDate:String(Date.now()),payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'School form due tomorrow'},{name:'From',value:'school@example.invalid'}],body:{data:Buffer.from('Please complete the form, due tomorrow.').toString('base64url')}}})
  throw new Error('Blocked unexpected provider route: '+u.pathname)
}
async function connect(kind='gmail') {
  capability=kind
  const start=new URL(await beginReadSource(sql,actor,kind,'pepper_ios',config))
  assert.equal(start.searchParams.get('include_granted_scopes'),'false')
  assert.equal(start.searchParams.get('code_challenge_method'),'S256')
  const callback=new URL(config.callback);callback.searchParams.set('state',start.searchParams.get('state'));callback.searchParams.set('code','dummy-code')
  return {request:new Request(callback),response:await finishReadSource(sql,new Request(callback),config)}
}
test('revoked initiating session fails before exchange and cannot persist tokens',async()=>{
  const start=new URL(await beginReadSource(sql,actor,'gmail','pepper_ios',config))
  await sql`update public.member_sessions set revoked_at=now() where session_id=${session}`
  const response=await finishReadSource(sql,new Request(config.callback+'?code=dummy&state='+start.searchParams.get('state')),config)
  assert.match(response.headers.get('location'),/source_session_error/);assert.equal(exchanges,0)
  assert.equal((await sql`select id from private.planning_source_connections where member_id=${member}`).length,0)
  await sql`update public.member_sessions set revoked_at=null where session_id=${session}`
})
test('child cannot initiate an external read; member identity comes from the authenticated session',async()=>{
  await assert.rejects(beginReadSource(sql,{...actor,role:'child'},'gmail','web',config),/adult or teen/)
})
test('valid iOS callback preserves private connection, consumes state atomically and does not claim sync',async()=>{
  const {request,response}=await connect()
  assert.match(response.headers.get('location'),/^pepper:\/\/oauth\?connection=gmail_authorized/)
  const count=exchanges
  assert.match((await finishReadSource(sql,request,config)).headers.get('location'),/source_error/)
  assert.equal(exchanges,count)
  const status=await readSourceStatus(sql,actor)
  assert.equal(status.gmail.status,'pending');assert.equal(status.gmail.last_success_at,null)
  assert.ok(!JSON.stringify(status).includes('DUMMY'))
})
test('initial email fetch and refresh persist one private suggestion without captures or tasks',async()=>{
  const before=await sql`select (select count(*) from public.events where household_id=${household}) as e,(select count(*) from public.tasks where household_id=${household}) as t,(select count(*) from public.captures where household_id=${household}) as c`
  await syncReadSource(sql,actor,'gmail',config)
  await syncReadSource(sql,actor,'gmail',config)
  const items=await sourceItems(sql,actor)
  assert.equal(items.emails.length,1);assert.equal(items.emails[0].status,'suggested');assert.match(items.emails[0].reason,/deadline/)
  assert.ok(refreshes>=2)
  assert.deepEqual(await sql`select (select count(*) from public.events where household_id=${household}) as e,(select count(*) from public.tasks where household_id=${household}) as t,(select count(*) from public.captures where household_id=${household}) as c`,before)
})
test('other parent and forged household see no private content or account metadata',async()=>{
  assert.deepEqual(await sourceItems(sql,{...actor,id:other}),{events:[],emails:[]})
  assert.deepEqual(await readSourceStatus(sql,{...actor,id:other}),{})
  assert.deepEqual(await sourceItems(sql,{...actor,household_id:randomUUID()}),{events:[],emails:[]})
})
test('selected calendar discovery, readback and replay retain one immutable event',async()=>{
  await connect('calendar_read')
  const discovered=await discoverReadCalendars(sql,actor,config);assert.equal(discovered.calendars.length,2)
  await assert.rejects(selectReadCalendars(sql,actor,['forged'],config),/unverified/)
  await selectReadCalendars(sql,actor,['source@example.invalid'],config)
  await syncReadSource(sql,actor,'calendar_read',config);await syncReadSource(sql,actor,'calendar_read',config)
  const items=await sourceItems(sql,actor)
  assert.equal(items.events.length,1);assert.equal(items.events[0].starts_at,'2026-09-30T16:00:00.000Z')
  assert.equal(items.events[0].external_calendar_id,'source@example.invalid')
})
test('failed calendar retrieval retains cached events with error, never an empty-success claim',async()=>{
  mode='failure'
  await assert.rejects(syncReadSource(sql,actor,'calendar_read',config),/retrieval failed/)
  assert.equal((await sourceItems(sql,actor)).events.length,1)
  assert.equal((await readSourceStatus(sql,actor)).calendar_read.status,'error')
  mode='ok'
})
test('refresh auth error becomes reconnect_required, mismatched identity and scope fail closed',async()=>{
  mode='expired'
  await assert.rejects(syncReadSource(sql,actor,'calendar_read',config),/Reconnect/)
  assert.equal((await readSourceStatus(sql,actor)).calendar_read.status,'reconnect_required')
  mode='identity';await assert.rejects(syncReadSource(sql,actor,'calendar_read',config),/Reconnect/)
  mode='broad';await assert.rejects(syncReadSource(sql,actor,'calendar_read',config),/retrieval failed/)
  mode='ok'
})
test('source cancellation and deselection remove only private cached inputs',async()=>{
  eventCanceled=true;await syncReadSource(sql,actor,'calendar_read',config)
  assert.equal((await sourceItems(sql,actor)).events.length,0)
  await selectReadCalendars(sql,actor,[],config)
  assert.equal((await readSourceStatus(sql,actor)).calendar_read.selected_calendars.length,0)
  assert.equal(providerWrites,0)
})
test('private source tables deny browser roles and have RLS enabled',async()=>{
  const rows=await sql`select c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') as anon,has_table_privilege('authenticated',c.oid,'SELECT') as browser from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('planning_source_connections','planning_source_oauth','planning_source_items')`
  assert.equal(rows.length,3);for(const r of rows){assert.equal(r.relrowsecurity,true);assert.equal(r.anon,false);assert.equal(r.browser,false)}
})
test('disconnect removes only the acting member capability and its Vault token without provider writes',async()=>{
  const [{vault_secret_id:secret}]=await sql`select vault_secret_id from private.planning_source_connections where member_id=${member} and capability='gmail'`
  await disconnectReadSource(sql,{...actor,id:other},'gmail')
  assert.equal((await sourceItems(sql,actor)).emails.length,1)
  await disconnectReadSource(sql,actor,'gmail')
  await disconnectReadSource(sql,actor,'gmail')
  assert.equal((await sourceItems(sql,actor)).emails.length,0)
  assert.equal((await sql`select id from vault.secrets where id=${secret}`).length,0)
  assert.ok((await readSourceStatus(sql,actor)).calendar_read)
  assert.equal(providerWrites,0)
})
test('deployed handlers authenticate, return through native OAuth, and build the private plan after reload',async()=>{
  const pools=[]
  globalThis.__pepperReadTestPools=pools
  const wrapper=`import pg from ${JSON.stringify(process.env.PEPPER_TEST_POSTGRES_MODULE)}; export default function(url,options){if(new URL(url).hostname!=='127.0.0.1')throw Error('Local database only');const sql=pg(url,options);globalThis.__pepperReadTestPools.push(sql);return sql}`
  const hooks=registerHooks({resolve(specifier,context,next){return next(specifier==='npm:postgres@3.4.7'?'data:text/javascript,'+encodeURIComponent(wrapper):specifier,context)}})
  const env={SUPABASE_DB_URL:url.href,PEPPER_DB_SSL:'disable',SUPABASE_URL:'http://127.0.0.1:54329',GOOGLE_CLIENT_ID:config.clientId,GOOGLE_CLIENT_SECRET:config.clientSecret,PEPPER_APP_URL:config.appUrl}
  let route=''
  globalThis.Deno={env:{get:key=>env[key]},serve:handler=>handlers.set(route,handler)}
  try {
    for(const name of ['pepper-integrations','pepper-gmail-callback','pepper-family-api']) {
      route='/functions/v1/'+name
      await import('../functions/'+name+'/index.ts')
    }
    const [{token}]=await sql`select token from public.member_sessions where session_id=${session}`
    const api=async(body,credential=token)=>handlers.get('/functions/v1/pepper-family-api')(new Request('http://127.0.0.1:54329/functions/v1/pepper-family-api',{method:'POST',headers:{'content-type':'application/json','x-pepper-session':credential},body:JSON.stringify(body)}))
    assert.equal((await api({action:'email_start'},randomUUID())).status,401)
    capability='gmail'
    const authorization=await (await api({action:'email_start',return_target:'pepper_ios'})).json()
    assert.ok(authorization.authorization_url)
    const state=new URL(authorization.authorization_url).searchParams.get('state')
    const callback=await handlers.get('/functions/v1/pepper-gmail-callback')(new Request(config.callback+'?code=dummy&state='+state))
    assert.equal(callback.status,303);assert.match(callback.headers.get('location'),/gmail_authorized/)
    assert.equal((await api({action:'source_sync',capability:'gmail'})).status,200)
    capability='calendar_read';eventCanceled=false
    await selectReadCalendars(sql,actor,['source@example.invalid'],config)
    await syncReadSource(sql,actor,'calendar_read',config)
    for(let i=0;i<2;i++) {
      const response=await api({action:'day_plan'})
      assert.equal(response.status,200)
      const body=await response.json()
      assert.equal(body.plan.email.relevant,1)
      assert.equal(body.plan.source_status.calendar_read.status,'connected')
      assert.ok(!JSON.stringify(body).includes('DUMMY'))
    }
    mode='transport_failure'
    const partial=await (await api({action:'day_plan',refresh_sources:true})).json()
    assert.match(partial.plan.headline,/incomplete/)
    assert.ok(partial.plan.source_warnings.some(warning=>warning.includes('could not refresh')))
    mode='ok'
    await sql`update public.member_sessions set revoked_at=now() where session_id=${session}`
    assert.equal((await api({action:'day_plan'})).status,401)
    await sql`update public.member_sessions set revoked_at=null where session_id=${session}`
    assert.equal(providerWrites,0)
  } finally {
    hooks.deregister();delete globalThis.Deno;delete globalThis.__pepperReadTestPools
    for(const pool of pools)await pool.end({timeout:2})
  }
})
after(async()=>{
  globalThis.fetch=actualFetch
  await sql`delete from vault.secrets where id in(select vault_secret_id from private.planning_source_connections where member_id=${member})`
  await sql`delete from private.planning_source_connections where member_id=${member}`
  await sql`delete from private.planning_source_oauth where member_id=${member}`
  await sql`delete from public.member_sessions where member_id=${member}`
  await sql`delete from public.household_members where household_id=${household}`
  await sql`delete from public.households where id=${household}`
  await sql.end()
})
