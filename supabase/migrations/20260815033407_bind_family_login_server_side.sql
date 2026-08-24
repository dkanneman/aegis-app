drop function if exists public.pepper_start_session(text, text, text, text);

create or replace function public.pepper_start_family_session(
  member_slug_input text,
  pin_input text,
  device_label_input text default null
)
returns jsonb
language sql
security invoker
set search_path = public, private, pg_temp
as $$
  select private.pepper_start_session(
    'eriksen',
    member_slug_input,
    pin_input,
    device_label_input
  );
$$;

revoke execute on function public.pepper_start_family_session(text,text,text) from public;
grant execute on function public.pepper_start_family_session(text,text,text) to anon, authenticated;
