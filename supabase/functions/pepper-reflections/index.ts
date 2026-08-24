import postgres from 'npm:postgres@3.4.7'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-pepper-session',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
}
const todayLA = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function member(req:Request){
  const token=req.headers.get('x-pepper-session')||''
  if(!uuidRe.test(token)) return null
  const rows=await sql`
    select hm.id, hm.household_id, hm.slug, hm.display_name, hm.role
    from public.member_sessions ms
    join public.household_members hm on hm.id=ms.member_id
    where ms.token=${token}::uuid
      and ms.revoked_at is null
      and ms.expires_at>now()
    limit 1`
  return rows[0]||null
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return Response.json({error:'POST required.'},{status:405,headers:cors})
  try{
    const me=await member(req)
    if(!me) return Response.json({error:'Please reconnect this device to Pepper.'},{status:401,headers:cors})
    const body=await req.json().catch(()=>({}))
    const action=String(body?.action||'weekly')
    const today=todayLA()

    if(action==='weekly'){
      const rows=await sql`
        select id,week_start,week_end,available_on,title,observation,primary_theme,secondary_theme,
               evidence_count,distinct_days,confidence,viewed_at
        from private.weekly_reflection_insights
        where member_id=${me.id}::uuid
          and status='ready'
          and available_on<=${today}::date
        order by available_on desc, generated_at desc
        limit 1`
      return Response.json({insight:rows[0]||null},{headers:cors})
    }

    if(action==='explore'){
      const id=String(body?.insight_id||'')
      if(!uuidRe.test(id)) return Response.json({error:'Insight not found.'},{status:404,headers:cors})
      const insightRows=await sql`
        select id,week_start,week_end,title,observation,primary_theme,secondary_theme,evidence_count,distinct_days,confidence
        from private.weekly_reflection_insights
        where id=${id}::uuid and member_id=${me.id}::uuid and status='ready'
        limit 1`
      if(!insightRows[0]) return Response.json({error:'Insight not found.'},{status:404,headers:cors})
      const refs=await sql`
        select r.id,r.reflection_date,r.type,r.original_text
        from private.weekly_reflection_insights i
        join public.reflections r on r.id=any(i.supporting_reflection_ids)
        where i.id=${id}::uuid and i.member_id=${me.id}::uuid
        order by r.reflection_date,r.created_at`
      await sql`update private.weekly_reflection_insights set viewed_at=coalesce(viewed_at,now()),updated_at=now() where id=${id}::uuid and member_id=${me.id}::uuid`
      return Response.json({insight:insightRows[0],reflections:refs},{headers:cors})
    }

    if(action==='history'){
      const rows=await sql`
        select id,week_start,week_end,title,observation,primary_theme,secondary_theme,evidence_count,confidence,viewed_at
        from private.weekly_reflection_insights
        where member_id=${me.id}::uuid and status='ready' and available_on<=${today}::date
        order by week_start desc limit 12`
      return Response.json({insights:rows},{headers:cors})
    }

    if(action==='dismiss'){
      const id=String(body?.insight_id||'')
      if(!uuidRe.test(id)) return Response.json({error:'Insight not found.'},{status:404,headers:cors})
      await sql`update private.weekly_reflection_insights set status='dismissed',updated_at=now() where id=${id}::uuid and member_id=${me.id}::uuid`
      return Response.json({ok:true},{headers:cors})
    }

    return Response.json({error:'Unknown action.'},{status:400,headers:cors})
  }catch(error){
    console.error('pepper-reflections',error)
    return Response.json({error:'Pepper could not load reflections right now.'},{status:500,headers:cors})
  }
})
