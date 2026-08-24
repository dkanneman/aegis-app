do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.captures'::regclass
      and conname = 'captures_original_text_length_check'
  ) then
    alter table public.captures
      add constraint captures_original_text_length_check
      check (length(original_text) <= 4000);
  end if;
end;
$$;

alter function public.pepper_capture_input(uuid,text,text,text) security invoker;
alter function public.pepper_finalize_capture(uuid,uuid,text,jsonb,jsonb) security invoker;

drop policy if exists captures_member_select on public.captures;
create policy captures_member_select
on public.captures for select to anon, authenticated
using (
  household_id = (select private.pepper_current_household_id())
  and member_id = (select private.pepper_current_member_id())
);

drop policy if exists captures_member_insert on public.captures;
create policy captures_member_insert
on public.captures for insert to anon, authenticated
with check (
  household_id = (select private.pepper_current_household_id())
  and member_id = (select private.pepper_current_member_id())
  and source in ('voice', 'text')
  and aegis_sync_status = 'pending'
);

drop policy if exists captures_member_update on public.captures;
create policy captures_member_update
on public.captures for update to anon, authenticated
using (
  household_id = (select private.pepper_current_household_id())
  and member_id = (select private.pepper_current_member_id())
)
with check (
  household_id = (select private.pepper_current_household_id())
  and member_id = (select private.pepper_current_member_id())
);

revoke all on public.captures from anon, authenticated;
grant select (id, household_id, member_id, dedupe_key, captured_at)
  on public.captures to anon, authenticated;
grant insert (
  household_id, member_id, source, original_text, status,
  extracted_facts, applied_changes, dedupe_key, aegis_sync_status
) on public.captures to anon, authenticated;
grant update (status, extracted_facts, applied_changes, updated_at)
  on public.captures to anon, authenticated;

notify pgrst, 'reload schema';
