import postgres from 'npm:postgres@3.4.7'
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{ssl:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||''
if(!SUPABASE_URL)throw new Error('SUPABASE_URL is not configured.')
const BASE=SUPABASE_URL+'/functions/v1'
const APP_ORIGIN=Deno.env.get('PEPPER_APP_ORIGIN')||'https://pepper-v6-private-preview.vercel.app'
const SUPABASE_ANON_KEY=Deno.env.get('SUPABASE_ANON_KEY')||''
const TARGET=BASE+'/pepper-family-beta-01'
const TELL=BASE+'/pepper-tell-v2'
const CONSEQUENCES=BASE+'/pepper-consequences'
const REFLECTIONS=BASE+'/pepper-reflections'
const HORIZON=BASE+'/pepper-horizon'
const PREPARATION=BASE+'/pepper-preparation'
const RITUALS=BASE+'/pepper-rituals'
const INTEGRATIONS=BASE+'/pepper-integrations'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function previewOrigin(origin:string){try{const host=new URL(origin).hostname;return /^pepper-family-beta-[a-z0-9-]+-dkanneman-8936s-projects\.vercel\.app$/.test(host)}catch{return false}}
function cors(req:Request){const o=req.headers.get('origin')||'';const allowed=!o||o===APP_ORIGIN||previewOrigin(o)||o.startsWith('http://localhost:')||o.startsWith('http://127.0.0.1:');return {'Access-Control-Allow-Origin':allowed&&o?o:APP_ORIGIN,'Access-Control-Allow-Headers':'apikey,authorization,content-type,x-pepper-session','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Max-Age':'86400','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Origin','X-Content-Type-Options':'nosniff'}}
function json(req:Request,body:any,status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)})}
async function validSession(token:string){if(!UUID.test(token))return null;const rows=await sql<any[]>`select m.id,m.household_id,m.slug,m.display_name,m.role,s.expires_at from public.member_sessions s join public.household_members m on m.id=s.member_id where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now() limit 1`;return rows[0]||null}
async function proxy(url:string,headers:any,body:any){const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});const text=await r.text();let data:any;try{data=JSON.parse(text)}catch{data={error:text||'Pepper service error.'}}return {ok:r.ok,status:r.status,data}}
function adult(member:any){return member.role==='adult_admin'||member.role==='adult'}
async function calendarState(member:any){const rows=await sql<any[]>`select id,connected_by_member_id,provider_calendar_id,calendar_name,calendar_time_zone,status,sync_status,last_attempt_at,last_synced_at,last_error from public.calendar_connections where household_id=${member.household_id}::uuid order by updated_at desc limit 1`;const connection=rows[0]||null;return {configured:false,connected:connection?.status==='connected',connection}}
async function memberState(member:any,targetSlug:string){
  const targets=await sql<any[]>`select id,slug,display_name,role from public.household_members where household_id=${member.household_id}::uuid and slug=${targetSlug} limit 1`
  const target=targets[0]
  if(!target)throw Object.assign(new Error('Family member not found.'),{status:404})
  const [events,tasks,profiles,schoolChanges]=await Promise.all([
    sql<any[]>`select e.id,e.title,e.person_slug,e.starts_at,e.ends_at,e.location,e.status,e.visibility,e.owner_member_id,e.kind,e.transport_owner_member_id,e.transport_status,e.source from public.events e where e.household_id=${member.household_id}::uuid and e.starts_at>=now()-interval '1 day' and e.starts_at<now()+interval '31 days' and (e.person_slug=${target.slug} or e.owner_member_id=${target.id}::uuid or e.transport_owner_member_id=${target.id}::uuid) and (e.visibility='household' or e.owner_member_id=${member.id}::uuid) order by e.starts_at limit 120`,
    sql<any[]>`select t.id,t.title,t.owner_member_id,t.creator_member_id,t.visibility,t.status,t.due_at,t.source,t.updated_at,t.created_at,t.area,t.project,t.priority,t.classification,t.tags,t.notes,t.waiting_on,t.recurrence,t.completed_at,t.next_action from public.tasks t where t.household_id=${member.household_id}::uuid and t.owner_member_id=${target.id}::uuid and (t.visibility='household' or t.owner_member_id=${member.id}::uuid or t.creator_member_id=${member.id}::uuid) order by case t.status when 'open' then 0 when 'in_progress' then 1 when 'completed' then 2 else 3 end,t.due_at nulls last,t.updated_at desc limit 160`,
    sql<any[]>`select p.id,p.academic_year,p.school_name,p.district_name,p.grade_label,p.timezone,p.family_arrival_target_local::text,p.first_bell_local::text,p.normal_dismissal_local::text,p.first_day::text,p.last_day::text,p.source_label,p.source_url,p.source_checked_on::text from private.school_profiles p where p.household_id=${member.household_id}::uuid and p.student_member_id=${target.id}::uuid order by p.last_day desc limit 1`,
    sql<any[]>`select schedule_date::text,schedule_kind,schedule_title,day_starts_at,dismissal_at,precedence,resolution_level,source_label,source_url from private.resolve_school_schedule(${member.household_id}::uuid,(now() at time zone 'America/Los_Angeles')::date,((now() at time zone 'America/Los_Angeles')::date+interval '31 days')::date) where person_slug=${target.slug} and resolution_level='dated_exception' and transportation_impact=true order by schedule_date limit 6`,
  ])
  return {member:target,events,tasks,school:profiles[0]?{profile:profiles[0],upcoming_changes:schoolChanges}:null}
}
async function updateFamilyItem(member:any,body:any){
  const itemType=String(body.item_type||'')
  const itemId=String(body.id||'')
  const operation=String(body.operation||'')
  const ownerId=body.owner_member_id==null?'':String(body.owner_member_id)
  if(!['task','event'].includes(itemType)||!UUID.test(itemId))throw Object.assign(new Error('Invalid family item.'),{status:400})
  if(!['assign','complete','cancel','reopen'].includes(operation))throw Object.assign(new Error('Invalid update.'),{status:400})
  if(ownerId&&!UUID.test(ownerId))throw Object.assign(new Error('Invalid family member.'),{status:400})
  return sql.begin(async (tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    if(itemType==='task'){
      const rows=await tx<any[]>`select id,title,owner_member_id,creator_member_id,visibility,status from public.tasks where id=${itemId}::uuid and household_id=${member.household_id}::uuid for update`
      const item=rows[0]
      if(!item)throw Object.assign(new Error('Task not found.'),{status:404})
      const privateAllowed=item.visibility!=='private'||item.owner_member_id===member.id||item.creator_member_id===member.id
      if(!privateAllowed)throw Object.assign(new Error('That task is private.'),{status:403})
      if(operation==='assign'){
        if(item.visibility==='private')throw Object.assign(new Error('Private tasks cannot be reassigned.'),{status:403})
        if(!adult(member))throw Object.assign(new Error('Only an adult can assign a family task.'),{status:403})
        if(ownerId){
          const owners=await tx<any[]>`select id from public.household_members where id=${ownerId}::uuid and household_id=${member.household_id}::uuid limit 1`
          if(!owners[0])throw Object.assign(new Error('Choose someone in this household.'),{status:400})
          await tx`update public.tasks set owner_member_id=${ownerId}::uuid,updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
        }else{
          await tx`update public.tasks set owner_member_id=null,updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
        }
      }else{
        if(!adult(member)&&item.owner_member_id!==member.id&&item.creator_member_id!==member.id)throw Object.assign(new Error('You cannot change that task.'),{status:403})
        const status=operation==='complete'?'completed':operation==='cancel'?'canceled':'open'
        await tx`update public.tasks set status=${status},updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
      }
      const summary=operation==='assign'?`${item.title} was assigned.`:`${item.title} was ${operation==='reopen'?'reopened':operation+'ed'}.`
      await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,${`task_${operation}`},'task',${itemId}::uuid,${summary})`
      return {ok:true,item_type:itemType,id:itemId,operation}
    }
    const rows=await tx<any[]>`select id,title,owner_member_id,visibility,status,transport_owner_member_id from public.events where id=${itemId}::uuid and household_id=${member.household_id}::uuid for update`
    const item=rows[0]
    if(!item)throw Object.assign(new Error('Event not found.'),{status:404})
    if(item.visibility==='private'&&item.owner_member_id!==member.id)throw Object.assign(new Error('That event is private.'),{status:403})
    if(!adult(member))throw Object.assign(new Error('Only an adult can change a family event.'),{status:403})
    if(operation==='assign'){
      if(!ownerId){
        await tx`update public.events set transport_owner_member_id=null,transport_status='unassigned',updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
      }else{
        const drivers=await tx<any[]>`select id from public.household_members where id=${ownerId}::uuid and household_id=${member.household_id}::uuid and role in ('adult_admin','adult') limit 1`
        if(!drivers[0])throw Object.assign(new Error('Choose an adult driver in this household.'),{status:400})
        await tx`update public.events set transport_owner_member_id=${ownerId}::uuid,transport_status='assigned',updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
      }
    }else{
      const status=operation==='complete'?'completed':operation==='cancel'?'canceled':'confirmed'
      if(operation==='complete')await tx`update public.events set status=${status},transport_status=case when transport_owner_member_id is null then transport_status else 'completed' end,updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
      else await tx`update public.events set status=${status},updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
    }
    const summary=operation==='assign'?`${item.title} driver changed.`:`${item.title} was ${operation==='reopen'?'restored':operation+'ed'}.`
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,${`event_${operation}`},'event',${itemId}::uuid,${summary})`
    return {ok:true,item_type:itemType,id:itemId,operation}
  })
}
Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});if(req.method==='GET')return json(req,{ok:true,service:'pepper-family-api',version:'1.2',backend:'supabase',frontend:'vercel'});if(req.method!=='POST')return json(req,{error:'Method not allowed.'},405);let b:any={};try{b=await req.json()}catch{return json(req,{error:'Invalid request.'},400)}const action=String(b?.action||'');try{
if(action==='login'){const slug=String(b.member_slug||'').trim().toLowerCase(),pin=String(b.pin||'').trim(),device=String(b.device_label||'Pepper web').slice(0,120);const rows=await sql<any[]>`select public.pepper_start_family_session(${slug},${pin},${device}) as result`;const result=rows[0]?.result||{ok:false,error:'Pepper could not start this session.'};return json(req,result,result.ok?200:401)}
const token=req.headers.get('x-pepper-session')||'';const member=await validSession(token);if(!member)return json(req,{error:'Unlock Pepper again to continue.',code:'session_required'},401);await sql`update public.member_sessions set last_seen_at=now() where token=${token}::uuid`;
if(action==='logout'){await sql`update public.member_sessions set revoked_at=now() where token=${token}::uuid`;return json(req,{ok:true})}
const headers:any={'content-type':'application/json','x-pepper-session':token,apikey:SUPABASE_ANON_KEY,authorization:`Bearer ${SUPABASE_ANON_KEY}`}
if(action==='state'){
  const core=await proxy(TARGET,headers,{action:'state'});if(!core.ok)return json(req,core.data,core.status)
  const prep=await proxy(PREPARATION,headers,{action:'list'})
  const [cr,ir,hr,csr,rr,xr]=await Promise.all([proxy(CONSEQUENCES,headers,{}),proxy(REFLECTIONS,headers,{action:'weekly'}),proxy(HORIZON,headers,{}),calendarState(member),proxy(RITUALS,headers,{action:'get'}),proxy(INTEGRATIONS,headers,{action:'status'})])
  const state=core.data?.state||{};state.consequences=cr.ok&&Array.isArray(cr.data?.consequences)?cr.data.consequences:[];state.weeklyInsight=ir.ok?ir.data?.insight||null:null;state.horizon=hr.ok?hr.data:null;state.calendarStatus=csr;state.integrations=xr.ok?xr.data:{gmail:{configured:false,connected:false},apple_health:{connected:false,latest:null}};state.preparation=prep.ok?prep.data:{now:[],watching:[]};state.rituals=rr.ok?rr.data:null;
  if(state.horizon&&prep.ok&&Array.isArray(prep.data?.now)){
    const existing=Array.isArray(state.horizon.readiness)?state.horizon.readiness:[]
    const fingerprints=new Set(existing.map((x:any)=>`${x.type}|${x.title}|${x.summary}`))
    const additions=prep.data.now.map((x:any)=>({type:'preparation',severity:'prepare',date:x.act_on,title:x.title,summary:x.summary,preparation_id:x.id})).filter((x:any)=>!fingerprints.has(`${x.type}|${x.title}|${x.summary}`))
    state.horizon.readiness=[...additions,...existing]
    if(state.horizon.coverage)state.horizon.coverage.preparation_now=additions.length
  }
  state.apiVersion='1.2';return json(req,{state})
}
if(action==='member_state'){return json(req,{state:await memberState(member,String(b.member_slug||''))})}
if(action==='item_update'){return json(req,await updateFamilyItem(member,b))}
if(action==='tell'){const r=await proxy(TELL,headers,{action:'tell',text:b.text,source:b.source,idempotency_key:b.idempotency_key});return json(req,r.data,r.status)}
if(action==='capture_reviews'){const r=await proxy(TELL,headers,{action:'review_list',limit:b.limit});return json(req,r.data,r.status)}
if(action==='capture_review_resolve'){const r=await proxy(TELL,headers,{action:'review_resolve',capture_id:b.capture_id,idempotency_key:b.idempotency_key,resolution:b.resolution});return json(req,r.data,r.status)}
if(['task','grocery','reflect'].includes(action)){const r=await proxy(TARGET,headers,b);return json(req,r.data,r.status)}
if(action==='reflection_explore'){const r=await proxy(REFLECTIONS,headers,{action:'explore',insight_id:b.insight_id});return json(req,r.data,r.status)}
if(action==='reflection_weekly'){const r=await proxy(REFLECTIONS,headers,{action:'weekly'});return json(req,r.data,r.status)}
if(action==='preparation_list'){const r=await proxy(PREPARATION,headers,{action:'list'});return json(req,r.data,r.status)}
if(action==='preparation_handle'){const r=await proxy(PREPARATION,headers,{action:'handle',id:b.id});return json(req,r.data,r.status)}
if(action==='preparation_dismiss'){const r=await proxy(PREPARATION,headers,{action:'dismiss',id:b.id});return json(req,r.data,r.status)}
if(action==='rituals'){const r=await proxy(RITUALS,headers,{action:'get'});return json(req,r.data,r.status)}
if(action==='ritual_preferences'){const r=await proxy(RITUALS,headers,{action:'set_preferences',...b});return json(req,r.data,r.status)}
if(action==='horizon'){await proxy(PREPARATION,headers,{action:'list'});const r=await proxy(HORIZON,headers,{});return json(req,r.data,r.status)}
if(action==='calendar_status'){return json(req,await calendarState(member))}
if(action==='calendar_start'||action==='calendar_sync'){return json(req,{error:'Google Calendar reconnect is waiting for preview OAuth callback approval and credentials.'},503)}
if(action==='email_start'){const r=await proxy(INTEGRATIONS,headers,{action:'gmail_start'});return json(req,r.data,r.status)}
if(action==='health_pair'){const r=await proxy(INTEGRATIONS,headers,{action:'health_pair'});return json(req,r.data,r.status)}
if(action==='integration_status'){const r=await proxy(INTEGRATIONS,headers,{action:'status'});return json(req,r.data,r.status)}
return json(req,{error:'Unknown Pepper action.'},400)
}catch(e){console.error(e);const status=typeof (e as any)?.status==='number'?(e as any).status:500;return json(req,{error:e instanceof Error?e.message:'Pepper hit an unexpected error.'},status)}})
