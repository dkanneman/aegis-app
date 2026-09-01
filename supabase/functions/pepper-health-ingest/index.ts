import postgres from 'npm:postgres@3.4.7'

const DATABASE_URL=Deno.env.get('SUPABASE_DB_URL')||''
if(!DATABASE_URL)throw new Error('SUPABASE_DB_URL is not configured.')
const sql=postgres(DATABASE_URL,{ssl:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
async function digest(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function count(value:unknown,max:number){if(value==null)return null;const number=Number(value);if(!Number.isInteger(number)||number<0||number>max)throw new Error('Invalid health metric.');return number}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return json({error:'Method not allowed.'},405)
  const token=(req.headers.get('x-pepper-health-token')||'').trim()
  if(token.length<32)return json({error:'A valid HealthKit pairing token is required.'},401)
  const rows=await sql<any[]>`select t.id,t.household_id,t.member_id from private.health_ingest_tokens t where t.token_hash=${await digest(token)} and t.revoked_at is null and (t.expires_at is null or t.expires_at>now()) limit 1`
  const pairing=rows[0]
  if(!pairing)return json({error:'This HealthKit pairing has expired or was revoked.'},401)
  let body:any={};try{body=await req.json()}catch{return json({error:'Invalid health payload.'},400)}
  const metricDate=String(body.metric_date||'')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(metricDate))return json({error:'metric_date must be YYYY-MM-DD.'},400)
  try{
    const steps=count(body.step_count,250000)
    const goal=count(body.step_goal,250000)
    const active=count(body.active_minutes,1440)
    if(steps==null&&active==null)return json({error:'Send at least steps or active minutes.'},400)
    await sql.begin(async(tx:any)=>{
      await tx`insert into public.health_daily_metrics(household_id,member_id,metric_date,step_count,step_goal,active_minutes,source,source_updated_at) values(${pairing.household_id}::uuid,${pairing.member_id}::uuid,${metricDate}::date,${steps}::integer,${goal}::integer,${active}::integer,'apple_health',now()) on conflict(member_id,metric_date,source) do update set step_count=excluded.step_count,step_goal=excluded.step_goal,active_minutes=excluded.active_minutes,source_updated_at=now(),updated_at=now()`
      await tx`update private.health_ingest_tokens set last_used_at=now() where id=${pairing.id}::uuid`
      await tx`update public.integration_connections set status='connected',last_synced_at=now(),last_error=null,metadata=jsonb_build_object('latest_metric_date',${metricDate}::text),updated_at=now() where household_id=${pairing.household_id}::uuid and member_id=${pairing.member_id}::uuid and provider='apple_health'`
    })
    return json({ok:true,metric_date:metricDate})
  }catch(error){return json({error:error instanceof Error?error.message:'Health import failed.'},400)}
})
