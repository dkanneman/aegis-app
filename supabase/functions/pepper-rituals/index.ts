import postgres from 'npm:postgres@3.4.7'

const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{ssl:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})
const TZ='America/Los_Angeles'
const APP='https://pepper-family-beta.vercel.app/pepper'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-pepper-session','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'}
function dateLA(d=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function addDays(date:string,n:number){const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10)}
function localDate(ts:string){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts))}
function timeLabel(ts:string){return new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(new Date(ts))}
async function member(req:Request){const token=req.headers.get('x-pepper-session')||'';if(!UUID.test(token))return null;const rows=await sql<any[]>`select m.id,m.household_id,m.slug,m.display_name,m.role from public.member_sessions s join public.household_members m on m.id=s.member_id where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now() limit 1`;return rows[0]||null}
function validTime(v:any){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''))}

async function preferences(memberId:string){
  const rows=await sql<any[]>`select morning_brief_enabled,morning_channel,morning_local_time::text,evening_reflection_enabled,evening_channel,evening_local_time::text,timezone from private.member_ritual_preferences where member_id=${memberId}::uuid limit 1`
  return rows[0]||{morning_brief_enabled:false,morning_channel:null,morning_local_time:null,evening_reflection_enabled:false,evening_channel:null,evening_local_time:null,timezone:TZ}
}

async function build(m:any){
  const today=dateLA(),tomorrow=addDays(today,1),dayAfter=addDays(today,2)
  const [events,tasks,prep,consequences] = await Promise.all([
    sql<any[]>`select id,title,starts_at,ends_at,location,person_slug,kind,visibility,owner_member_id from public.events where household_id=${m.household_id}::uuid and status<>'canceled' and starts_at >= (${today}::date::timestamp at time zone ${TZ}) and starts_at < ((${dayAfter}::date + 1)::timestamp at time zone ${TZ}) and (visibility='household' or owner_member_id=${m.id}::uuid) order by starts_at`,
    sql<any[]>`select id,title,status,due_at,updated_at,visibility,owner_member_id from public.tasks where household_id=${m.household_id}::uuid and (visibility='household' or owner_member_id=${m.id}::uuid) and ((due_at is not null and due_at >= (${today}::date::timestamp at time zone ${TZ}) and due_at < ((${dayAfter}::date + 1)::timestamp at time zone ${TZ})) or (status='completed' and updated_at >= (${today}::date::timestamp at time zone ${TZ}))) order by due_at nulls last`,
    sql<any[]>`select id,title,summary,event_on::text,act_on::text,category,action_kind from public.preparation_actions where household_id=${m.household_id}::uuid and status='open' and act_on<=${today}::date and event_on>=${today}::date and (source_visibility='household' or owner_member_id=${m.id}::uuid) order by act_on,event_on limit 8`,
    sql<any[]>`select id,title,summary,severity,metadata from public.consequences where household_id=${m.household_id}::uuid and status='open' order by case severity when 'urgent' then 0 when 'needs_attention' then 1 else 2 end,last_seen_at desc`
  ])
  const todayEvents=events.filter((e:any)=>localDate(e.starts_at)===today)
  const tomorrowEvents=events.filter((e:any)=>localDate(e.starts_at)===tomorrow)
  const dueToday=tasks.filter((t:any)=>t.due_at&&localDate(t.due_at)===today&&t.status!=='completed')
  const completedToday=tasks.filter((t:any)=>t.status==='completed'&&localDate(t.updated_at)===today)
  const nearConsequences=(consequences||[]).filter((c:any)=>{const ts=c.metadata?.starts_at||c.metadata?.overlap_start;return !ts||new Date(ts).getTime()<=Date.now()+72*3600000}).slice(0,4)
  const tomorrowOpen=tomorrowEvents.length>0
  const morningHeadline=nearConsequences.length?`${nearConsequences.length} thing${nearConsequences.length===1?'':'s'} need attention.`:prep.length?`${prep.length} thing${prep.length===1?' is':'s are'} worth handling before they become urgent.`:todayEvents.length?`Today is covered from what Pepper currently knows.`:`Today looks open from what Pepper currently knows.`
  const morning={
    title:`Good morning, ${m.display_name}.`,
    headline:morningHeadline,
    today_events:todayEvents.slice(0,8).map((e:any)=>({id:e.id,title:e.title,time:timeLabel(e.starts_at),starts_at:e.starts_at,location:e.location||null})),
    due_today:dueToday.slice(0,6).map((t:any)=>({id:t.id,title:t.title,due_at:t.due_at})),
    attention:nearConsequences,
    preparation:prep.slice(0,6),
    tomorrow:{status:tomorrowOpen?'planned':'quiet',headline:nearConsequences.length?'Tomorrow is still being checked.':tomorrowEvents.length?`${tomorrowEvents.length} known plan${tomorrowEvents.length===1?'':'s'} tomorrow.`:'Nothing unusual is loaded for tomorrow yet.',events:tomorrowEvents.slice(0,5).map((e:any)=>({id:e.id,title:e.title,time:timeLabel(e.starts_at),starts_at:e.starts_at}))},
    deep_link:`${APP}?ritual=morning`
  }
  const evening={
    title:'Before you are done for today…',
    prompt:'What changed today that Pepper should remember? What went well, what felt hard, or what matters for tomorrow?',
    handled_today:completedToday.length,
    today_events:todayEvents.length,
    tomorrow_headline:tomorrowEvents.length?`${tomorrowEvents.length} known plan${tomorrowEvents.length===1?'':'s'} tomorrow.`:'Tomorrow is still fairly open from what Pepper knows.',
    deep_link:`${APP}?ritual=evening`
  }
  return {morning,evening}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
  if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed.'}),{status:405,headers:cors})
  try{
    const m=await member(req);if(!m)return new Response(JSON.stringify({error:'Pepper session required.'}),{status:401,headers:cors})
    let b:any={};try{b=await req.json()}catch{}
    const action=String(b?.action||'get')
    if(action==='set_preferences'){
      const mc=b.morning_channel==null?null:String(b.morning_channel),ec=b.evening_channel==null?null:String(b.evening_channel)
      if(mc&&!['app','email'].includes(mc))return new Response(JSON.stringify({error:'Invalid morning channel.'}),{status:400,headers:cors})
      if(ec&&!['app','email'].includes(ec))return new Response(JSON.stringify({error:'Invalid evening channel.'}),{status:400,headers:cors})
      if(b.morning_local_time&&!validTime(b.morning_local_time))return new Response(JSON.stringify({error:'Morning time must be HH:MM.'}),{status:400,headers:cors})
      if(b.evening_local_time&&!validTime(b.evening_local_time))return new Response(JSON.stringify({error:'Evening time must be HH:MM.'}),{status:400,headers:cors})
      await sql`insert into private.member_ritual_preferences(member_id,morning_brief_enabled,morning_channel,morning_local_time,evening_reflection_enabled,evening_channel,evening_local_time,timezone,updated_at) values(${m.id}::uuid,${Boolean(b.morning_brief_enabled)},${mc},${b.morning_local_time||null}::time,${Boolean(b.evening_reflection_enabled)},${ec},${b.evening_local_time||null}::time,${b.timezone||TZ},now()) on conflict(member_id) do update set morning_brief_enabled=excluded.morning_brief_enabled,morning_channel=excluded.morning_channel,morning_local_time=excluded.morning_local_time,evening_reflection_enabled=excluded.evening_reflection_enabled,evening_channel=excluded.evening_channel,evening_local_time=excluded.evening_local_time,timezone=excluded.timezone,updated_at=now()`
    }
    const ritual=await build(m),prefs=await preferences(m.id)
    return new Response(JSON.stringify({ok:true,...ritual,preferences:prefs,delivery_status:{app:'provider_not_connected',email:'provider_not_connected'}}),{headers:cors})
  }catch(e){console.error(e);return new Response(JSON.stringify({error:e instanceof Error?e.message:'Pepper could not build the daily rituals.'}),{status:500,headers:cors})}
})
