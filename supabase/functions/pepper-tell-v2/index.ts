import postgres from 'npm:postgres@3.4.7'

const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{ssl:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})
const BASE='https://olgyfgqlqrhfaujkfjtj.supabase.co/functions/v1'
const FALLBACK=BASE+'/pepper-family-beta-01'
const TZ='America/Los_Angeles'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-pepper-session','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'}

function localDate(d=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function addDays(date:string,n:number){const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10)}
function cap(s:string){return s ? s.charAt(0).toUpperCase()+s.slice(1) : s}
async function member(req:Request){const token=req.headers.get('x-pepper-session')||'';if(!UUID.test(token))return null;const rows=await sql<any[]>`select m.id,m.household_id,m.slug,m.display_name,m.role from public.member_sessions s join public.household_members m on m.id=s.member_id where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now() limit 1`;return rows[0]||null}
async function audit(m:any,type:string,entity:string,id:string|null,summary:string){await sql`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${m.household_id}::uuid,${m.id}::uuid,${type},${entity},${id}::uuid,${summary})`}
function dueDateFrom(text:string){const today=localDate();if(/\btomorrow\b/i.test(text))return {date:addDays(today,1),label:'tomorrow'};if(/\b(today|tonight)\b/i.test(text))return {date:today,label:'today'};return null}
function cleanDelegatedAction(subject:string,action:string){let s=action.replace(/\b(tomorrow|today|tonight)\b/ig,'').replace(/[.]+$/,'').trim();if(/\b(dr|doctor|doctors?)\s+app(?:ointment)?\b/i.test(s)){return `Make a doctor appointment for ${subject}`};s=s.replace(/\bhim\b/ig,subject).replace(/\bher\b/ig,subject);return cap(s)}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
  if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed.'}),{status:405,headers:cors})
  try{
    const m=await member(req);if(!m)return new Response(JSON.stringify({error:'Pepper session required.'}),{status:401,headers:cors})
    let b:any={};try{b=await req.json()}catch{return new Response(JSON.stringify({error:'Invalid request.'}),{status:400,headers:cors})}
    const text=String(b?.text||'').trim();if(!text)return new Response(JSON.stringify({error:'Tell Pepper what changed first.'}),{status:400,headers:cors})

    const delegated=text.match(/\b(matt|lyra|chloe|posey|elle)\b\s+(?:needs|asked|wants)\s+me\s+to\s+(.+)/i)
    if(delegated){
      const slug=delegated[1].toLowerCase();
      const family=await sql<any[]>`select id,slug,display_name from public.household_members where household_id=${m.household_id}::uuid and slug=${slug} limit 1`;
      const subject=family[0]?.display_name||cap(slug);
      const due=dueDateFrom(text);
      const title=cleanDelegatedAction(subject,delegated[2]);
      const capRows=await sql<any[]>`insert into public.captures(household_id,member_id,source,original_text,status,extracted_facts,applied_changes,captured_at,updated_at) values(${m.household_id}::uuid,${m.id}::uuid,${String(b?.source)==='voice'?'voice':'text'},${text},'captured',${JSON.stringify([text])}::jsonb,'[]'::jsonb,now(),now()) returning id`;
      const captureId=capRows[0]?.id;
      const taskRows=due
        ? await sql<any[]>`insert into public.tasks(household_id,title,owner_member_id,creator_member_id,visibility,status,due_at,source) values(${m.household_id}::uuid,${title},${m.id}::uuid,${m.id}::uuid,'household','open',((${due.date}::date + time '12:00') at time zone ${TZ}),'pepper_capture') returning id,due_at`
        : await sql<any[]>`insert into public.tasks(household_id,title,owner_member_id,creator_member_id,visibility,status,source) values(${m.household_id}::uuid,${title},${m.id}::uuid,${m.id}::uuid,'household','open','pepper_capture') returning id,due_at`;
      const task=taskRows[0];
      const changes=[{type:'task_created',id:task?.id,owner_member_id:m.id,due_at:task?.due_at||null,subject_member_slug:slug}];
      await sql`update public.captures set status='applied',applied_changes=${JSON.stringify(changes)}::jsonb,updated_at=now() where id=${captureId}::uuid`;
      await audit(m,'task_created','task',task?.id||null,`${title}${due?` due ${due.label}`:''}.`);
      const reply=due?`Done. I added “${title}” to ${due.label}’s plan.`:`Done. I added “${title}” to the family plan.`;
      return new Response(JSON.stringify({status:'applied',reply,applied_changes:changes}),{headers:cors})
    }

    const r=await fetch(FALLBACK,{method:'POST',headers:{'content-type':'application/json','x-pepper-session':req.headers.get('x-pepper-session')||''},body:JSON.stringify({action:'tell',text,source:b?.source||'text'})});
    return new Response(await r.text(),{status:r.status,headers:{...cors,'Content-Type':r.headers.get('content-type')||'application/json; charset=utf-8'}})
  }catch(e){console.error(e);return new Response(JSON.stringify({error:e instanceof Error?e.message:'Pepper could not interpret that update.'}),{status:500,headers:cors})}
})
