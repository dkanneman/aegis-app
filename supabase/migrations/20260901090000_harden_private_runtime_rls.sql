-- Defense in depth for private runtime tables used only by trusted functions.
-- The conditional form keeps this migration valid while the repository's
-- historical calendar-table migration gap is reconciled separately.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'pepper_login_attempts',
    'calendar_oauth_states',
    'calendar_tokens',
    'calendar_sync_runs',
    'member_ritual_preferences',
    'ritual_delivery_queue'
  ] loop
    if to_regclass(format('private.%I', relation_name)) is not null then
      execute format('alter table private.%I enable row level security', relation_name);
      execute format('revoke all on table private.%I from anon, authenticated', relation_name);
    end if;
  end loop;
end;
$$;
