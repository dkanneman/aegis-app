import postgres from 'npm:postgres@3.4.7'
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{ssl:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})
const BASE='https://olgyfgqlqrhfaujkfjtj.supabase.co/functions/v1'
const TARGET=BASE+'/pepper-family-beta-01'
const TELL=BASE+'/pepper-tell-v2'
const CONSEQUENCES=BASE+'/pepper-consequences'
const REFLECTIONS=BASE+'/pepper-reflections'
const HORIZON=BASE+'/pepper-horizon'
const CALENDAR=BASE+'/pepper-calendar'
const PREPARATION=BASE+'/pepper-preparation'
const RITUALS=BASE+'/pepper-rituals'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function cors(req:Request){const o=req.headers.get('origin')||'';const allowed=!o||o==='https://pepper-family-beta.vercel.app'||o.endsWith('.vercel.app')||o.startsWith('http://localhost:');return {'Access-Control-Allow-Origin':allowed&&o?o:'https://pepper-family-beta.vercel.app','Access-Control-Allow-Headers':'content-type,x-pepper-session','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Max-Age':'86400','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Origin','X-Content-Type-Options':'nosniff'}}
function json(req:Request,body:any,status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)})}
async function validSession(token:string){if(!UUID.test(token))return null;const rows=await sql<any[]>`select m.id,m.household_id,m.slug,m.display_name,m.role,s.expires_at from public.member_sessions s join public.household_members m on m.id=s.member_id where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now() limit 1`;return rows[0]||null}
async function proxy(url:string,headers:any,body:any){const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});const text=await r.text();let data:any;try{data=JSON.parse(text)}catch{data={error:text||'Pepper service error.'}}return {ok:r.ok,status:r.status,data}}
Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});if(req.method==='GET')return json(req,{ok:true,service:'pepper-family-api',version:'1.2',backend:'supabase',frontend:'vercel'});if(req.method!=='POST')return json(req,{error:'Method not allowed.'},405);let b:any={};try{b=await req.json()}catch{return json(req,{error:'Invalid request.'},400)}const action=String(b?.action||'');try{
if(action==='members'){const members=await sql<any[]>`select slug,display_name,role from public.household_members where household_id=(select id from public.households where slug='eriksen' limit 1) order by case slug when 'elle' then 1 when 'matt' then 2 when 'lyra' then 3 when 'chloe' then 4 when 'posey' then 5 else 9 end`;return json(req,{ok:true,members})}
if(action==='login'){const slug=String(b.member_slug||'').trim().toLowerCase(),pin=String(b.pin||'').trim(),device=String(b.device_label||'Pepper web').slice(0,120);const rows=await sql<any[]>`select public.pepper_start_family_session(${slug},${pin},${device}) as result`;const result=rows[0]?.result||{ok:false,error:'Pepper could not start this session.'};return json(req,result,result.ok?200:401)}
const token=req.headers.get('x-pepper-session')||'';const member=await validSession(token);if(!member)return json(req,{error:'Unlock Pepper again to continue.',code:'session_required'},401);await sql`update public.member_sessions set last_seen_at=now() where token=${token}::uuid`;
if(action==='logout'){await sql`update public.member_sessions set revoked_at=now() where token=${token}::uuid`;return json(req,{ok:true})}
const headers:any={'content-type':'application/json','x-pepper-session':token}
if(action==='state'){
  const core=await proxy(TARGET,headers,{action:'state'});if(!core.ok)return json(req,core.data,core.status)
  const prep=await proxy(PREPARATION,headers,{action:'list'})
  const [cr,ir,hr,csr,rr]=await Promise.all([proxy(CONSEQUENCES,headers,{}),proxy(REFLECTIONS,headers,{action:'weekly'}),proxy(HORIZON,headers,{}),proxy(CALENDAR,{'content-type':'application/json'},{action:'status',session_token:token}),proxy(RITUALS,headers,{action:'get'})])
  const state=core.data?.state||{};state.consequences=cr.ok&&Array.isArray(cr.data?.consequences)?cr.data.consequences:[];state.weeklyInsight=ir.ok?ir.data?.insight||null:null;state.horizon=hr.ok?hr.data:null;state.calendarStatus=csr.ok?csr.data:{configured:false,connected:false};state.preparation=prep.ok?prep.data:{now:[],watching:[]};state.rituals=rr.ok?rr.data:null;
  if(state.horizon&&prep.ok&&Array.isArray(prep.data?.now)){
    const existing=Array.isArray(state.horizon.readiness)?state.horizon.readiness:[]
    const fingerprints=new Set(existing.map((x:any)=>`${x.type}|${x.title}|${x.summary}`))
    const additions=prep.data.now.map((x:any)=>({type:'preparation',severity:'prepare',date:x.act_on,title:x.title,summary:x.summary,preparation_id:x.id})).filter((x:any)=>!fingerprints.has(`${x.type}|${x.title}|${x.summary}`))
    state.horizon.readiness=[...additions,...existing]
    if(state.horizon.coverage)state.horizon.coverage.preparation_now=additions.length
  }
  state.apiVersion='1.2';return json(req,{state})
}
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
if(action==='calendar_status'){const r=await proxy(CALENDAR,{'content-type':'application/json'},{action:'status',session_token:token});return json(req,r.data,r.status)}
if(action==='calendar_start'){const r=await proxy(CALENDAR,{'content-type':'application/json'},{action:'start',session_token:token});return json(req,r.data,r.status)}
if(action==='calendar_sync'){const r=await proxy(CALENDAR,{'content-type':'application/json'},{action:'sync',session_token:token,force:true});return json(req,r.data,r.status)}
return json(req,{error:'Unknown Pepper action.'},400)
}catch(e){console.error(e);return json(req,{error:e instanceof Error?e.message:'Pepper hit an unexpected error.'},500)}})
