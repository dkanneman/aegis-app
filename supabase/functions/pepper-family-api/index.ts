import postgres from 'npm:postgres@3.4.7'
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{ssl:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||''
if(!SUPABASE_URL)throw new Error('SUPABASE_URL is not configured.')
const BASE=SUPABASE_URL+'/functions/v1'
const PRODUCTION_ORIGIN='https://pepper-family-beta.vercel.app'
const LEGACY_PREVIEW_ORIGIN='https://pepper-v6-private-preview.vercel.app'
const APP_ORIGIN=Deno.env.get('PEPPER_APP_ORIGIN')||PRODUCTION_ORIGIN
const SUPABASE_ANON_KEY=Deno.env.get('SUPABASE_ANON_KEY')||''
const TARGET=BASE+'/pepper-family-beta-01'
const TELL=BASE+'/pepper-tell-v2'
const CONSEQUENCES=BASE+'/pepper-consequences'
const REFLECTIONS=BASE+'/pepper-reflections'
const HORIZON=BASE+'/pepper-horizon'
const PREPARATION=BASE+'/pepper-preparation'
const RITUALS=BASE+'/pepper-rituals'
const INTEGRATIONS=BASE+'/pepper-integrations'
const CALENDAR=BASE+'/pepper-calendar'
const TZ='America/Los_Angeles'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function previewOrigin(origin:string){try{const host=new URL(origin).hostname;return /^pepper-family-beta-[a-z0-9-]+-dkanneman-8936s-projects\.vercel\.app$/.test(host)}catch{return false}}
function cors(req:Request){const o=req.headers.get('origin')||'';const allowed=!o||o===APP_ORIGIN||o===PRODUCTION_ORIGIN||o===LEGACY_PREVIEW_ORIGIN||previewOrigin(o)||o.startsWith('http://localhost:')||o.startsWith('http://127.0.0.1:');return {'Access-Control-Allow-Origin':allowed&&o?o:APP_ORIGIN,'Access-Control-Allow-Headers':'apikey,authorization,content-type,x-pepper-session','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Max-Age':'86400','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Origin','X-Content-Type-Options':'nosniff'}}
function json(req:Request,body:any,status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)})}
async function validSession(token:string){if(!UUID.test(token))return null;const rows=await sql<any[]>`select m.id,m.household_id,m.slug,m.display_name,m.role,s.expires_at from public.member_sessions s join public.household_members m on m.id=s.member_id where s.token=${token}::uuid and s.revoked_at is null and s.expires_at>now() limit 1`;return rows[0]||null}
async function proxy(url:string,headers:any,body:any){const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});const text=await r.text();let data:any;try{data=JSON.parse(text)}catch{data={error:text||'Pepper service error.'}}return {ok:r.ok,status:r.status,data}}
function adult(member:any){return member.role==='adult_admin'||member.role==='adult'}
function dateLA(d=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function addDays(date:string,n:number){const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10)}
function dayDistance(from:string,to:string){return Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)}
function cleanList(value:any,limit=20){const values=Array.isArray(value)?value:String(value||'').split(/[\n,]/);return [...new Set(values.map((item:any)=>String(item).trim().slice(0,160)).filter(Boolean))].slice(0,limit)}
const MEAL_LIBRARY=[
  {name:'Chicken rice bowls',flags:['meat'],groceries:['Chicken','Rice','Bell peppers','Cucumber','Avocado']},
  {name:'Build-your-own taco bowls',flags:['meat'],groceries:['Ground turkey','Black beans','Rice','Lettuce','Tomatoes','Avocado']},
  {name:'Sheet-pan chicken and vegetables',flags:['meat'],groceries:['Chicken','Potatoes','Broccoli','Carrots']},
  {name:'Salmon, rice, and green beans',flags:['fish'],groceries:['Salmon','Rice','Green beans','Lemons']},
  {name:'Vegetable stir-fry with rice',flags:['soy'],groceries:['Rice','Broccoli','Bell peppers','Snap peas','Stir-fry sauce']},
  {name:'Pasta marinara and salad',flags:['gluten'],groceries:['Pasta','Marinara sauce','Salad greens','Tomatoes']},
  {name:'Turkey burgers and salad',flags:['meat','gluten'],groceries:['Turkey burger patties','Burger buns','Salad greens','Tomatoes']},
  {name:'Black bean taco bowls',flags:[],groceries:['Black beans','Rice','Corn','Lettuce','Tomatoes','Avocado']},
  {name:'Baked potato bar',flags:[],groceries:['Potatoes','Broccoli','Green onions','Black beans']},
  {name:'Vegetable soup and salad',flags:[],groceries:['Vegetable broth','Carrots','Celery','Potatoes','Salad greens']},
]
function allowedMeals(needs:any[]){const text=needs.map((need:any)=>`${need.label||''} ${need.details||''}`).join(' ').toLowerCase();const blocked=new Set<string>();if(/vegetarian|vegan|no meat/.test(text))blocked.add('meat');if(/fish allergy|no fish|avoid fish|seafood allergy/.test(text))blocked.add('fish');if(/gluten[ -]?free|celiac|no gluten/.test(text))blocked.add('gluten');if(/soy allergy|no soy/.test(text))blocked.add('soy');const allowed=MEAL_LIBRARY.filter((meal)=>meal.flags.every((flag)=>!blocked.has(flag)));return allowed.length?allowed:MEAL_LIBRARY.filter((meal)=>meal.flags.length===0)}
async function calendarState(member:any){const rows=await sql<any[]>`select id,connected_by_member_id,provider_calendar_id,calendar_name,calendar_time_zone,status,sync_status,last_attempt_at,last_synced_at,last_error from public.calendar_connections where household_id=${member.household_id}::uuid order by updated_at desc limit 1`;const connection=rows[0]||null;return {configured:false,connected:connection?.status==='connected',connection}}
async function setupProfiles(member:any){
  const profiles=await sql<any[]>`
    select
      m.id as member_id,
      m.household_id,
      coalesce(p.activities,'{}'::text[]) as activities,
      coalesce(nullif(p.school_name,''),school.school_name,'') as school_name,
      coalesce(nullif(p.grade_label,''),school.grade_label,'') as grade_label,
      coalesce(p.dietary_preferences,'{}'::text[]) as dietary_preferences,
      coalesce(p.medications,'{}'::text[]) as medications,
      coalesce(p.goals,'{}'::text[]) as goals,
      p.updated_at
    from public.household_members m
    left join private.member_setup_profiles p on p.member_id=m.id
    left join lateral (
      select sp.school_name,sp.grade_label
      from private.school_profiles sp
      where sp.household_id=m.household_id and sp.student_member_id=m.id
      order by sp.last_day desc
      limit 1
    ) school on true
    where m.household_id=${member.household_id}::uuid
    order by m.created_at
  `
  return profiles.map((profile:any)=>adult(member)||profile.member_id===member.id?profile:{...profile,medications:[]})
}
async function memberState(member:any,targetSlug:string){
  const targets=await sql<any[]>`select id,slug,display_name,role from public.household_members where household_id=${member.household_id}::uuid and slug=${targetSlug} limit 1`
  const target=targets[0]
  if(!target)throw Object.assign(new Error('Family member not found.'),{status:404})
  const [events,appointments,tasks,profiles,schoolChanges,setup]=await Promise.all([
    sql<any[]>`select e.id,e.title,e.person_slug,e.starts_at,e.ends_at,e.location,e.notes,e.status,e.visibility,e.owner_member_id,e.kind,e.transport_owner_member_id,e.transport_status,e.source from public.events e where e.household_id=${member.household_id}::uuid and e.deleted_at is null and e.starts_at>=now()-interval '1 day' and e.starts_at<now()+interval '31 days' and (e.person_slug=${target.slug} or e.owner_member_id=${target.id}::uuid or e.transport_owner_member_id=${target.id}::uuid) and (e.visibility='household' or e.owner_member_id=${member.id}::uuid or e.person_slug=${member.slug}) order by e.starts_at limit 120`,
    sql<any[]>`select e.id,e.title,e.person_slug,e.starts_at,e.ends_at,e.location,e.notes,e.status,e.visibility,e.owner_member_id,e.kind,e.transport_owner_member_id,e.transport_status,e.source from public.events e where e.household_id=${member.household_id}::uuid and e.deleted_at is null and e.starts_at>=now()-interval '1 day' and (e.person_slug=${target.slug} or e.owner_member_id=${target.id}::uuid or e.transport_owner_member_id=${target.id}::uuid) and (e.visibility='household' or e.owner_member_id=${member.id}::uuid or e.person_slug=${member.slug}) and (lower(coalesce(e.kind,''))='appointment' or lower(coalesce(e.title,'')) ~ '(^|[^a-z])dr([^a-z]|$)' or lower(concat_ws(' ',e.title,e.notes,e.location)) ~ '(^|[^a-z])(doctor|dentist|dental|orthodont[a-z]*|pediatri[a-z]*|pulmonolog[a-z]*|cardiolog[a-z]*|dermatolog[a-z]*|endocrinolog[a-z]*|neurolog[a-z]*|allerg[a-z]*|specialist|medical|therapy|therapist|physical|optometr[a-z]*|vision|eye exam|check[ -]?up|well child|wellness|urgent care|clinic)([^a-z]|$)') order by e.starts_at limit 160`,
    sql<any[]>`select t.id,t.title,t.owner_member_id,t.creator_member_id,t.visibility,t.status,t.due_at,t.source,t.updated_at,t.created_at,t.area,t.project,t.priority,t.classification,t.tags,t.notes,t.waiting_on,t.recurrence,t.completed_at,t.next_action from public.tasks t where t.household_id=${member.household_id}::uuid and t.deleted_at is null and (t.owner_member_id=${target.id}::uuid or ((lower(concat_ws(' ',t.title,t.project,t.notes,array_to_string(t.tags,' '))) like ${`%${String(target.display_name).toLowerCase()}%`} or lower(concat_ws(' ',t.title,t.project,t.notes,array_to_string(t.tags,' '))) like ${`%${String(target.slug).toLowerCase()}%`}) and lower(coalesce(t.area,'')) in ('health','kids') and lower(concat_ws(' ',t.title,t.project,t.notes,t.classification,array_to_string(t.tags,' '))) ~ '(^|[^a-z])(dr|doctor|dentist|dental|orthodont[a-z]*|pediatri[a-z]*|pulmonolog[a-z]*|cardiolog[a-z]*|dermatolog[a-z]*|endocrinolog[a-z]*|neurolog[a-z]*|allerg[a-z]*|specialist|medical|therapy|therapist|physical|optometr[a-z]*|vision|eye exam|check[ -]?up|well child|wellness|urgent care|clinic)([^a-z]|$)')) and (t.visibility='household' or t.owner_member_id=${member.id}::uuid or t.creator_member_id=${member.id}::uuid) order by case t.status when 'open' then 0 when 'in_progress' then 1 when 'on_hold' then 2 when 'completed' then 3 else 4 end,t.due_at nulls last,t.updated_at desc limit 160`,
    sql<any[]>`select p.id,p.academic_year,p.school_name,p.district_name,p.grade_label,p.timezone,p.family_arrival_target_local::text,p.first_bell_local::text,p.normal_dismissal_local::text,p.first_day::text,p.last_day::text,p.source_label,p.source_url,p.source_checked_on::text from private.school_profiles p where p.household_id=${member.household_id}::uuid and p.student_member_id=${target.id}::uuid order by p.last_day desc limit 1`,
    sql<any[]>`select schedule_date::text,schedule_kind,schedule_title,day_starts_at,dismissal_at,precedence,resolution_level,source_label,source_url from private.resolve_school_schedule(${member.household_id}::uuid,(now() at time zone 'America/Los_Angeles')::date,((now() at time zone 'America/Los_Angeles')::date+interval '31 days')::date) where person_slug=${target.slug} and resolution_level='dated_exception' and transportation_impact=true order by schedule_date limit 6`,
    sql<any[]>`select member_id,activities,school_name,grade_label,dietary_preferences,medications,goals,updated_at from private.member_setup_profiles where household_id=${member.household_id}::uuid and member_id=${target.id}::uuid limit 1`,
  ])
  const memberEvents=[...new Map([...events,...appointments].map((event:any)=>[event.id,event])).values()]
    .sort((left:any,right:any)=>+new Date(left.starts_at)-+new Date(right.starts_at))
  const memberProfile=setup[0]||(profiles[0]?{
    member_id:target.id,
    activities:[],
    school_name:profiles[0].school_name,
    grade_label:profiles[0].grade_label,
    dietary_preferences:[],
    medications:[],
    goals:[],
    updated_at:null,
  }:null)
  if(memberProfile&&!adult(member)&&target.id!==member.id)memberProfile.medications=[]
  return {member:target,events:memberEvents,tasks,school:profiles[0]?{profile:profiles[0],upcoming_changes:schoolChanges}:null,setup:memberProfile}
}
async function choreState(member:any){
  return sql<any[]>`
    select t.id,t.title,t.owner_member_id,t.creator_member_id,t.visibility,t.status,
      t.due_at,t.source,t.updated_at,t.created_at,t.area,t.project,t.priority,
      t.classification,t.tags,t.notes,t.waiting_on,t.recurrence,t.completed_at,t.next_action
    from public.tasks t
    where t.household_id=${member.household_id}::uuid
      and t.deleted_at is null
      and t.visibility='household'
      and (
        lower(coalesce(t.classification,''))='chore'
        or lower(coalesce(t.area,''))='chores'
        or lower(coalesce(t.project,''))='family chores'
        or lower(coalesce(t.title,'')) ~ '\\m((empty|unload|load)( the)? dishwasher|(wash|put away|fold)( the)? laundry|(do|wash)( the)? dishes|(take out|empty)( the)? trash|clean|cleanup|tidy|vacuum|sweep|mop|(feed|walk)( maggie| the (dog|cat|pet))|set( the)? table|room reset)\\M'
        or exists (
          select 1
          from unnest(coalesce(t.tags,'{}'::text[])) tag
          where lower(tag) in ('chore','chores')
        )
      )
    order by
      case t.status when 'open' then 0 when 'in_progress' then 1 when 'completed' then 2 else 3 end,
      t.due_at nulls last,
      t.updated_at desc
    limit 240
  `
}
async function mealState(member:any){
  const [meals,groceries,mealNeeds]=await Promise.all([
    sql<any[]>`select mp.id,mp.meal_date::text,mp.meal_name,mp.prep_at,mp.eat_at,mp.owner_member_id,mp.shopping_owner_member_id,mp.updated_at from public.meal_plan mp where mp.household_id=${member.household_id}::uuid and mp.meal_date>=(now() at time zone 'America/Los_Angeles')::date and mp.meal_date<((now() at time zone 'America/Los_Angeles')::date+interval '14 days') order by mp.meal_date`,
    sql<any[]>`select g.id,g.item,g.status,g.added_by_member_id,g.completed_by_member_id,g.owner_member_id,g.meal_plan_id,g.updated_at,g.created_at from public.groceries g where g.household_id=${member.household_id}::uuid order by case g.status when 'open' then 0 else 1 end,g.created_at desc`,
    sql<any[]>`select n.id,n.member_id,n.need_type,n.label,n.details,n.active,n.updated_at from public.family_meal_needs n where n.household_id=${member.household_id}::uuid and n.active=true order by n.member_id,n.need_type,n.label`,
  ])
  return {meals,groceries,mealNeeds}
}
async function frontSeatConfig(member:any){
  const rows=await sql<any[]>`select id,rotation_key,label,anchor_date::text,participant_member_ids from private.family_rotations where household_id=${member.household_id}::uuid and rotation_key='front-seat' limit 1`
  return rows[0]||null
}
function rotationMemberId(config:any,date:string){
  const participants=Array.isArray(config?.participant_member_ids)?config.participant_member_ids:[]
  if(!participants.length)return null
  const offset=dayDistance(config.anchor_date,date)
  return participants[((offset%participants.length)+participants.length)%participants.length]
}
async function frontSeatState(member:any){
  const config=await frontSeatConfig(member)
  if(!config)return null
  const today=dateLA(),end=addDays(today,6)
  const [members,records]=await Promise.all([
    sql<any[]>`select id,slug,display_name,role from public.household_members where household_id=${member.household_id}::uuid and id=any(${config.participant_member_ids}::uuid[])`,
    sql<any[]>`select id,rotation_date::text,assigned_member_id,status,source,confirmed_at,confirmed_by_member_id from private.family_rotation_days where rotation_id=${config.id}::uuid and rotation_date>=${today}::date and rotation_date<=${end}::date order by rotation_date`,
  ])
  const memberById=new Map(members.map((item:any)=>[item.id,item]))
  const recordByDate=new Map(records.map((item:any)=>[item.rotation_date,item]))
  const participants=config.participant_member_ids.map((id:string)=>memberById.get(id)).filter(Boolean)
  const days=Array.from({length:7},(_,index)=>{
    const date=addDays(today,index)
    const scheduledMemberId=rotationMemberId(config,date)
    const record=recordByDate.get(date)
    const assignedMemberId=record?.assigned_member_id||scheduledMemberId
    return {
      date,
      scheduled_member_id:scheduledMemberId,
      assigned_member_id:assignedMemberId,
      assigned_member:memberById.get(assignedMemberId)||null,
      status:record?.status||'planned',
      source:record?.source||'rotation',
      confirmed_at:record?.confirmed_at||null,
      can_confirm:date===today&&(adult(member)||assignedMemberId===member.id),
    }
  })
  return {id:config.id,key:config.rotation_key,label:config.label,anchor_date:config.anchor_date,participants,days,today:days[0],can_manage:adult(member)}
}
async function updateFrontSeat(member:any,body:any){
  const operation=String(body.operation||'')
  const today=dateLA()
  const requestedDate=String(body.date||today)
  if(requestedDate!==today)throw Object.assign(new Error('Only today’s front-seat turn can be changed here.'),{status:400})
  if(!['assign','reset','confirm'].includes(operation))throw Object.assign(new Error('Choose a front-seat action.'),{status:400})
  const config=await frontSeatConfig(member)
  if(!config)throw Object.assign(new Error('The front-seat rotation is not configured.'),{status:404})
  const existing=await sql<any[]>`select assigned_member_id,status,source from private.family_rotation_days where rotation_id=${config.id}::uuid and rotation_date=${today}::date limit 1`
  const currentMemberId=existing[0]?.assigned_member_id||rotationMemberId(config,today)
  if(operation==='assign'||operation==='reset'){
    if(!adult(member))throw Object.assign(new Error('Only Danielle or Matt can change the front-seat turn.'),{status:403})
  }
  const result=await sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    let assignedMemberId=currentMemberId
    let recordId=config.id
    if(operation==='assign'){
      assignedMemberId=String(body.assigned_member_id||'')
      if(!config.participant_member_ids.includes(assignedMemberId))throw Object.assign(new Error('Choose Posey, Chloe, or Lyra.'),{status:400})
      const rows=await tx<any[]>`insert into private.family_rotation_days(rotation_id,household_id,rotation_date,assigned_member_id,status,source,updated_by_member_id,updated_at) values(${config.id}::uuid,${member.household_id}::uuid,${today}::date,${assignedMemberId}::uuid,'planned','manual',${member.id}::uuid,now()) on conflict(rotation_id,rotation_date) do update set assigned_member_id=excluded.assigned_member_id,status='planned',source='manual',updated_by_member_id=excluded.updated_by_member_id,confirmed_by_member_id=null,confirmed_at=null,updated_at=now() returning id`
      recordId=rows[0].id
    }else if(operation==='reset'){
      await tx`delete from private.family_rotation_days where rotation_id=${config.id}::uuid and rotation_date=${today}::date`
      assignedMemberId=rotationMemberId(config,today)
    }else{
      if(!adult(member)&&member.id!==currentMemberId)throw Object.assign(new Error('Only today’s rider or an adult can confirm this turn.'),{status:403})
      const rows=await tx<any[]>`insert into private.family_rotation_days(rotation_id,household_id,rotation_date,assigned_member_id,status,source,updated_by_member_id,confirmed_by_member_id,confirmed_at,updated_at) values(${config.id}::uuid,${member.household_id}::uuid,${today}::date,${currentMemberId}::uuid,'confirmed',${existing[0]?.source||'rotation'},${member.id}::uuid,${member.id}::uuid,now(),now()) on conflict(rotation_id,rotation_date) do update set status='confirmed',updated_by_member_id=excluded.updated_by_member_id,confirmed_by_member_id=excluded.confirmed_by_member_id,confirmed_at=now(),updated_at=now() returning id`
      recordId=rows[0].id
    }
    const assigned=await tx<any[]>`select display_name from public.household_members where id=${assignedMemberId}::uuid and household_id=${member.household_id}::uuid limit 1`
    const summary=operation==='reset'?`Front-seat turn reset to the regular rotation: ${assigned[0]?.display_name||'assigned rider'}.`:operation==='confirm'?`${assigned[0]?.display_name||'Assigned rider'} confirmed the front-seat turn.`:`Front-seat turn assigned to ${assigned[0]?.display_name||'assigned rider'}.`
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,${`front_seat_${operation}`},'family_rotation',${recordId}::uuid,${summary})`
    return {ok:true,operation}
  })
  return {...result,frontSeat:await frontSeatState(member)}
}
async function householdMember(tx:any,member:any,id:string){
  if(!id)return null
  if(!UUID.test(id))throw Object.assign(new Error('Choose someone in this household.'),{status:400})
  const rows=await tx<any[]>`select id from public.household_members where id=${id}::uuid and household_id=${member.household_id}::uuid limit 1`
  if(!rows[0])throw Object.assign(new Error('Choose someone in this household.'),{status:400})
  return rows[0]
}
async function upsertMeal(member:any,body:any){
  if(!adult(member))throw Object.assign(new Error('Only an adult can change the family meal plan.'),{status:403})
  const mealDate=String(body.meal_date||'').trim()
  const mealName=String(body.meal_name||'').trim().slice(0,240)
  const ownerId=body.owner_member_id==null?'':String(body.owner_member_id)
  const shoppingOwnerId=body.shopping_owner_member_id==null?'':String(body.shopping_owner_member_id)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(mealDate)||!mealName)throw Object.assign(new Error('Choose a day and name the meal.'),{status:400})
  return sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    await householdMember(tx,member,ownerId)
    await householdMember(tx,member,shoppingOwnerId)
    const rows=await tx<any[]>`insert into public.meal_plan(household_id,meal_date,meal_name,owner_member_id,shopping_owner_member_id,updated_at) values(${member.household_id}::uuid,${mealDate}::date,${mealName},${ownerId||null}::uuid,${shoppingOwnerId||null}::uuid,now()) on conflict(household_id,meal_date) do update set meal_name=excluded.meal_name,owner_member_id=excluded.owner_member_id,shopping_owner_member_id=excluded.shopping_owner_member_id,updated_at=now() returning id,meal_date::text,meal_name,prep_at,eat_at,owner_member_id,shopping_owner_member_id,updated_at`
    const meal=rows[0]
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,'meal_upserted','meal',${meal.id}::uuid,${`${mealName} saved for ${mealDate}.`})`
    return {ok:true,meal}
  })
}
async function upsertMealNeed(member:any,body:any){
  if(!adult(member))throw Object.assign(new Error('Only an adult can change family meal needs.'),{status:403})
  const id=String(body.id||'')
  const memberId=String(body.member_id||'')
  const needType=String(body.need_type||'preference').trim().toLowerCase()
  const label=String(body.label||'').trim().slice(0,160)
  const details=String(body.details||'').trim().slice(0,500)
  const active=body.active!==false
  if(id&&!UUID.test(id))throw Object.assign(new Error('Meal need not found.'),{status:400})
  if(!['allergy','avoidance','preference','nutrition','schedule'].includes(needType))throw Object.assign(new Error('Choose a valid meal need type.'),{status:400})
  return sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    if(id){
      const rows=await tx<any[]>`update public.family_meal_needs set active=${active},updated_at=now() where id=${id}::uuid and household_id=${member.household_id}::uuid returning id,member_id,need_type,label,details,active,updated_at`
      if(!rows[0])throw Object.assign(new Error('Meal need not found.'),{status:404})
      await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,'meal_need_updated','meal_need',${id}::uuid,${active?'Family meal need restored.':'Family meal need removed.'})`
      return {ok:true,mealNeed:rows[0]}
    }
    if(!label)throw Object.assign(new Error('Describe the meal need.'),{status:400})
    await householdMember(tx,member,memberId)
    const rows=await tx<any[]>`insert into public.family_meal_needs(household_id,member_id,need_type,label,details,active,created_by_member_id) values(${member.household_id}::uuid,${memberId}::uuid,${needType},${label},${details||null},true,${member.id}::uuid) on conflict(household_id,member_id,lower(label)) do update set need_type=excluded.need_type,details=excluded.details,active=true,updated_at=now() returning id,member_id,need_type,label,details,active,updated_at`
    const mealNeed=rows[0]
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,'meal_need_added','meal_need',${mealNeed.id}::uuid,${`${label} added to family meal needs.`})`
    return {ok:true,mealNeed}
  })
}
async function validateMeal(tx:any,member:any,id:string){
  if(!id)return null
  if(!UUID.test(id))throw Object.assign(new Error('Choose a meal in this plan.'),{status:400})
  const rows=await tx<any[]>`select id from public.meal_plan where id=${id}::uuid and household_id=${member.household_id}::uuid limit 1`
  if(!rows[0])throw Object.assign(new Error('Choose a meal in this plan.'),{status:400})
  return rows[0]
}
async function createGrocery(member:any,body:any){
  const item=String(body.item||'').trim().slice(0,200)
  const mealPlanId=body.meal_plan_id==null?'':String(body.meal_plan_id)
  const requestedOwner=body.owner_member_id==null?'':String(body.owner_member_id)
  const ownerId=adult(member)?requestedOwner:member.id
  if(!item)throw Object.assign(new Error('Add a grocery item first.'),{status:400})
  return sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    await householdMember(tx,member,ownerId)
    await validateMeal(tx,member,mealPlanId)
    const rows=await tx<any[]>`insert into public.groceries(household_id,item,status,added_by_member_id,owner_member_id,meal_plan_id) values(${member.household_id}::uuid,${item},'open',${member.id}::uuid,${ownerId||null}::uuid,${mealPlanId||null}::uuid) returning id,item,status,added_by_member_id,completed_by_member_id,owner_member_id,meal_plan_id,updated_at,created_at`
    const grocery=rows[0]
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,'grocery_created','grocery',${grocery.id}::uuid,${`${item} added to the weekly grocery plan.`})`
    return {ok:true,grocery}
  })
}
async function updateGrocery(member:any,body:any){
  const id=String(body.id||'')
  const operation=String(body.operation||'')
  const ownerId=body.owner_member_id==null?'':String(body.owner_member_id)
  const mealPlanId=body.meal_plan_id==null?'':String(body.meal_plan_id)
  if(!UUID.test(id)||!['assign','attach','complete','reopen'].includes(operation))throw Object.assign(new Error('Invalid grocery update.'),{status:400})
  return sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    const rows=await tx<any[]>`select id,item,status,owner_member_id,meal_plan_id from public.groceries where id=${id}::uuid and household_id=${member.household_id}::uuid for update`
    const grocery=rows[0]
    if(!grocery)throw Object.assign(new Error('Grocery item not found.'),{status:404})
    if(operation==='assign'){
      if(!adult(member))throw Object.assign(new Error('Only an adult can assign groceries.'),{status:403})
      await householdMember(tx,member,ownerId)
      await tx`update public.groceries set owner_member_id=${ownerId||null}::uuid,updated_at=now() where id=${id}::uuid`
    }else if(operation==='attach'){
      if(!adult(member))throw Object.assign(new Error('Only an adult can change the meal link.'),{status:403})
      await validateMeal(tx,member,mealPlanId)
      await tx`update public.groceries set meal_plan_id=${mealPlanId||null}::uuid,updated_at=now() where id=${id}::uuid`
    }else{
      if(!adult(member)&&grocery.owner_member_id&&grocery.owner_member_id!==member.id)throw Object.assign(new Error('That grocery is assigned to someone else.'),{status:403})
      const status=operation==='complete'?'completed':'open'
      await tx`update public.groceries set status=${status},completed_by_member_id=case when ${operation}='complete' then ${member.id}::uuid else null end,updated_at=now() where id=${id}::uuid`
    }
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,${`grocery_${operation}`},'grocery',${id}::uuid,${`${grocery.item} grocery ${operation} saved.`})`
    return {ok:true,id,operation}
  })
}
async function saveMemberSetup(member:any,body:any){
  if(!adult(member))throw Object.assign(new Error('Only an adult can add or edit another family member.'),{status:403})
  const requestedId=String(body.member_id||'')
  const displayName=String(body.display_name||'').trim().slice(0,100)
  const role=String(body.role||'child').trim().toLowerCase()
  const pin=String(body.pin||'').trim()
  const activities=cleanList(body.activities)
  const dietaryPreferences=cleanList(body.dietary_preferences)
  const medications=cleanList(body.medications)
  const goals=cleanList(body.goals)
  const schoolName=String(body.school_name||'').trim().slice(0,180)
  const gradeLabel=String(body.grade_label||'').trim().slice(0,80)
  if(!displayName)throw Object.assign(new Error('Add the family member’s name.'),{status:400})
  if(!['adult_admin','adult','teen','child'].includes(role))throw Object.assign(new Error('Choose a valid family role.'),{status:400})
  if(requestedId&&!UUID.test(requestedId))throw Object.assign(new Error('Family member not found.'),{status:400})
  if(!requestedId&&!/^\d{4,12}$/.test(pin))throw Object.assign(new Error('New family members need a 4–12 digit invitation code.'),{status:400})
  if(pin&&!/^\d{4,12}$/.test(pin))throw Object.assign(new Error('Invitation codes must contain 4–12 digits.'),{status:400})
  return sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    let target:any
    if(requestedId){
      const rows=await tx<any[]>`select id,slug from public.household_members where id=${requestedId}::uuid and household_id=${member.household_id}::uuid for update`
      target=rows[0]
      if(!target)throw Object.assign(new Error('Family member not found.'),{status:404})
      if(pin){
        await tx`update public.household_members set display_name=${displayName},role=${role},pin_hash=extensions.crypt(${pin},extensions.gen_salt('bf')),pin_setup_completed_at=null where id=${target.id}::uuid`
        await tx`update public.member_sessions set revoked_at=now(),last_seen_at=now() where member_id=${target.id}::uuid and revoked_at is null`
      }
      else await tx`update public.household_members set display_name=${displayName},role=${role} where id=${target.id}::uuid`
    }else{
      const base=displayName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'member'
      const siblings=await tx<any[]>`select slug from public.household_members where household_id=${member.household_id}::uuid and (slug=${base} or slug like ${`${base}-%`})`
      const used=new Set(siblings.map((item:any)=>item.slug))
      let slug=base
      let suffix=2
      while(used.has(slug)){slug=`${base}-${suffix++}`}
      const rows=await tx<any[]>`insert into public.household_members(household_id,slug,display_name,role,pin_hash,pin_setup_completed_at) values(${member.household_id}::uuid,${slug},${displayName},${role},extensions.crypt(${pin},extensions.gen_salt('bf')),null) returning id,slug`
      target=rows[0]
    }
    const profiles=await tx<any[]>`insert into private.member_setup_profiles(member_id,household_id,activities,school_name,grade_label,dietary_preferences,medications,goals,updated_by_member_id,updated_at) values(${target.id}::uuid,${member.household_id}::uuid,${activities}::text[],${schoolName},${gradeLabel},${dietaryPreferences}::text[],${medications}::text[],${goals}::text[],${member.id}::uuid,now()) on conflict(member_id) do update set activities=excluded.activities,school_name=excluded.school_name,grade_label=excluded.grade_label,dietary_preferences=excluded.dietary_preferences,medications=excluded.medications,goals=excluded.goals,updated_by_member_id=excluded.updated_by_member_id,updated_at=now() returning member_id,activities,school_name,grade_label,dietary_preferences,medications,goals,updated_at`
    await tx`update public.family_meal_needs set active=false,updated_at=now() where household_id=${member.household_id}::uuid and member_id=${target.id}::uuid and need_type='preference' and details='Family setup'`
    for(const preference of dietaryPreferences){
      await tx`insert into public.family_meal_needs(household_id,member_id,need_type,label,details,active,created_by_member_id) values(${member.household_id}::uuid,${target.id}::uuid,'preference',${preference},'Family setup',true,${member.id}::uuid) on conflict(household_id,member_id,lower(label)) do update set active=true,details='Family setup',updated_at=now()`
    }
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,'member_setup_saved','member',${target.id}::uuid,${`${displayName} family setup saved.`})`
    return {ok:true,member_id:target.id,slug:target.slug,profile:profiles[0]}
  })
}
async function deleteAccount(member:any,body:any){
  if(String(body.confirmation||'')!=='DELETE MY ACCOUNT')throw Object.assign(new Error('Type DELETE MY ACCOUNT to confirm account deletion.'),{status:400})
  return sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    const members=await tx<any[]>`select id,role from public.household_members where household_id=${member.household_id}::uuid and id<>${member.id}::uuid for update`
    const nextAdult=members.find((candidate:any)=>candidate.role==='adult_admin'||candidate.role==='adult')
    if(member.role==='adult_admin'&&!nextAdult){
      await tx`delete from public.households where id=${member.household_id}::uuid`
      return {ok:true,household_deleted:true}
    }
    if(member.role==='adult_admin'&&nextAdult){
      await tx`update public.household_members set role='adult_admin' where id=${nextAdult.id}::uuid`
    }
    await tx`update private.family_routines set transport_owner_member_id=null,updated_at=now() where transport_owner_member_id=${member.id}::uuid`
    await tx`update private.future_watch_items set owner_member_id=null,updated_at=now() where owner_member_id=${member.id}::uuid`
    await tx`delete from public.tasks where household_id=${member.household_id}::uuid and visibility='private' and (owner_member_id=${member.id}::uuid or creator_member_id=${member.id}::uuid)`
    await tx`delete from public.events where household_id=${member.household_id}::uuid and visibility='private' and (owner_member_id=${member.id}::uuid or person_slug=${member.slug})`
    await tx`delete from private.family_rotations where ${member.id}::uuid=any(participant_member_ids) and cardinality(participant_member_ids)<=2`
    await tx`update private.family_rotations set participant_member_ids=array_remove(participant_member_ids,${member.id}::uuid),updated_at=now() where ${member.id}::uuid=any(participant_member_ids)`
    await tx`delete from public.calendar_connections where connected_by_member_id=${member.id}::uuid`
    await tx`delete from public.household_members where id=${member.id}::uuid and household_id=${member.household_id}::uuid`
    return {ok:true,household_deleted:false}
  })
}
async function createPersonalTask(member:any,body:any){
  const title=String(body.title||'').trim().slice(0,240)
  const dueDate=String(body.due_date||'').trim()
  const priority=String(body.priority||'P2').trim().toUpperCase()
  if(!title)throw Object.assign(new Error('Add a to-do first.'),{status:400})
  if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))throw Object.assign(new Error('Choose a valid due date.'),{status:400})
  if(!['P0','P1','P2','P3'].includes(priority))throw Object.assign(new Error('Choose a valid priority.'),{status:400})
  return sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    const rows=await tx<any[]>`insert into public.tasks(household_id,title,owner_member_id,creator_member_id,visibility,status,due_at,source,area,project,priority,classification,tags,next_action) values(${member.household_id}::uuid,${title},${member.id}::uuid,${member.id}::uuid,'private','open',(nullif(${dueDate},'')::date+time '17:00') at time zone 'America/Los_Angeles','pepper','Personal','My to-do',${priority},'To-do',array['personal']::text[],${title}) returning id,title,owner_member_id,creator_member_id,visibility,status,due_at,source,area,project,priority,classification,tags,next_action,created_at,updated_at`
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,'personal_task_created','task',${rows[0].id}::uuid,${`${title} added to ${member.display_name}’s to-do list.`})`
    return {ok:true,task:rows[0]}
  })
}
async function generateMealPlan(member:any,body:any){
  if(!adult(member))throw Object.assign(new Error('Only an adult can generate the family meal plan.'),{status:403})
  const startDate=String(body.start_date||'').trim()
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate))throw Object.assign(new Error('Choose a valid week.'),{status:400})
  const needs=await sql<any[]>`select label,details from public.family_meal_needs where household_id=${member.household_id}::uuid and active=true order by created_at`
  const choices=allowedMeals(needs)
  return sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    const generated:any[]=[]
    for(let index=0;index<7;index+=1){
      const date=new Date(`${startDate}T12:00:00Z`)
      date.setUTCDate(date.getUTCDate()+index)
      const mealDate=date.toISOString().slice(0,10)
      const recipe=choices[index%choices.length]
      const meals=await tx<any[]>`insert into public.meal_plan(household_id,meal_date,meal_name,owner_member_id,shopping_owner_member_id,updated_at) values(${member.household_id}::uuid,${mealDate}::date,${recipe.name},null,null,now()) on conflict(household_id,meal_date) do update set meal_name=case when public.meal_plan.meal_name='' then excluded.meal_name else public.meal_plan.meal_name end,updated_at=now() returning id,meal_date::text,meal_name,owner_member_id,shopping_owner_member_id`
      const meal=meals[0]
      if(meal.meal_name===recipe.name){
        for(const item of recipe.groceries){
          const existing=await tx<any[]>`select id from public.groceries where household_id=${member.household_id}::uuid and meal_plan_id=${meal.id}::uuid and lower(item)=lower(${item}) and status='open' limit 1`
          if(!existing[0])await tx`insert into public.groceries(household_id,item,status,added_by_member_id,owner_member_id,meal_plan_id) values(${member.household_id}::uuid,${item},'open',${member.id}::uuid,null,${meal.id}::uuid)`
        }
      }
      generated.push(meal)
    }
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,summary) values(${member.household_id}::uuid,${member.id}::uuid,'meal_week_generated','meal_plan',${`Seven-day meal plan generated from ${needs.length} active family meal need${needs.length===1?'':'s'}.`})`
    return {ok:true,meals:generated,needs_considered:needs.length}
  })
}
async function createChore(member:any,body:any){
  const title=String(body.title||'').trim().slice(0,240)
  const requestedOwner=body.owner_member_id==null?'':String(body.owner_member_id)
  const ownerId=adult(member)?requestedOwner:member.id
  const dueDate=String(body.due_date||'').trim()
  const recurrence=String(body.recurrence||'none').trim().toLowerCase()
  if(!title)throw Object.assign(new Error('A chore needs a name.'),{status:400})
  if(ownerId&&!UUID.test(ownerId))throw Object.assign(new Error('Choose someone in this household.'),{status:400})
  if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))throw Object.assign(new Error('Choose a valid due date.'),{status:400})
  if(!['none','daily','weekly','monthly'].includes(recurrence))throw Object.assign(new Error('Choose a valid repeat schedule.'),{status:400})
  return sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    if(ownerId){
      const owners=await tx<any[]>`select id from public.household_members where id=${ownerId}::uuid and household_id=${member.household_id}::uuid limit 1`
      if(!owners[0])throw Object.assign(new Error('Choose someone in this household.'),{status:400})
    }
    const rows=await tx<any[]>`insert into public.tasks(household_id,title,owner_member_id,creator_member_id,visibility,status,due_at,source,area,project,classification,tags,recurrence,next_action) values(${member.household_id}::uuid,${title},${ownerId||null}::uuid,${member.id}::uuid,'household','open',(nullif(${dueDate},'')::date+time '17:00') at time zone 'America/Los_Angeles','pepper','Home','Family chores','Chore',array['home','chores']::text[],${recurrence},${title}) returning id,title,owner_member_id,creator_member_id,visibility,status,due_at,source,updated_at,created_at,area,project,classification,tags,recurrence,completed_at,next_action`
    const chore=rows[0]
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,'task_created','task',${chore.id}::uuid,${`${title} added to family chores.`})`
    return {ok:true,chore}
  })
}
async function resolveConflict(member:any,body:any){
  if(!adult(member))throw Object.assign(new Error('Only an adult can resolve a family schedule conflict.'),{status:403})
  const consequenceId=String(body.consequence_id||'')
  const keepEventId=String(body.keep_event_id||'')
  const rejectEventId=String(body.reject_event_id||'')
  if(!UUID.test(consequenceId)||!UUID.test(keepEventId)||!UUID.test(rejectEventId)||keepEventId===rejectEventId)throw Object.assign(new Error('Choose which event the family is keeping.'),{status:400})
  const result=await sql.begin(async(tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    const findings=await tx<any[]>`select id,consequence_type,event_id,related_event_id,status from public.consequences where id=${consequenceId}::uuid and household_id=${member.household_id}::uuid for update`
    const finding=findings[0]
    if(!finding||!['person_conflict','driver_conflict'].includes(finding.consequence_type))throw Object.assign(new Error('That conflict is no longer available.'),{status:404})
    const expected=new Set([finding.event_id,finding.related_event_id].filter(Boolean))
    if(expected.size!==2||!expected.has(keepEventId)||!expected.has(rejectEventId))throw Object.assign(new Error('Those events do not match this conflict.'),{status:409})
    const events=await tx<any[]>`select id,title,visibility,owner_member_id,starts_at,external_organizer_email,external_organizer_name from public.events where household_id=${member.household_id}::uuid and id in (${keepEventId}::uuid,${rejectEventId}::uuid) for update`
    const kept=events.find((item:any)=>item.id===keepEventId)
    const rejected=events.find((item:any)=>item.id===rejectEventId)
    if(!kept||!rejected)throw Object.assign(new Error('One of those events is no longer available.'),{status:404})
    if(rejected.visibility==='private'&&rejected.owner_member_id!==member.id)throw Object.assign(new Error('That private event can only be changed by its owner.'),{status:403})
    await tx`update public.events set status='canceled',canonical_status_override='canceled',updated_at=now() where id=${rejectEventId}::uuid and household_id=${member.household_id}::uuid`
    await tx`update public.consequences set status='resolved',resolved_at=now(),last_seen_at=now() where id=${consequenceId}::uuid and household_id=${member.household_id}::uuid`
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,'conflict_resolved','consequence',${consequenceId}::uuid,${`${kept.title} kept; ${rejected.title} canceled.`})`
    await tx`select public.recompute_household_consequences(${member.household_id}::uuid)`
    return {kept,rejected}
  })
  return {ok:true,...result}
}
async function updateFamilyItem(member:any,body:any){
  const itemType=String(body.item_type||'')
  const itemId=String(body.id||'')
  const operation=String(body.operation||'')
  const ownerId=body.owner_member_id==null?'':String(body.owner_member_id)
  if(!['task','event'].includes(itemType)||!UUID.test(itemId))throw Object.assign(new Error('Invalid family item.'),{status:400})
  if(!['assign','edit','complete','cancel','delete','reopen'].includes(operation))throw Object.assign(new Error('Invalid update.'),{status:400})
  if(ownerId&&!UUID.test(ownerId))throw Object.assign(new Error('Invalid family member.'),{status:400})
  return sql.begin(async (tx:any)=>{
    await tx`select set_config('pepper.actor_member_id',${member.id}::text,true)`
    if(itemType==='task'){
      const rows=await tx<any[]>`select id,title,owner_member_id,creator_member_id,visibility,status from public.tasks where id=${itemId}::uuid and household_id=${member.household_id}::uuid and deleted_at is null for update`
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
      }else if(operation==='edit'){
        if(!adult(member)&&item.owner_member_id!==member.id&&item.creator_member_id!==member.id)throw Object.assign(new Error('You cannot edit that task.'),{status:403})
        const title=String(body.title||'').trim().slice(0,240)
        const status=String(body.status||'open')
        const dueDate=String(body.due_date||'').trim()
        const priority=String(body.priority||'').trim().toUpperCase()
        const notes=String(body.notes||'').trim().slice(0,8000)
        const waitingOn=String(body.waiting_on||'').trim().slice(0,1000)
        const nextAction=String(body.next_action||'').trim().slice(0,1000)
        if(!title)throw Object.assign(new Error('Give this task a title.'),{status:400})
        if(!['open','in_progress','on_hold'].includes(status))throw Object.assign(new Error('Choose Open, In progress, or On hold.'),{status:400})
        if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))throw Object.assign(new Error('Choose a valid due date.'),{status:400})
        if(priority&&!['P0','P1','P2','P3'].includes(priority))throw Object.assign(new Error('Choose a valid priority.'),{status:400})
        await tx`update public.tasks set title=${title},status=${status},due_at=case when ${dueDate}='' then null else (${dueDate}::date + time '17:00') at time zone ${TZ} end,priority=nullif(${priority},''),notes=nullif(${notes},''),waiting_on=nullif(${waitingOn},''),next_action=nullif(${nextAction},''),completed_at=null,updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
      }else if(operation==='delete'){
        if(!adult(member)&&item.owner_member_id!==member.id&&item.creator_member_id!==member.id)throw Object.assign(new Error('You cannot delete that task.'),{status:403})
        await tx`update public.tasks set status='canceled',deleted_at=now(),deleted_by_member_id=${member.id}::uuid,completed_at=null,updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
      }else{
        if(!adult(member)&&item.owner_member_id!==member.id&&item.creator_member_id!==member.id)throw Object.assign(new Error('You cannot change that task.'),{status:403})
        const status=operation==='complete'?'completed':operation==='cancel'?'canceled':'open'
        await tx`update public.tasks set status=${status},completed_at=case when ${operation}='complete' then now() else null end,updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
      }
      const summary=operation==='assign'?`${item.title} was assigned.`:operation==='edit'?`${item.title} details were updated.`:operation==='delete'?`${item.title} was deleted from Pepper.`:`${item.title} was ${operation==='reopen'?'reopened':operation+'ed'}.`
      const auditType=operation==='edit'?'task_edit':operation==='delete'?'task_delete':`task_${operation}`
      await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,${auditType},'task',${itemId}::uuid,${summary})`
      return {ok:true,item_type:itemType,id:itemId,operation}
    }
    const rows=await tx<any[]>`select id,title,owner_member_id,visibility,status,transport_owner_member_id from public.events where id=${itemId}::uuid and household_id=${member.household_id}::uuid and deleted_at is null for update`
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
    }else if(operation==='edit'){
      const title=String(body.title||'').trim().slice(0,240)
      const startsLocal=String(body.starts_local||'').trim()
      const endsLocal=String(body.ends_local||'').trim()
      const location=String(body.location||'').trim().slice(0,500)
      const notes=String(body.notes||'').trim().slice(0,8000)
      const localPattern=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
      if(!title)throw Object.assign(new Error('Give this appointment a title.'),{status:400})
      if(!localPattern.test(startsLocal)||endsLocal&&!localPattern.test(endsLocal))throw Object.assign(new Error('Choose a valid date and time.'),{status:400})
      if(endsLocal&&endsLocal<=startsLocal)throw Object.assign(new Error('The end time must be after the start time.'),{status:400})
      await tx`update public.events set title=${title},starts_at=(${startsLocal}::timestamp at time zone ${TZ}),ends_at=(nullif(${endsLocal},'')::timestamp at time zone ${TZ}),location=nullif(${location},''),notes=nullif(${notes},''),canonical_content_override=canonical_content_override||jsonb_build_object('title',${title},'starts_at',((${startsLocal}::timestamp at time zone ${TZ}))::text,'ends_at',coalesce(((nullif(${endsLocal},'')::timestamp at time zone ${TZ}))::text,''),'location',${location},'notes',${notes}),updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
    }else if(operation==='delete'){
      await tx`update public.events set status='canceled',canonical_status_override='canceled',deleted_at=now(),deleted_by_member_id=${member.id}::uuid,updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
    }else{
      const status=operation==='complete'?'completed':operation==='cancel'?'canceled':'confirmed'
      if(operation==='complete')await tx`update public.events set status=${status},canonical_status_override='completed',transport_status=case when transport_owner_member_id is null then transport_status else 'completed' end,updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
      else if(operation==='cancel')await tx`update public.events set status=${status},canonical_status_override='canceled',updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
      else await tx`update public.events set status=${status},canonical_status_override=null,updated_at=now() where id=${itemId}::uuid and household_id=${member.household_id}::uuid`
    }
    const summary=operation==='assign'?`${item.title} driver changed.`:operation==='edit'?`${item.title} appointment details were updated.`:operation==='delete'?`${item.title} was deleted from Pepper.`:`${item.title} was ${operation==='reopen'?'restored':operation+'ed'}.`
    const auditType=operation==='edit'?'event_edit':operation==='delete'?'event_delete':`event_${operation}`
    await tx`insert into public.audit_log(household_id,actor_member_id,event_type,entity_type,entity_id,summary) values(${member.household_id}::uuid,${member.id}::uuid,${auditType},'event',${itemId}::uuid,${summary})`
    await tx`select public.recompute_household_consequences(${member.household_id}::uuid)`
    return {ok:true,item_type:itemType,id:itemId,operation}
  })
}
Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});if(req.method==='GET')return json(req,{ok:true,service:'pepper-family-api',version:'1.9',backend:'supabase',frontend:'vercel',capabilities:['chore_create','pin_setup','conflict_resolve','front_seat_update','item_update','item_edit','item_delete','meal_upsert','meal_need_upsert','meal_plan_generate','grocery_create','grocery_update','member_setup_save','personal_task_create','account_delete']});if(req.method!=='POST')return json(req,{error:'Method not allowed.'},405);let b:any={};try{b=await req.json()}catch{return json(req,{error:'Invalid request.'},400)}const action=String(b?.action||'');try{
if(action==='login'){const slug=String(b.member_slug||'').trim().toLowerCase(),pin=String(b.pin||'').trim(),device=String(b.device_label||'Pepper web').slice(0,120);const rows=await sql<any[]>`select public.pepper_start_family_session(${slug},${pin},${device}) as result`;const result=rows[0]?.result||{ok:false,error:'Pepper could not start this session.'};return json(req,result,result.ok?200:401)}
if(action==='pin_setup'){
  const setupToken=String(b.setup_token||'').trim()
  const newPin=String(b.new_pin||'').trim()
  const device=String(b.device_label||'Pepper web').slice(0,120)
  if(!UUID.test(setupToken))return json(req,{error:'Start PIN setup again with your invitation code.'},400)
  const rows=await sql<any[]>`select private.pepper_complete_pin_setup(${setupToken}::uuid,${newPin},${device}) as result`
  const result=rows[0]?.result||{ok:false,error:'Pepper could not finish PIN setup.'}
  return json(req,result,result.ok?200:400)
}
const token=req.headers.get('x-pepper-session')||'';const member=await validSession(token);if(!member)return json(req,{error:'Unlock Pepper again to continue.',code:'session_required'},401);await sql`update public.member_sessions set last_seen_at=now() where token=${token}::uuid`;
if(action==='logout'){await sql`update public.member_sessions set revoked_at=now() where token=${token}::uuid`;return json(req,{ok:true})}
if(action==='account_delete'){return json(req,await deleteAccount(member,b))}
const headers:any={'content-type':'application/json','x-pepper-session':token,apikey:SUPABASE_ANON_KEY,authorization:`Bearer ${SUPABASE_ANON_KEY}`}
if(action==='state'){
  const core=await proxy(TARGET,headers,{action:'state'});if(!core.ok)return json(req,core.data,core.status)
  const prep=await proxy(PREPARATION,headers,{action:'list'})
  const [cr,ir,hr,calendarResult,rr,xr,chores,mealPlan,memberProfiles,frontSeat]=await Promise.all([proxy(CONSEQUENCES,headers,{}),proxy(REFLECTIONS,headers,{action:'weekly'}),proxy(HORIZON,headers,{}),proxy(CALENDAR,headers,{action:'status',session_token:token}),proxy(RITUALS,headers,{action:'get'}),proxy(INTEGRATIONS,headers,{action:'status'}),choreState(member),mealState(member),setupProfiles(member),frontSeatState(member)])
  const csr=calendarResult.ok?calendarResult.data:{...await calendarState(member),configured:false,last_error:calendarResult.data?.error||'Calendar service is unavailable.'}
  const state=core.data?.state||{};state.consequences=cr.ok&&Array.isArray(cr.data?.consequences)?cr.data.consequences:[];state.weeklyInsight=ir.ok?ir.data?.insight||null:null;state.horizon=hr.ok?hr.data:null;state.calendarStatus=csr;state.integrations=xr.ok?xr.data:{gmail:{configured:false,connected:false},apple_health:{connected:false,latest:null}};state.preparation=prep.ok?prep.data:{now:[],watching:[]};state.rituals=rr.ok?rr.data:null;state.chores=chores;state.meals=mealPlan.meals;state.groceries=mealPlan.groceries;state.mealNeeds=mealPlan.mealNeeds;state.memberProfiles=memberProfiles;state.frontSeat=frontSeat;
  if(state.horizon&&prep.ok&&Array.isArray(prep.data?.now)){
    const existing=Array.isArray(state.horizon.readiness)?state.horizon.readiness:[]
    const fingerprints=new Set(existing.map((x:any)=>`${x.type}|${x.title}|${x.summary}`))
    const additions=prep.data.now.map((x:any)=>({type:'preparation',severity:'prepare',date:x.act_on,title:x.title,summary:x.summary,preparation_id:x.id})).filter((x:any)=>!fingerprints.has(`${x.type}|${x.title}|${x.summary}`))
    state.horizon.readiness=[...additions,...existing]
    if(state.horizon.coverage)state.horizon.coverage.preparation_now=additions.length
  }
  state.apiVersion='1.6';return json(req,{state})
}
if(action==='member_state'){return json(req,{state:await memberState(member,String(b.member_slug||''))})}
if(action==='item_update'){return json(req,await updateFamilyItem(member,b))}
if(action==='member_setup_save'){return json(req,await saveMemberSetup(member,b))}
if(action==='personal_task_create'){return json(req,await createPersonalTask(member,b))}
if(action==='chore_create'){return json(req,await createChore(member,b))}
if(action==='front_seat_update'){return json(req,await updateFrontSeat(member,b))}
if(action==='meal_upsert'){return json(req,await upsertMeal(member,b))}
if(action==='meal_need_upsert'){return json(req,await upsertMealNeed(member,b))}
if(action==='meal_plan_generate'){return json(req,await generateMealPlan(member,b))}
if(action==='grocery_create'){return json(req,await createGrocery(member,b))}
if(action==='grocery_update'){return json(req,await updateGrocery(member,b))}
if(action==='conflict_resolve'){return json(req,await resolveConflict(member,b))}
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
if(action==='calendar_status'){const r=await proxy(CALENDAR,headers,{action:'status',session_token:token});return json(req,r.data,r.status)}
if(action==='calendar_start'){const r=await proxy(CALENDAR,headers,{action:'start',session_token:token,return_target:b.return_target});return json(req,r.data,r.status)}
if(action==='calendar_sync'){const r=await proxy(CALENDAR,headers,{action:'sync',session_token:token,force:true});return json(req,r.data,r.status)}
if(action==='email_start'){const r=await proxy(INTEGRATIONS,headers,{action:'gmail_start',return_target:b.return_target});return json(req,r.data,r.status)}
if(action==='health_pair'){const r=await proxy(INTEGRATIONS,headers,{action:'health_pair'});return json(req,r.data,r.status)}
if(action==='integration_status'){const r=await proxy(INTEGRATIONS,headers,{action:'status'});return json(req,r.data,r.status)}
return json(req,{error:'Unknown Pepper action.',code:'unknown_action'},400)
}catch(e){console.error(e);const status=typeof (e as any)?.status==='number'?(e as any).status:500;return json(req,{error:e instanceof Error?e.message:'Pepper hit an unexpected error.'},status)}})
