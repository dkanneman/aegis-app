import postgres from 'npm:postgres@3.4.7'

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||''
const DATABASE_URL=Deno.env.get('SUPABASE_DB_URL')||''
const APP_URL=Deno.env.get('PEPPER_APP_URL')||'https://pepper-family-beta-git-codex-v6-e3b0dd-dkanneman-8936s-projects.vercel.app/pepper'
const GOOGLE_CLIENT_ID=Deno.env.get('GOOGLE_CLIENT_ID')||''
const GOOGLE_CLIENT_SECRET=Deno.env.get('GOOGLE_CLIENT_SECRET')||''
const REDIRECT_URI=`${SUPABASE_URL}/functions/v1/pepper-gmail-callback`
const GMAIL_SCOPE='openid email https://www.googleapis.com/auth/gmail.readonly'

if(!SUPABASE_URL||!DATABASE_URL)throw new Error('Supabase runtime is not configured.')
const sql=postgres(DATABASE_URL,{ssl:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})
async function digest(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function redirect(state:'gmail_connected'|'gmail_error',returnTarget:unknown='web'){if(returnTarget==='pepper_ios')return Response.redirect(`pepper://oauth?connection=${state}`,303);const target=new URL(APP_URL);target.searchParams.set('connection',state);return Response.redirect(target.toString(),303)}
async function googleJson(url:string,init:RequestInit){const response=await fetch(url,{...init,signal:AbortSignal.timeout(20000)});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(String(body?.error_description||body?.error?.message||body?.error||`Google returned ${response.status}`));return body}

Deno.serve(async(req:Request)=>{
  if(req.method!=='GET')return new Response('Method not allowed.',{status:405,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
  const url=new URL(req.url),state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||''
  const rows=await sql<any[]>`update private.integration_oauth_states set consumed_at=now() where provider='gmail' and state_hash=${await digest(state)} and consumed_at is null and expires_at>now() returning code_verifier,household_id,member_id,return_target`
  const oauth=rows[0]
  if(!oauth||!code||!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET)return redirect('gmail_error')
  try{
    const body=new URLSearchParams({code,client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,redirect_uri:REDIRECT_URI,grant_type:'authorization_code',code_verifier:oauth.code_verifier})
    const token=await googleJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body})
    if(!token.access_token||!token.refresh_token)throw new Error('Google did not return the required email access.')
    const profile=await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{authorization:`Bearer ${token.access_token}`}})
    await sql.begin(async(tx:any)=>{
      const connections=await tx<any[]>`insert into public.integration_connections(household_id,member_id,provider,status,access_scope,last_attempt_at,last_synced_at,last_error,metadata) values(${oauth.household_id}::uuid,${oauth.member_id}::uuid,'gmail','connected',${GMAIL_SCOPE},now(),now(),null,${tx.json({email:String(profile.emailAddress||''),messages_total:Number(profile.messagesTotal||0)})}) on conflict(household_id,member_id,provider) do update set status='connected',access_scope=excluded.access_scope,last_attempt_at=now(),last_synced_at=now(),last_error=null,metadata=excluded.metadata,updated_at=now() returning id`
      const connection=connections[0]
      const existing=await tx<any[]>`select vault_secret_id from private.integration_tokens where connection_id=${connection.id}::uuid limit 1`
      if(existing[0]?.vault_secret_id){
        await tx`select vault.update_secret(${existing[0].vault_secret_id}::uuid,${String(token.refresh_token)},${`pepper:gmail:${connection.id}`},'Pepper Gmail refresh token')`
        await tx`update private.integration_tokens set updated_at=now() where connection_id=${connection.id}::uuid`
      }else{
        const secret=await tx<any[]>`select vault.create_secret(${String(token.refresh_token)},${`pepper:gmail:${connection.id}`},'Pepper Gmail refresh token') as id`
        await tx`insert into private.integration_tokens(connection_id,vault_secret_id) values(${connection.id}::uuid,${secret[0].id}::uuid)`
      }
    })
    return redirect('gmail_connected',oauth.return_target)
  }catch(error){
    await sql`insert into public.integration_connections(household_id,member_id,provider,status,last_attempt_at,last_error) values(${oauth.household_id}::uuid,${oauth.member_id}::uuid,'gmail','error',now(),${error instanceof Error?error.message.slice(0,300):'Gmail connection failed.'}) on conflict(household_id,member_id,provider) do update set status='error',last_attempt_at=now(),last_error=excluded.last_error,updated_at=now()`
    return redirect('gmail_error',oauth.return_target)
  }
})
