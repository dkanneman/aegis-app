import postgres from 'npm:postgres@3.4.7'
import {beginReadSource,readSourceStatus,discoverReadCalendars,selectReadCalendars,syncReadSource,disconnectReadSource} from '../_shared/planning-source-runtime.ts'

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||''
const DATABASE_URL=Deno.env.get('SUPABASE_DB_URL')||''
const APP_URL=Deno.env.get('PEPPER_APP_URL')||'https://pepper-family-beta.vercel.app/pepper'
const APP_ORIGIN=new URL(APP_URL).origin
const GOOGLE_CLIENT_ID=Deno.env.get('GOOGLE_CLIENT_ID')||''
const GOOGLE_CLIENT_SECRET=Deno.env.get('GOOGLE_CLIENT_SECRET')||''
const SUPABASE_ANON_KEY=Deno.env.get('SUPABASE_ANON_KEY')||''
const REDIRECT_URI=`${SUPABASE_URL}/functions/v1/pepper-gmail-callback`
const readConfig={clientId:GOOGLE_CLIENT_ID,clientSecret:GOOGLE_CLIENT_SECRET,callback:REDIRECT_URI,appUrl:APP_URL}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type Member={id:string;household_id:string;slug:string;display_name:string;role:string;session_id:string}

if(!SUPABASE_URL||!DATABASE_URL)throw new Error('Supabase runtime is not configured.')
const sql=postgres(DATABASE_URL,{ssl:Deno.env.get('PEPPER_DB_SSL')==='disable'?false:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})

function headers(req:Request){
  const origin=req.headers.get('origin')||''
  const allowed=!origin||origin===APP_ORIGIN||origin.startsWith('http://localhost:')||origin.startsWith('http://127.0.0.1:')
  return {'Access-Control-Allow-Origin':allowed&&origin?origin:APP_ORIGIN,'Access-Control-Allow-Headers':'apikey,authorization,content-type,x-pepper-session','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Origin','X-Content-Type-Options':'nosniff'}
}
function json(req:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:headers(req)})}
function randomToken(bytes=32){const value=new Uint8Array(bytes);crypto.getRandomValues(value);return btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
async function digest(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function configured(){return Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET)}

async function memberFromSession(token:string){
  if(!UUID.test(token))return null
  const rows=await sql<Member[]>`select m.id,m.household_id,m.slug,m.display_name,m.role,s.session_id from public.member_sessions s join public.household_members m on m.id=s.member_id where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now() and m.active and m.removed_at is null limit 1`
  return rows[0]||null
}

async function status(member:Member){
  const health=await sql`select status,last_synced_at,last_error from public.integration_connections where household_id=${member.household_id}::uuid and member_id=${member.id}::uuid and provider='apple_health'`
  const latest=await sql`select metric_date,step_count,step_goal,active_minutes,source,source_updated_at from public.health_daily_metrics where household_id=${member.household_id}::uuid and member_id=${member.id}::uuid order by metric_date desc limit 1`
  return {apple_health:{connected:health[0]?.status==='connected',...(health[0]||{}),latest:latest[0]||null}}
}

async function pairHealth(member:Member,client:unknown){
  const nativeIOS=client==='native_ios'
  const label=nativeIOS?'Pepper iPhone':'Apple Health Shortcut'
  const token=randomToken(40),tokenHash=await digest(token)
  await sql.begin(async(tx)=>{
    await tx`update private.health_ingest_tokens set revoked_at=now() where member_id=${member.id}::uuid and revoked_at is null`
    await tx`insert into private.health_ingest_tokens(household_id,member_id,token_hash,label) values(${member.household_id}::uuid,${member.id}::uuid,${tokenHash},${label})`
    await tx`insert into public.integration_connections(household_id,member_id,provider,status,access_scope,last_attempt_at,metadata) values(${member.household_id}::uuid,${member.id}::uuid,'apple_health','pending','steps active_minutes',now(),jsonb_build_object('client',${nativeIOS?'native_ios':'shortcut'}::text)) on conflict(household_id,member_id,provider) do update set status='pending',last_attempt_at=now(),last_error=null,metadata=excluded.metadata,updated_at=now()`
  })
  return {pairing_token:token,publishable_key:SUPABASE_ANON_KEY,ingest_url:`${SUPABASE_URL}/functions/v1/pepper-health-ingest`,member_id:member.id,member_name:member.display_name,status:'pending',requires:nativeIOS?'Pepper iPhone HealthKit permission':'Apple Health Shortcut'}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)})
  if(req.method!=='POST')return json(req,{error:'Method not allowed.'},405)
  const member=await memberFromSession(req.headers.get('x-pepper-session')||'')
  if(!member)return json(req,{error:'Unlock Pepper again to continue.'},401)
  let body:Record<string,unknown>={};try{body=await req.json();if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid body')}catch{return json(req,{error:'Invalid request.'},400)}
  try{
    if(body.action==='status'){
      const legacy=await status(member)
      const sources=await readSourceStatus(sql,member)
      const gmail=sources.gmail
      return json(req,{ok:true,apple_health:legacy.apple_health,sources,gmail:{configured:configured(),connected:gmail?.status==='connected',status:gmail?.status==='connected'?'connected_and_current':gmail?.status||'not_connected',metadata:{email:gmail?.email},last_successful_scan_at:gmail?.last_success_at,last_error:gmail?.last_error}})
    }
    if(body.action==='gmail_start'||body.action==='calendar_read_start')return json(req,{ok:true,authorization_url:await beginReadSource(sql,member,body.action==='gmail_start'?'gmail':'calendar_read',body.return_target,readConfig)})
    if(body.action==='source_calendars')return json(req,{ok:true,...await discoverReadCalendars(sql,member,readConfig)})
    if(body.action==='source_select')return json(req,await selectReadCalendars(sql,member,body.calendar_ids,readConfig))
    if(body.action==='source_sync'||body.action==='source_disconnect'){
      if(body.capability!=='gmail'&&body.capability!=='calendar_read')return json(req,{error:'Unknown read source.'},400)
      if(body.action==='source_disconnect')return json(req,await disconnectReadSource(sql,member,body.capability))
      return json(req,await syncReadSource(sql,member,body.capability,readConfig))
    }
    if(body.action==='health_pair')return json(req,{ok:true,...await pairHealth(member,body.client)})
    return json(req,{error:'Unknown integration action.'},400)
  }catch(error){return json(req,{error:error instanceof Error?error.message:'Connection failed.'},Number((error as {status?:number})?.status||500))}
})
