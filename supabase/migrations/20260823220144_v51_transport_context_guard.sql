create or replace function public.recompute_household_consequences(p_household_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  v_member_id uuid;
  v_member_name text;
  v_fingerprint text;
  v_seen text[] := array[]::text[];
  v_when text;
begin
  for r in
    select e.*
    from public.events e
    where e.household_id = p_household_id
      and e.status in ('tentative','confirmed')
      and e.kind in ('transport','school_dropoff','school_pickup')
      and (
        e.kind in ('school_dropoff','school_pickup')
        or e.person_slug is not null
        or lower(concat_ws(' ', e.title, e.location)) ~ '(pickup|pick up|dropoff|drop off|ride|driver|carpool|transport)'
      )
      and (e.transport_owner_member_id is null or coalesce(e.transport_status,'unassigned') = 'unassigned')
      and e.starts_at >= now() - interval '2 hours'
  loop
    v_when := to_char(r.starts_at at time zone 'America/Los_Angeles', 'FMDay at FMHH12:MI AM');
    v_fingerprint := 'missing_transport:' || r.id::text;
    v_seen := array_append(v_seen, v_fingerprint);
    insert into public.consequences(household_id,consequence_type,severity,status,title,summary,event_id,fingerprint,last_seen_at,resolved_at,metadata)
    values (p_household_id,'missing_transport','needs_attention','open','Ride needed',r.title || ' on ' || v_when || ' needs a driver.',r.id,v_fingerprint,now(),null,jsonb_build_object('starts_at',r.starts_at,'person_slug',r.person_slug))
    on conflict (household_id,fingerprint) do update
      set status='open', title=excluded.title, summary=excluded.summary, last_seen_at=now(), resolved_at=null, metadata=excluded.metadata;
  end loop;

  for r in
    select e.*
    from public.events e
    where e.household_id = p_household_id
      and e.status in ('tentative','confirmed')
      and e.adult_required = true
      and e.adult_owner_member_id is null
      and e.starts_at >= now() - interval '2 hours'
  loop
    v_when := to_char(r.starts_at at time zone 'America/Los_Angeles', 'FMDay at FMHH12:MI AM');
    v_fingerprint := 'missing_required_adult:' || r.id::text;
    v_seen := array_append(v_seen, v_fingerprint);
    insert into public.consequences(household_id,consequence_type,severity,status,title,summary,event_id,fingerprint,last_seen_at,resolved_at,metadata)
    values (p_household_id,'missing_required_adult','needs_attention','open','Adult needed',r.title || ' on ' || v_when || ' needs an adult assigned.',r.id,v_fingerprint,now(),null,jsonb_build_object('starts_at',r.starts_at,'requirement',r.adult_requirement_label))
    on conflict (household_id,fingerprint) do update
      set status='open', title=excluded.title, summary=excluded.summary, last_seen_at=now(), resolved_at=null, metadata=excluded.metadata;
  end loop;

  for r in
    select e1.id event_id, e2.id related_event_id, e1.person_slug,
           e1.title title1, e2.title title2,
           e1.starts_at start1, e2.starts_at start2,
           least(coalesce(e1.ends_at,e1.starts_at + interval '60 minutes'),coalesce(e2.ends_at,e2.starts_at + interval '60 minutes')) overlap_end,
           greatest(e1.starts_at,e2.starts_at) overlap_start
    from public.events e1
    join public.events e2
      on e2.household_id=e1.household_id
     and e2.person_slug=e1.person_slug
     and e2.id > e1.id
     and tstzrange(e1.starts_at,coalesce(e1.ends_at,e1.starts_at + interval '60 minutes'),'[)') && tstzrange(e2.starts_at,coalesce(e2.ends_at,e2.starts_at + interval '60 minutes'),'[)')
    where e1.household_id=p_household_id
      and e1.person_slug is not null
      and e1.status in ('tentative','confirmed')
      and e2.status in ('tentative','confirmed')
      and greatest(e1.starts_at,e2.starts_at) >= now() - interval '2 hours'
  loop
    select id,display_name into v_member_id,v_member_name from public.household_members where household_id=p_household_id and slug=r.person_slug limit 1;
    v_fingerprint := 'person_conflict:' || least(r.event_id::text,r.related_event_id::text) || ':' || greatest(r.event_id::text,r.related_event_id::text);
    v_seen := array_append(v_seen,v_fingerprint);
    insert into public.consequences(household_id,consequence_type,severity,status,title,summary,affected_member_id,event_id,related_event_id,fingerprint,last_seen_at,resolved_at,metadata)
    values (p_household_id,'person_conflict','urgent','open',coalesce(v_member_name,r.person_slug) || ' is double-booked',r.title1 || ' overlaps with ' || r.title2 || '.',v_member_id,r.event_id,r.related_event_id,v_fingerprint,now(),null,jsonb_build_object('overlap_start',r.overlap_start,'overlap_end',r.overlap_end))
    on conflict (household_id,fingerprint) do update
      set status='open',title=excluded.title,summary=excluded.summary,affected_member_id=excluded.affected_member_id,last_seen_at=now(),resolved_at=null,metadata=excluded.metadata;
  end loop;

  for r in
    select ride.id event_id, driver_event.id related_event_id, ride.transport_owner_member_id driver_id,
           ride.title ride_title, driver_event.title driver_title,
           ride.starts_at ride_start, driver_event.starts_at driver_start
    from public.events ride
    join public.household_members hm on hm.id=ride.transport_owner_member_id and hm.household_id=ride.household_id
    join public.events driver_event
      on driver_event.household_id=ride.household_id
     and driver_event.person_slug=hm.slug
     and driver_event.id<>ride.id
     and driver_event.status in ('tentative','confirmed')
     and tstzrange(ride.starts_at,coalesce(ride.ends_at,ride.starts_at + interval '60 minutes'),'[)') && tstzrange(driver_event.starts_at,coalesce(driver_event.ends_at,driver_event.starts_at + interval '60 minutes'),'[)')
    where ride.household_id=p_household_id
      and ride.status in ('tentative','confirmed')
      and ride.transport_owner_member_id is not null
      and ride.starts_at >= now() - interval '2 hours'
  loop
    select display_name into v_member_name from public.household_members where id=r.driver_id;
    v_fingerprint := 'driver_conflict:' || r.event_id::text || ':' || r.related_event_id::text || ':' || r.driver_id::text;
    v_seen := array_append(v_seen,v_fingerprint);
    insert into public.consequences(household_id,consequence_type,severity,status,title,summary,affected_member_id,event_id,related_event_id,fingerprint,last_seen_at,resolved_at,metadata)
    values (p_household_id,'driver_conflict','urgent','open',coalesce(v_member_name,'Assigned driver') || ' may not be available',coalesce(v_member_name,'The assigned driver') || ' is assigned to ' || r.ride_title || ' while ' || r.driver_title || ' overlaps.',r.driver_id,r.event_id,r.related_event_id,v_fingerprint,now(),null,jsonb_build_object('ride_start',r.ride_start,'driver_event_start',r.driver_start))
    on conflict (household_id,fingerprint) do update
      set status='open',title=excluded.title,summary=excluded.summary,affected_member_id=excluded.affected_member_id,last_seen_at=now(),resolved_at=null,metadata=excluded.metadata;
  end loop;

  update public.consequences
     set status='resolved', resolved_at=coalesce(resolved_at,now())
   where household_id=p_household_id
     and status='open'
     and not (fingerprint = any(v_seen));
end;
$function$;
