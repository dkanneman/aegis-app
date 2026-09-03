import postgres from 'npm:postgres@3.4.7'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { ssl:'require', prepare:false, max:1, idle_timeout:20, connect_timeout:10 })
const TZ = 'America/Los_Angeles'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-pepper-session','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'}

function dateLA(d=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d) }
function addDays(date:string,n:number){ const [y,m,d]=date.split('-').map(Number); return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10) }
function daysBetween(a:string,b:string){ return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000) }
function clean(s:any){ return String(s||'').trim() }
async function member(req:Request){ const token=req.headers.get('x-pepper-session')||''; if(!UUID.test(token))return null; const rows=await sql<any[]>`select m.id,m.household_id,m.slug,m.display_name,m.role from public.member_sessions s join public.household_members m on m.id=s.member_id where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now() limit 1`; return rows[0]||null }

type Rule = { category:string; action_kind:string; lead_days:number; re:RegExp; title:(source:string)=>string; summary:(source:string,days:number)=>string }
const rules:Rule[] = [
  { category:'birthday', action_kind:'gift', lead_days:21, re:/\b(birthday|bday)\b/i,
    title:(s)=>`Handle gifts for ${s}`,
    summary:(s,d)=>`${s} is ${d} day${d===1?'':'s'} away. This is the right window to handle gifts, a card, or the celebration plan.` },
  { category:'party', action_kind:'invitations', lead_days:28, re:/\b(party|celebration|open house|shower)\b/i,
    title:(s)=>`Send invitations for ${s}`,
    summary:(s,d)=>`${s} is ${d} day${d===1?'':'s'} away. Invitations should go out now so the event does not become a last-minute scramble.` },
  { category:'travel', action_kind:'travel_prep', lead_days:14, re:/\b(trip|vacation|flight|disneyland|travel|hotel)\b/i,
    title:(s)=>`Prepare for ${s}`,
    summary:(s,d)=>`${s} is ${d} day${d===1?'':'s'} away. Check bookings, transportation, pet care, packing, and anything the family needs before departure.` },
  { category:'appointment', action_kind:'appointment_prep', lead_days:3, re:/\b(doctor|dentist|orthodont|appointment|therapy|physical)\b/i,
    title:(s)=>`Get ready for ${s}`,
    summary:(s,d)=>`${s} is coming in ${d} day${d===1?'':'s'}. Check forms, records, prescriptions, transportation, and anything to bring.` },
  { category:'school', action_kind:'school_prep', lead_days:5, re:/\b(back[- ]to[- ]school|field trip|picture day|school event|school night|open house|orientation)\b/i,
    title:(s)=>`Prepare for ${s}`,
    summary:(s,d)=>`${s} is ${d} day${d===1?'':'s'} away. Check forms, supplies, timing, clothing, and transportation before it becomes urgent.` },
  { category:'performance', action_kind:'event_prep', lead_days:3, re:/\b(recital|performance|opening night|concert|race|meet|tournament|show)\b/i,
    title:(s)=>`Prepare for ${s}`,
    summary:(s,d)=>`${s} is ${d} day${d===1?'':'s'} away. Confirm call time, gear or clothing, tickets, food, and transportation.` },
]

function inferRule(title:string){ return rules.find(r=>r.re.test(title))||null }

async function refresh(householdId:string){
  const today=dateLA(), horizon=addDays(today,90)
  const [events,watch] = await Promise.all([
    sql<any[]>`select id,title,starts_at,visibility,owner_member_id,source,status from public.events where household_id=${householdId}::uuid and deleted_at is null and status in ('tentative','confirmed') and starts_at >= (${today}::date::timestamp at time zone ${TZ}) and starts_at < ((${horizon}::date + 1)::timestamp at time zone ${TZ}) order by starts_at`,
    sql<any[]>`select id,title,category,starts_on::text,preparation_required,preparation_summary,prep_lead_days,owner_member_id,visibility,source,source_ref,confidence from private.future_watch_items where household_id=${householdId}::uuid and status not in ('canceled','completed') and starts_on between ${today}::date and ${horizon}::date order by starts_on`
  ])
  const seen:string[]=[]

  for(const w of watch||[]){
    if(!w.preparation_required) continue
    const lead=Math.max(0,Number(w.prep_lead_days||0)), eventOn=String(w.starts_on), actOn=addDays(eventOn,-lead)
    const fingerprint=`future_watch:${w.id}:${eventOn}:${lead}`; seen.push(fingerprint)
    const title=`Prepare for ${clean(w.title)}`
    const summary=clean(w.preparation_summary)||`${clean(w.title)} needs preparation before ${eventOn}.`
    await sql`insert into public.preparation_actions(household_id,source_type,source_watch_id,source_ref,source_visibility,owner_member_id,category,action_kind,title,summary,event_on,act_on,lead_days,status,confidence,fingerprint,updated_at)
      values(${householdId}::uuid,'future_watch',${w.id}::uuid,${w.source_ref||null},${w.visibility||'household'},${w.owner_member_id}::uuid,${w.category||'future'},'prepare',${title},${summary},${eventOn}::date,${actOn}::date,${lead},'open',${Number(w.confidence||0.9)},${fingerprint},now())
      on conflict(household_id,fingerprint) do update set title=excluded.title,summary=excluded.summary,event_on=excluded.event_on,act_on=excluded.act_on,lead_days=excluded.lead_days,source_visibility=excluded.source_visibility,owner_member_id=excluded.owner_member_id,updated_at=now(),status=case when public.preparation_actions.status in ('handled','dismissed') then public.preparation_actions.status else 'open' end`
  }

  for(const e of events||[]){
    const title=clean(e.title); const rule=inferRule(title); if(!rule) continue
    const eventOn=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.starts_at))
    const d=daysBetween(today,eventOn)
    if(d<0||d>90) continue
    const actOn=addDays(eventOn,-rule.lead_days)
    const fingerprint=`event:${e.id}:${rule.action_kind}:${eventOn}`; seen.push(fingerprint)
    await sql`insert into public.preparation_actions(household_id,source_type,source_event_id,source_visibility,owner_member_id,category,action_kind,title,summary,event_on,act_on,lead_days,status,confidence,fingerprint,updated_at)
      values(${householdId}::uuid,'event',${e.id}::uuid,${e.visibility||'household'},${e.owner_member_id}::uuid,${rule.category},${rule.action_kind},${rule.title(title)},${rule.summary(title,d)},${eventOn}::date,${actOn}::date,${rule.lead_days},'open',0.82,${fingerprint},now())
      on conflict(household_id,fingerprint) do update set title=excluded.title,summary=excluded.summary,event_on=excluded.event_on,act_on=excluded.act_on,lead_days=excluded.lead_days,source_visibility=excluded.source_visibility,owner_member_id=excluded.owner_member_id,updated_at=now(),status=case when public.preparation_actions.status in ('handled','dismissed') then public.preparation_actions.status else 'open' end`
  }

  await sql`update public.preparation_actions set status='resolved',updated_at=now() where household_id=${householdId}::uuid and source_type in ('event','future_watch') and status='open' and not(fingerprint=any(${seen}::text[]))`
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors})
  if(req.method!=='POST') return new Response(JSON.stringify({error:'Method not allowed.'}),{status:405,headers:cors})
  try{
    const m=await member(req); if(!m) return new Response(JSON.stringify({error:'Pepper session required.'}),{status:401,headers:cors})
    let b:any={}; try{b=await req.json()}catch{}
    const action=String(b?.action||'list')
    if(action==='handle'||action==='dismiss'){
      if(!UUID.test(String(b.id||''))) return new Response(JSON.stringify({error:'Preparation action id required.'}),{status:400,headers:cors})
      const next=action==='handle'?'handled':'dismissed'
      await sql`update public.preparation_actions set status=${next},handled_at=case when ${next}='handled' then now() else handled_at end,updated_at=now() where id=${b.id}::uuid and household_id=${m.household_id}::uuid and (source_visibility='household' or owner_member_id=${m.id}::uuid)`
    }
    await refresh(m.household_id)
    const today=dateLA()
    const rows=await sql<any[]>`select id,source_type,category,action_kind,title,summary,event_on::text,act_on::text,lead_days,status,confidence from public.preparation_actions where household_id=${m.household_id}::uuid and status='open' and event_on>=${today}::date and (source_visibility='household' or owner_member_id=${m.id}::uuid) order by act_on,event_on limit 60`
    const nowActions=rows.filter((x:any)=>x.act_on<=today)
    const watching=rows.filter((x:any)=>x.act_on>today).slice(0,12)
    return new Response(JSON.stringify({ok:true,today,now:nowActions,watching}),{headers:cors})
  }catch(e){ console.error(e); return new Response(JSON.stringify({error:e instanceof Error?e.message:'Pepper could not build preparation actions.'}),{status:500,headers:cors}) }
})
