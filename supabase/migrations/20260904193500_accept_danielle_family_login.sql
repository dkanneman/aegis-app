create or replace function public.pepper_start_family_session(
  member_slug_input text,
  pin_input text,
  device_label_input text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_identity text := lower(trim(coalesce(member_slug_input, '')));
  resolved_slug text;
begin
  -- A 10-digit PIN remains reserved for the isolated TestFlight reviewer.
  if requested_identity in ('elle', 'danielle')
     and coalesce(pin_input, '') ~ '^[0-9]{10}$' then
    return private.pepper_start_session(
      'pepper-review', 'reviewer', pin_input, device_label_input
    );
  end if;

  -- Danielle's canonical member slug predates the Pepper product name shown
  -- in the interface. Accept either name without duplicating her profile.
  if requested_identity = 'danielle' then
    requested_identity := 'elle';
  end if;

  select member.slug
  into resolved_slug
  from public.household_members member
  join public.households household on household.id = member.household_id
  where household.slug = 'eriksen'
    and (
      lower(member.slug) = requested_identity
      or lower(member.display_name) = requested_identity
    )
  order by case when lower(member.slug) = requested_identity then 0 else 1 end
  limit 1;

  return private.pepper_start_session(
    'eriksen', coalesce(resolved_slug, requested_identity), pin_input, device_label_input
  );
end;
$$;

revoke execute on function public.pepper_start_family_session(text, text, text)
  from public, anon, authenticated;
grant execute on function public.pepper_start_family_session(text, text, text)
  to service_role;
