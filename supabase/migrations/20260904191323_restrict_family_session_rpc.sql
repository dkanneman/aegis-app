-- Family login is exposed only through pepper-family-api, which adds origin,
-- rate-limit, and response controls. Keep the underlying RPC off the Data API.
alter function public.pepper_start_family_session(text, text, text)
  security invoker;

revoke execute on function public.pepper_start_family_session(text, text, text)
  from public, anon, authenticated;
grant execute on function public.pepper_start_family_session(text, text, text)
  to service_role;
