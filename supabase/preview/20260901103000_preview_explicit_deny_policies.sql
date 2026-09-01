-- The preview API uses trusted server functions with Pepper sessions.
-- Browser database roles have no direct table access.

do $$
declare
  item record;
begin
  for item in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname in ('public', 'private')
      and c.relrowsecurity
  loop
    execute format(
      'revoke all on table %I.%I from anon, authenticated',
      item.schema_name,
      item.table_name
    );

    if not exists (
      select 1
      from pg_policies p
      where p.schemaname = item.schema_name
        and p.tablename = item.table_name
        and p.policyname = 'pepper_no_direct_access'
    ) then
      execute format(
        'create policy pepper_no_direct_access on %I.%I for all to anon, authenticated using (false) with check (false)',
        item.schema_name,
        item.table_name
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.pepper_start_family_session(text, text, text)
  to anon, authenticated;
