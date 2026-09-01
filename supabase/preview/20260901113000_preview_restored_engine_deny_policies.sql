-- Make the restored V6 engine tables explicitly inaccessible to direct clients.
-- Trusted Edge Functions use the database runtime connection instead.

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'family_routines',
    'future_watch_items',
    'reflection_themes',
    'weekly_reflection_insights'
  ]
  loop
    if to_regclass(format('private.%I', relation_name)) is not null then
      execute format(
        'create policy %I on private.%I for all to anon, authenticated using (false) with check (false)',
        'deny_direct_' || relation_name,
        relation_name
      );
    end if;
  end loop;

  foreach relation_name in array array['consequences', 'preparation_actions']
  loop
    if to_regclass(format('public.%I', relation_name)) is not null then
      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
        'deny_direct_' || relation_name,
        relation_name
      );
    end if;
  end loop;
end;
$$;
