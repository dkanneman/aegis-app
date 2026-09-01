import postgres from 'npm:postgres@3.4.7'

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||''
const DATABASE_URL=Deno.env.get('SUPABASE_DB_URL')||''
const APP_URL=Deno.env.get('PEPPER_APP_URL')||'https://pepper-v6-private-preview.vercel.app/pepper'
const APP_ORIGIN=new URL(APP_URL).origin
const GOOGLE_CLIENT_ID=Deno.env.get('GOOGLE_CLIENT_ID')||''
const GOOGLE_CLIENT_SECRET=Deno.env.get('GOOGLE_CLIENT_SECRET')||''
const SUPABASE_ANON_KEY=Deno.env.get('SUPABASE_ANON_KEY')||''
const REDIRECT_URI=`${SUPABASE_URL}/functions/v1/pepper-gmail-callback`
const GMAIL_SCOPE='openid email https://www.googleapis.com/auth/gmail.readonly'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

if(!SUPABASE_URL||!DATABASE_URL)throw new Error('Supabase runtime is not configured.')
const sql=postgres(DATABASE_URL,{ssl:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})

function headers(req:Request){
  const origin=req.headers.get('origin')||''
  const allowed=!origin||origin===APP_ORIGIN||origin.startsWith('http://localhost:')||origin.startsWith('http://127.0.0.1:')
  return {'Access-Control-Allow-Origin':allowed&&origin?origin:APP_ORIGIN,'Access-Control-Allow-Headers':'apikey,authorization,content-type,x-pepper-session','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Origin','X-Content-Type-Options':'nosniff'}
}
function json(req:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:headers(req)})}
function randomToken(bytes=32){const value=new Uint8Array(bytes);crypto.getRandomValues(value);return btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
async function digest(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function challenge(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
function configured(){return Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET)}

async function memberFromSession(token:string){
  if(!UUID.test(token))return null
  const rows=await sql<any[]>`select m.id,m.household_id,m.slug,m.display_name,m.role from public.member_sessions s join public.household_members m on m.id=s.member_id where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now() limit 1`
  return rows[0]||null
}

async function status(member:any){
  const [connections,health]=await Promise.all([
    sql<any[]>`select provider,status,access_scope,last_attempt_at,last_synced_at,last_error,metadata from public.integration_connections where household_id=${member.household_id}::uuid and member_id=${member.id}::uuid order by provider`,
    sql<any[]>`select metric_date,step_count,step_goal,active_minutes,source,source_updated_at from public.health_daily_metrics where household_id=${member.household_id}::uuid and member_id=${member.id}::uuid order by metric_date desc limit 1`,
  ])
  const byProvider=Object.fromEntries(connections.map((item:any)=>[item.provider,item]))
  return {
    gmail:{configured:configured(),connected:byProvider.gmail?.status==='connected',...(byProvider.gmail||{})},
    apple_health:{connected:byProvider.apple_health?.status==='connected',...(byProvider.apple_health||{}),latest:health[0]||null},
  }
}

async function beginGmail(member:any){
  if(!['adult_admin','adult'].includes(member.role))throw Object.assign(new Error('Only an adult can connect family email.'),{status:403})
  if(!configured())throw Object.assign(new Error('Gmail OAuth credentials are not configured in this preview yet.'),{status:503})
  const state=randomToken(),verifier=randomToken(64)
  await sql`delete from private.integration_oauth_states where expires_at<now() or consumed_at<now()-interval '1 hour'`
  await sql`insert into private.integration_oauth_states(provider,state_hash,code_verifier,household_id,member_id,expires_at) values('gmail',${await digest(state)},${verifier},${member.household_id}::uuid,${member.id}::uuid,now()+interval '10 minutes')`
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id',GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri',REDIRECT_URI)
  url.searchParams.set('response_type','code')
  url.searchParams.set('scope',GMAIL_SCOPE)
  url.searchParams.set('access_type','offline')
  url.searchParams.set('prompt','consent select_account')
  url.searchParams.set('state',state)
  url.searchParams.set('code_challenge',await challenge(verifier))
  url.searchParams.set('code_challenge_method','S256')
  return url.toString()
}

async function pairHealth(member:any){
  const token=randomToken(40),tokenHash=await digest(token)
  await sql.begin(async(tx:any)=>{
    await tx`update private.health_ingest_tokens set revoked_at=now() where member_id=${member.id}::uuid and revoked_at is null`
    await tx`insert into private.health_ingest_tokens(household_id,member_id,token_hash,label) values(${member.household_id}::uuid,${member.id}::uuid,${tokenHash},'Apple Health Shortcut')`
    await tx`insert into public.integration_connections(household_id,member_id,provider,status,access_scope,last_attempt_at,metadata) values(${member.household_id}::uuid,${member.id}::uuid,'apple_health','pending','steps active_minutes',now(),'{}'::jsonb) on conflict(household_id,member_id,provider) do update set status='pending',last_attempt_at=now(),last_error=null,updated_at=now()`
  })
  return {pairing_token:token,publishable_key:SUPABASE_ANON_KEY,ingest_url:`${SUPABASE_URL}/functions/v1/pepper-health-ingest`,status:'pending',requires:'Apple Health Shortcut or Pepper iPhone companion'}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)})
  if(req.method!=='POST')return json(req,{error:'Method not allowed.'},405)
  const member=await memberFromSession(req.headers.get('x-pepper-session')||'')
  if(!member)return json(req,{error:'Unlock Pepper again to continue.'},401)
  let body:any={};try{body=await req.json()}catch{return json(req,{error:'Invalid request.'},400)}
  try{
    if(body.action==='status')return json(req,{ok:true,...await status(member)})
    if(body.action==='gmail_start')return json(req,{ok:true,authorization_url:await beginGmail(member)})
    if(body.action==='health_pair')return json(req,{ok:true,...await pairHealth(member)})
    return json(req,{error:'Unknown integration action.'},400)
  }catch(error){return json(req,{error:error instanceof Error?error.message:'Connection failed.'},Number((error as any)?.status||500))}
})
