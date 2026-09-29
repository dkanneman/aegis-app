-- Runtime dependency previously defined only in the TestFlight preview chain.
-- Existing states retain their IDs, PKCE verifiers, ownership and expiry.
begin;

alter table private.calendar_oauth_states
  add column if not exists return_target text not null default 'web';

-- Preserve a preview-installed column; reject incompatible data rather than
-- silently converting an existing native return target or discarding a state.
do $$
begin
  if exists (
    select 1 from private.calendar_oauth_states
    where return_target is null or return_target not in ('web', 'pepper_ios')
  ) then
    raise exception 'Calendar OAuth return targets require reconciliation before migration.';
  end if;
end;
$$;

alter table private.calendar_oauth_states
  alter column return_target set default 'web',
  alter column return_target set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.calendar_oauth_states'::regclass
      and conname = 'calendar_oauth_states_return_target_check'
  ) then
    alter table private.calendar_oauth_states
      add constraint calendar_oauth_states_return_target_check
      check (return_target in ('web', 'pepper_ios'));
  end if;
end;
$$;

commit;
