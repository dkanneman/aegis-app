-- Harden pre-authentication identity handling and preserve the native OAuth return target.

alter table private.calendar_oauth_states
  add column if not exists return_target text not null default 'web'
  check (return_target in ('web', 'pepper_ios'));

alter table private.integration_oauth_states
  add column if not exists return_target text not null default 'web'
  check (return_target in ('web', 'pepper_ios'));

create or replace function public.pepper_start_family_session(
  member_slug_input text,
  pin_input text,
  device_label_input text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to public, private, pg_temp
as $$
declare
  requested_identity text := lower(trim(coalesce(member_slug_input, '')));
  resolved_slug text;
begin
  -- A 10-digit PIN is reserved for the isolated TestFlight reviewer account.
  if requested_identity in ('elle', 'danielle')
     and coalesce(pin_input, '') ~ '^[0-9]{10}$' then
    return private.pepper_start_session(
      'pepper-review', 'reviewer', pin_input, device_label_input
    );
  end if;

  select m.slug
    into resolved_slug
  from public.household_members m
  join public.households h on h.id = m.household_id
  where h.slug = 'eriksen'
    and (
      lower(m.slug) = requested_identity
      or lower(m.display_name) = requested_identity
    )
  order by case when lower(m.slug) = requested_identity then 0 else 1 end
  limit 1;

  return private.pepper_start_session(
    'eriksen', coalesce(resolved_slug, requested_identity), pin_input, device_label_input
  );
end;
$$;

revoke execute on function public.pepper_start_family_session(text, text, text) from public;
grant execute on function public.pepper_start_family_session(text, text, text)
  to anon, authenticated, service_role;
