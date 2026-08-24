create or replace function public.normalize_event_kind_context()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_text text;
  v_title_location text;
begin
  v_text := lower(concat_ws(' ', new.title, new.notes, new.location));
  v_title_location := lower(concat_ws(' ', new.title, new.location));

  if new.kind = 'transport'
     and new.person_slug is null
     and v_text ~ '(house reset|bedroom|laundry|cleaning|declutter|tidy|chores?)'
     and v_title_location !~ '(pickup|pick up|dropoff|drop off|ride|driver|carpool|transport|school|airport)'
  then
    new.kind := 'activity';
    new.transport_owner_member_id := null;
    new.transport_status := null;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_normalize_event_kind_context on public.events;
create trigger trg_normalize_event_kind_context
before insert or update of kind,title,notes,location,person_slug,source
on public.events
for each row
execute function public.normalize_event_kind_context();

update public.events
set kind='activity', transport_owner_member_id=null, transport_status=null, updated_at=now()
where kind='transport'
  and person_slug is null
  and lower(concat_ws(' ', title, notes, location)) ~ '(house reset|bedroom|laundry|cleaning|declutter|tidy|chores?)'
  and lower(concat_ws(' ', title, location)) !~ '(pickup|pick up|dropoff|drop off|ride|driver|carpool|transport|school|airport)';
