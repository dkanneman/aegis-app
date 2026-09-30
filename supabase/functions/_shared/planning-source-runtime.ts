import type postgres from 'npm:postgres@3.4.7'
import {assertReadScopes,READ_SCOPES,normalizeSourceEvent,deduplicateSourceEvents,emailSuggestion,type ReadCapability,type GoogleReadEvent} from './planning-sources.ts'
import {extractGmailContent,gmailHeader} from './gmail-intelligence.ts'

type Sql = ReturnType<typeof postgres>
type Member = {id:string;household_id:string;session_id:string;role:string}
type Connection = {id:string;member_id:string;household_id:string;capability:ReadCapability;subject:string;email:string;scopes:string;vault_secret_id:string;status:string;last_success_at:string|null;last_error:string|null;generation:number;selected_calendars:Calendar[]}
type Calendar = {id:string;summary:string;timeZone?:string;accessRole?:string}
type Config = {clientId:string;clientSecret:string;callback:string;appUrl:string}
type OAuth = {state_hash:string;code_verifier:string;household_id:string;member_id:string;initiator_session_id:string;capability:ReadCapability;return_target:string}
const error = (message:string,status=400) => Object.assign(new Error(message),{status})
const UUID=/^[0-9a-f-]{36}$/i
const random = () => crypto.randomUUID()+crypto.randomUUID()
export async function hashSource(value:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('')}
async function pkce(value:string) {return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}

// Provider transport has no email or calendar mutation method. Tokens never leave this module.
async function google(url:string,token?:string,form?:URLSearchParams) {
  const parsed=new URL(url)
  if (!['www.googleapis.com','gmail.googleapis.com','oauth2.googleapis.com','openidconnect.googleapis.com'].includes(parsed.hostname) || parsed.protocol!=='https:') throw error('Provider URL rejected.')
  if(form && url!=='https://oauth2.googleapis.com/token') throw error('Provider writes are prohibited.')
  const response=await fetch(url,{method:form?'POST':'GET',headers:form?{'content-type':'application/x-www-form-urlencoded'}:{authorization:`Bearer ${token}`},body:form,signal:AbortSignal.timeout(12000),redirect:'error'})
  const body=await response.json().catch(()=>null)
  if (!response.ok) {
    const reconnect=response.status===401 || body?.error==='invalid_grant' || body?.error?.errors?.some((item:{reason?:string})=>item.reason==='insufficientPermissions')
    throw error(reconnect?'Reconnect this read-only Google account.':`Google read failed (${response.status}). Retry sync; no source was changed.`,reconnect?401:502)
  }
  if (!body || typeof body!=='object') throw error('Google returned an invalid response.',502)
  return body
}
function googleItems(body:{items?:unknown;kind?:string},kind:string):unknown[] {
  if(Array.isArray(body.items))return body.items
  if(body.kind===kind&&body.items===undefined)return []
  throw error('Google returned an invalid collection.',502)
}
async function activeInitiator(sql:Sql,oauth:OAuth) {
  const rows=await sql`select 1 from public.member_sessions s join public.household_members m on m.id=s.member_id where s.session_id=${oauth.initiator_session_id}::uuid and s.member_id=${oauth.member_id}::uuid and m.household_id=${oauth.household_id}::uuid and m.active and m.removed_at is null and m.role in ('adult_admin','adult','teen') and s.revoked_at is null and s.expires_at>now()`
  return rows.length===1
}
async function owned(sql:Sql,member:Member,capability:ReadCapability) {
  const rows=await sql<Connection[]>`select * from private.planning_source_connections where member_id=${member.id}::uuid and household_id=${member.household_id}::uuid and capability=${capability} and status<>'disconnected'`
  if (!rows[0]) throw error('Connect this private source first.',409)
  return rows[0]
}
async function access(sql:Sql,connection:Connection,config:Config) {
  const secrets=await sql`select decrypted_secret from vault.decrypted_secrets where id=${connection.vault_secret_id}::uuid`
  if (!secrets[0]) throw error('Reconnect this read-only Google account.',401)
  const token=await google('https://oauth2.googleapis.com/token',undefined,new URLSearchParams({grant_type:'refresh_token',refresh_token:String(secrets[0].decrypted_secret),client_id:config.clientId,client_secret:config.clientSecret}))
  if (!token.access_token) throw error('Reconnect this read-only Google account.',401)
  assertReadScopes(connection.capability,token.scope || connection.scopes)
  const identity=await google('https://openidconnect.googleapis.com/v1/userinfo',token.access_token)
  if (identity.sub!==connection.subject || identity.email_verified!==true || String(identity.email).toLowerCase()!==connection.email.toLowerCase()) throw error('Google account identity changed. Reconnect this source.',401)
  return String(token.access_token)
}
export async function beginReadSource(sql:Sql,member:Member,capability:ReadCapability,returnTarget:unknown,config:Config) {
  if (!['adult_admin','adult','teen'].includes(member.role)) throw error('An adult or teen may connect their own account.',403)
  if (!config.clientId || !config.clientSecret) throw error('Read-only Google OAuth is not configured.',503)
  const state=random(),verifier=random(),hash=await hashSource(state)
  await sql`insert into private.planning_source_oauth(state_hash,code_verifier,household_id,member_id,initiator_session_id,capability,return_target,expires_at) values(${hash},${verifier},${member.household_id}::uuid,${member.id}::uuid,${member.session_id}::uuid,${capability},${returnTarget==='pepper_ios'?'pepper_ios':'web'},now()+interval '10 minutes')`
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth')
  for(const [key,value] of Object.entries({client_id:config.clientId,redirect_uri:config.callback,response_type:'code',scope:READ_SCOPES[capability].join(' '),access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false',state,nonce:hash,code_challenge:await pkce(verifier),code_challenge_method:'S256'})) url.searchParams.set(key,value)
  return url.toString()
}
export async function finishReadSource(sql:Sql,req:Request,config:Config) {
  const url=new URL(req.url)
  const rows=await sql<OAuth[]>`update private.planning_source_oauth set consumed_at=now() where state_hash=${await hashSource(url.searchParams.get('state')||'')} and consumed_at is null and expires_at>now() returning *`
  const oauth=rows[0]
  let result='source_error'
  const redirect=()=>{
    const target=oauth?.return_target==='pepper_ios'?new URL('pepper://oauth'):new URL(config.appUrl)
    target.searchParams.set('connection',result)
    if(oauth)target.searchParams.set('source',oauth.capability)
    return new Response(null,{status:303,headers:{Location:target.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
  }
  if(!oauth) return redirect()
  try {
    if(!await activeInitiator(sql,oauth)) throw error('The initiating Pepper session is no longer authorized.',403)
    if(!url.searchParams.get('code') || url.searchParams.has('error')) throw error('Google consent was not completed.')
    const token=await google('https://oauth2.googleapis.com/token',undefined,new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code')!,code_verifier:oauth.code_verifier,redirect_uri:config.callback,client_id:config.clientId,client_secret:config.clientSecret}))
    assertReadScopes(oauth.capability,token.scope)
    if(!token.access_token || !token.refresh_token) throw error('Google did not provide persistent read-only access. Reconnect.')
    // OIDC UserInfo is fetched directly over TLS using the newly exchanged token.
    const identity=await google('https://openidconnect.googleapis.com/v1/userinfo',String(token.access_token))
    if(!identity.sub || !identity.email || identity.email_verified!==true) throw error('Google identity could not be verified.',403)
    await sql.begin(async tx=>{
      const initiators=await tx`select s.session_id from public.member_sessions s join public.household_members m on m.id=s.member_id where s.session_id=${oauth.initiator_session_id}::uuid and s.member_id=${oauth.member_id}::uuid and m.household_id=${oauth.household_id}::uuid and m.active and m.removed_at is null and m.role in ('adult_admin','adult','teen') and s.revoked_at is null and s.expires_at>now() for update of s,m`
      if(!initiators.length)throw error('The initiating Pepper session was revoked.',403)
      const current=await tx`select * from private.planning_source_connections where member_id=${oauth.member_id}::uuid and capability=${oauth.capability} for update`
      if(current[0] && current[0].subject!==identity.sub) throw error('This source is bound to a different Google account. Disconnect it first.',409)
      const secret=await tx`select vault.create_secret(${String(token.refresh_token)}) as id`
      await tx`insert into private.planning_source_connections(household_id,member_id,capability,subject,email,scopes,vault_secret_id,status) values(${oauth.household_id}::uuid,${oauth.member_id}::uuid,${oauth.capability},${String(identity.sub)},${String(identity.email).toLowerCase()},${String(token.scope)},${secret[0].id}::uuid,'pending') on conflict(member_id,capability) do update set scopes=excluded.scopes,vault_secret_id=excluded.vault_secret_id,status='pending',last_error=null,generation=planning_source_connections.generation+1,lease_id=null,lease_until=null`
      if(current[0]?.vault_secret_id)await tx`delete from vault.secrets where id=${current[0].vault_secret_id}::uuid`
    })
    result=oauth.capability==='gmail'?'gmail_authorized':'calendar_read_authorized'
  } catch (cause) {
    // Never persist provider bodies, tokens or source contents in errors.
    const code=Number((cause as {status?:number}).status)||500
    result=code===403?'source_session_error':code===409?'source_account_error':'source_error'
  }
  return redirect()
}
export async function readSourceStatus(sql:Sql,member:Member) {
  const rows=await sql`select capability,email,status,last_success_at,last_attempt_at,last_error,selected_calendars from private.planning_source_connections where member_id=${member.id}::uuid and household_id=${member.household_id}::uuid`
  return Object.fromEntries(rows.map(r=>[r.capability,{...r,status:r.status==='connected'&&Date.now()-new Date(r.last_success_at).getTime()>30*60000?'stale':r.status}]))
}
export async function disconnectReadSource(sql:Sql,member:Member,capability:ReadCapability) {
  // Remove only this capability's private cache and token; never revoke the writer's Google grant.
  await sql.begin(async tx=>{
    const rows=await tx`delete from private.planning_source_connections where member_id=${member.id}::uuid and household_id=${member.household_id}::uuid and capability=${capability} returning vault_secret_id`
    await tx`delete from private.planning_source_oauth where member_id=${member.id}::uuid and household_id=${member.household_id}::uuid and capability=${capability}`
    for(const row of rows)await tx`delete from vault.secrets where id=${row.vault_secret_id}::uuid`
  })
  return {ok:true}
}
export async function sourceItems(sql:Sql,member:Member) {
  const rows=await sql`select c.capability,i.data from private.planning_source_items i join private.planning_source_connections c on c.id=i.connection_id where c.member_id=${member.id}::uuid and c.household_id=${member.household_id}::uuid and c.status<>'disconnected'`
  return {events:deduplicateSourceEvents(rows.filter(r=>r.capability==='calendar_read').map(r=>r.data as NonNullable<ReturnType<typeof normalizeSourceEvent>>)),emails:rows.filter(r=>r.capability==='gmail').map(r=>r.data as NonNullable<ReturnType<typeof emailSuggestion>>)}
}
export async function discoverReadCalendars(sql:Sql,member:Member,config:Config) {
  const connection=await owned(sql,member,'calendar_read'),token=await access(sql,connection,config)
  const items:Calendar[]=[]
  let page=''
  for(let n=0;n<10;n++) {
    const url=new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
    url.searchParams.set('maxResults','250');if(page)url.searchParams.set('pageToken',page)
    const body=await google(url.toString(),token)
    for(const c of googleItems(body,'calendar#calendarList') as (Calendar&{deleted?:boolean})[])if(c.id&&!c.deleted&&['reader','writer','owner'].includes(c.accessRole||''))items.push({id:c.id,summary:c.summary||c.id,timeZone:c.timeZone,accessRole:c.accessRole})
    page=body.nextPageToken||'';if(!page)return {calendars:items,selected:connection.selected_calendars.map(c=>c.id)}
  }
  throw error('Too many calendar sources; discovery did not complete.',502)
}
export async function selectReadCalendars(sql:Sql,member:Member,ids:unknown,config:Config) {
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')||ids.length>12)throw error('Select up to twelve calendars.')
  const available=await discoverReadCalendars(sql,member,config),selected=[...new Set(ids)]
  if(selected.some(id=>!available.calendars.some(c=>c.id===id)))throw error('An unverified calendar was selected.',403)
  const calendars=available.calendars.filter(c=>selected.includes(c.id))
  await sql.begin(async tx=>{
    const connections=await tx`update private.planning_source_connections set selected_calendars=${tx.json(calendars)},generation=generation+1,lease_id=null,lease_until=null,status='pending',last_success_at=null where member_id=${member.id}::uuid and household_id=${member.household_id}::uuid and capability='calendar_read' returning id`
    if(!connections[0])throw error('Reconnect the calendar source.',409)
    await tx`delete from private.planning_source_items where connection_id=${connections[0].id}::uuid`
  })
  return {ok:true}
}
export async function syncReadSource(sql:Sql,member:Member,capability:ReadCapability,config:Config) {
  const c=await owned(sql,member,capability),lease=crypto.randomUUID()
  if(!UUID.test(c.id))throw error('Invalid source identity.')
  const claimed=await sql`update private.planning_source_connections set lease_id=${lease}::uuid,lease_until=now()+interval '90 seconds',status='syncing',last_attempt_at=now() where id=${c.id}::uuid and generation=${c.generation} and (lease_until is null or lease_until<now()) returning id`
  if(!claimed.length)throw error('Sync is already running. Retry shortly.',409)
  try {
    const token=await access(sql,c,config)
    const items:{source_id:string;data:object}[]=[]
    const start=Date.now(),deadline=start+45000
    if(capability==='calendar_read') {
      for(const calendar of c.selected_calendars) {
        let page=''
        do {
          if(Date.now()>deadline)throw error('Calendar scan exceeded its safe time limit; previous results were retained.',503)
          const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`)
          for(const [key,value] of Object.entries({singleEvents:'true',showDeleted:'true',maxResults:'250',timeMin:new Date(start-7*86400000).toISOString(),timeMax:new Date(start+90*86400000).toISOString(),timeZone:calendar.timeZone||'America/Los_Angeles'}))url.searchParams.set(key,value)
          if(page)url.searchParams.set('pageToken',page)
          const body=await google(url.toString(),token)
          for(const event of googleItems(body,'calendar#events') as GoogleReadEvent[]){const data=normalizeSourceEvent(event,calendar);if(data)items.push({source_id:data.source_id,data})}
          page=body.nextPageToken||''
          if(items.length>10000)throw error('Too many events for one scan; select fewer calendars.',503)
        }while(page)
      }
    }else{
      // Bounded recent-message intake; no watches, attachments, auto-actions or provider writes.
      const page=await google('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&q='+encodeURIComponent('newer_than:7d -in:trash -in:spam'),token)
      if(page.messages!==undefined&&!Array.isArray(page.messages))throw error('Gmail returned invalid data.',502)
      const threads=new Map<string,{id:string;threadId:string;subject:string;sender:string;body:string;received_at:string}>()
      for(const message of page.messages||[]) {
        if(Date.now()>deadline)throw error('Email scan exceeded its safe time limit; previous results were retained.',503)
        const raw=await google(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=full`,token)
        const content=extractGmailContent(raw)
        const input={id:raw.id,threadId:raw.threadId,subject:gmailHeader(raw,'subject'),sender:gmailHeader(raw,'from'),body:content.bodyText||String(raw.snippet||''),received_at:new Date(Number(raw.internalDate)).toISOString()}
        const previous=threads.get(raw.threadId||raw.id)
        if(!previous||input.received_at>previous.received_at)threads.set(raw.threadId||raw.id,input)
      }
      for(const input of threads.values()){
        const data=emailSuggestion(input,c.email)
        if(data)items.push({source_id:input.id,data})
      }
    }
    await sql.begin(async tx=>{
      const current=await tx`select id from private.planning_source_connections where id=${c.id}::uuid and generation=${c.generation} and lease_id=${lease}::uuid for update`
      if(!current.length)throw error('Source selection changed during sync. Refresh again.',409)
      await tx`delete from private.planning_source_items where connection_id=${c.id}::uuid`
      for(const item of items)await tx`insert into private.planning_source_items(connection_id,source_id,data) values(${c.id}::uuid,${item.source_id},${tx.json(item.data)}) on conflict(connection_id,source_id) do update set data=excluded.data,synced_at=now()`
      await tx`update private.planning_source_connections set status='connected',last_success_at=now(),last_error=null,lease_id=null,lease_until=null where id=${c.id}::uuid`
    })
    return {ok:true,count:items.length,coverage:capability==='gmail'?'Latest 30 messages from the past 7 days':'Selected calendars: past 7 and next 90 days'}
  }catch(cause){
    const status=Number((cause as {status?:number}).status)||500
    const message=status===401?'Reconnect this read-only Google account.':status===409?'Source changed or another sync is running. Refresh again.':'Source retrieval failed. Previous results are retained; retry sync.'
    await sql`update private.planning_source_connections set status=${status===401?'reconnect_required':'error'},last_error=${message},lease_id=null,lease_until=null where id=${c.id}::uuid and lease_id=${lease}::uuid`
    throw error(message,status)
  }
}
