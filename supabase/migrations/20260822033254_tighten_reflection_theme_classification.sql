create or replace function private.tag_reflection(p_reflection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reflections%rowtype;
  t text;
begin
  select * into r from public.reflections where id = p_reflection_id;
  if not found then return; end if;
  t := lower(r.original_text);

  delete from private.reflection_themes where reflection_id = r.id;

  if t ~ '(\mpeople\M|\mperson\M|\mfriend\M|\mfriends\M|\mfriendship\M|\mconnection\M|\mconnected\M|\mtogether\M|\msupport\M|\msupported\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'connection',0.900) on conflict do nothing;
  end if;
  if t ~ '(\mlove\M|\mloved\M|\mloving\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'love',0.950) on conflict do nothing;
  end if;
  if t ~ '(\mfamily\M|\mkid\M|\mkids\M|\mchild\M|\mchildren\M|\mdaughter\M|\mdaughters\M|\mgirl\M|\mgirls\M|\mmom\M|\mmum\M|\mmatt\M|\mlyra\M|\mchloe\M|\mposey\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'family',0.850) on conflict do nothing;
  end if;
  if t ~ '(\mcomfortable\M|\mcomfort\M|\mcoffee\M|\mwarm\M|\mcozy\M|\mhome\M|\mbath\M|\mbed\M|\msafe\M|\msafety\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'comfort',0.820) on conflict do nothing;
  end if;
  if t ~ '(\mgrow\M|\mgrowing\M|\mgrowth\M|\mbecoming\M|\mchoose\M|\mchoosing\M|\mchoice\M|\mhappiness\M|\mhappy\M|\mjoy\M|\mbetter version\M|\mbest version\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'growth',0.900) on conflict do nothing;
  end if;
  if t ~ '(\mhope\M|\mhopeful\M|\mdream\M|\mdreams\M|\mpossibility\M|\muniverse\M|\mfuture\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'hope',0.840) on conflict do nothing;
  end if;
  if t ~ '(\moutside\M|\moutdoors\M|\mnature\M|\mocean\M|\mbeach\M|\msky\M|\mwalk\M|\mwalking\M|\mgarden\M|\mfarm\M|\msun\M|\msunshine\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'nature',0.820) on conflict do nothing;
  end if;
  if t ~ '(\maccomplish\M|\maccomplished\M|\machievement\M|\mcomplete\M|\mcompleted\M|\mproud\M|\mwin\M|\mprogress\M|\mfinished\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'achievement',0.820) on conflict do nothing;
  end if;
  if t ~ '(\mcreate\M|\mcreative\M|\mcreativity\M|\mwrite\M|\mwriting\M|\mwriter\M|\mbook\M|\mphoto\M|\mphotography\M|\mtheater\M|\mtheatre\M|\mcostume\M|\mart\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'creativity',0.800) on conflict do nothing;
  end if;
  if t ~ '(\mrest\M|\mresting\M|\msleep\M|\myoga\M|\mself care\M|\mself-care\M|\mreading\M|\mread\M|\mfacial\M|\mjournal\M|\mjournaling\M)' then
    insert into private.reflection_themes(reflection_id,household_id,member_id,theme,confidence)
    values(r.id,r.household_id,r.member_id,'self_care',0.800) on conflict do nothing;
  end if;
end;
$$;

create or replace function private.refresh_weekly_reflection_insight(p_member_id uuid, p_week_start date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid; v_start date; v_end date; v_total integer := 0; v_days integer := 0;
  v_primary text; v_primary_count integer := 0; v_secondary text; v_secondary_count integer := 0;
  v_support uuid[] := '{}'::uuid[]; v_observation text; v_secondary_sentence text := '';
  v_conf numeric(4,3) := 0.000; v_id uuid;
begin
  select household_id into v_household from public.household_members where id = p_member_id;
  if v_household is null then return null; end if;
  v_start := coalesce(p_week_start, date_trunc('week', (now() at time zone 'America/Los_Angeles'))::date);
  v_end := v_start + 6;

  select count(*), count(distinct reflection_date) into v_total, v_days
  from public.reflections where member_id = p_member_id and reflection_date between v_start and v_end;

  select theme, count(*)::int into v_primary, v_primary_count
  from private.reflection_themes rt join public.reflections r on r.id=rt.reflection_id
  where rt.member_id=p_member_id and r.reflection_date between v_start and v_end
  group by theme order by count(*) desc, avg(rt.confidence) desc, theme limit 1;

  select theme, count(*)::int into v_secondary, v_secondary_count
  from private.reflection_themes rt join public.reflections r on r.id=rt.reflection_id
  where rt.member_id=p_member_id and r.reflection_date between v_start and v_end and theme is distinct from v_primary
  group by theme order by count(*) desc, avg(rt.confidence) desc, theme limit 1;

  if v_total < 3 or v_days < 2 or coalesce(v_primary_count,0) < 2 then
    insert into private.weekly_reflection_insights(household_id,member_id,week_start,week_end,available_on,observation,primary_theme,secondary_theme,supporting_reflection_ids,evidence_count,distinct_days,confidence,status,generated_at,updated_at)
    values(v_household,p_member_id,v_start,v_end,v_end,null,v_primary,v_secondary,'{}'::uuid[],coalesce(v_primary_count,0),v_days,0.000,'insufficient_data',now(),now())
    on conflict(member_id,week_start) do update set week_end=excluded.week_end,available_on=excluded.available_on,observation=null,primary_theme=excluded.primary_theme,secondary_theme=excluded.secondary_theme,supporting_reflection_ids='{}'::uuid[],evidence_count=excluded.evidence_count,distinct_days=excluded.distinct_days,confidence=0.000,status='insufficient_data',generated_at=now(),updated_at=now()
    returning id into v_id; return v_id;
  end if;

  select coalesce(array_agg(id order by reflection_date,created_at),'{}'::uuid[]) into v_support from (
    select r.id,r.reflection_date,r.created_at from public.reflections r join private.reflection_themes rt on rt.reflection_id=r.id
    where r.member_id=p_member_id and r.reflection_date between v_start and v_end and rt.theme=v_primary
    order by r.reflection_date,r.created_at limit 5
  ) q;

  v_observation := case v_primary
    when 'connection' then 'Connection keeps showing up in the moments you want to remember. People, friendship, and feeling supported appeared repeatedly in your reflections this week.'
    when 'love' then 'Love is a recurring thread in the moments you chose to preserve this week. Your reflections repeatedly returned to loving and being connected to the people who matter to you.'
    when 'family' then 'Family connection keeps appearing in the moments you want to remember. Time with the people closest to you was a repeated source of meaning in your reflections this week.'
    when 'comfort' then 'Small forms of comfort mattered repeatedly this week. Your reflections returned to ordinary things that made life feel warm, safe, or cared for.'
    when 'growth' then 'Growth is becoming visible in the way you describe your life. Your reflections repeatedly used language about choosing, becoming, or moving toward the person you want to be.'
    when 'hope' then 'Hope and possibility kept appearing in your reflections this week. You repeatedly returned to dreams, the future, or a sense that something good is still unfolding.'
    when 'nature' then 'Time outside and the natural world kept appearing in the moments that felt good to you this week. Nature seems to be one recurring source of restoration in what you wrote.'
    when 'achievement' then 'Progress mattered in your reflections this week. You repeatedly noticed things moving forward, getting finished, or giving you a sense of accomplishment.'
    when 'creativity' then 'Creativity kept appearing in the moments you wanted to preserve this week. Making, writing, or creating was a repeated source of meaning in what you shared.'
    when 'self_care' then 'Rest and restoration kept appearing in your reflections this week. The moments you chose to preserve repeatedly included ways of caring for your own energy.'
    else 'A theme repeated across several of the moments you chose to preserve this week.' end;

  if coalesce(v_secondary_count,0)>=2 then
    v_secondary_sentence := case v_secondary
      when 'connection' then ' Connection with other people also appeared more than once.' when 'love' then ' Love also appeared more than once.'
      when 'family' then ' Family connection also appeared more than once.' when 'comfort' then ' Everyday comfort also appeared more than once.'
      when 'growth' then ' Personal growth also appeared more than once.' when 'hope' then ' Hope and possibility also appeared more than once.'
      when 'nature' then ' Time outside also appeared more than once.' when 'achievement' then ' Progress and accomplishment also appeared more than once.'
      when 'creativity' then ' Creativity also appeared more than once.' when 'self_care' then ' Rest and self-care also appeared more than once.' else '' end;
  end if;

  v_observation := v_observation || v_secondary_sentence;
  v_conf := least(0.950,0.600+(least(v_primary_count,5)::numeric*0.060)+(least(v_days,4)::numeric*0.025));
  insert into private.weekly_reflection_insights(household_id,member_id,week_start,week_end,available_on,title,observation,primary_theme,secondary_theme,supporting_reflection_ids,evidence_count,distinct_days,confidence,status,generated_at,updated_at)
  values(v_household,p_member_id,v_start,v_end,v_end,'Something Pepper noticed this week…',v_observation,v_primary,case when v_secondary_count>=2 then v_secondary else null end,v_support,v_primary_count,v_days,v_conf,'ready',now(),now())
  on conflict(member_id,week_start) do update set week_end=excluded.week_end,available_on=excluded.available_on,title=excluded.title,observation=excluded.observation,primary_theme=excluded.primary_theme,secondary_theme=excluded.secondary_theme,supporting_reflection_ids=excluded.supporting_reflection_ids,evidence_count=excluded.evidence_count,distinct_days=excluded.distinct_days,confidence=excluded.confidence,status='ready',generated_at=now(),updated_at=now()
  returning id into v_id; return v_id;
end;
$$;

do $$ declare r record; begin for r in select id,member_id,reflection_date from public.reflections loop perform private.tag_reflection(r.id); perform private.refresh_weekly_reflection_insight(r.member_id,date_trunc('week',r.reflection_date::timestamp)::date); end loop; end $$;
