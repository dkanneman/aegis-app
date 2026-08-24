-- Pepper -> AEGIS durable capture bridge.
alter table public.captures
  add column if not exists aegis_sync_status text,
  add column if not exists aegis_last_attempt_at timestamptz,
  add column if not exists aegis_synced_at timestamptz,
  add column if not exists aegis_destination text,
  add column if not exists aegis_record_ids jsonb,
  add column if not exists aegis_sync_error text;

update public.captures
set aegis_sync_status = 'pending'
where aegis_sync_status is null;

alter table public.captures
  alter column aegis_sync_status set default 'pending',
  alter column aegis_sync_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.captures'::regclass
      and conname = 'captures_aegis_sync_status_check'
  ) then
    alter table public.captures
      add constraint captures_aegis_sync_status_check
      check (aegis_sync_status in ('pending', 'synced', 'needs_review', 'failed', 'not_applicable'));
  end if;
end;
$$;

create index if not exists captures_aegis_pending_idx
  on public.captures (captured_at)
  where aegis_sync_status in ('pending', 'failed', 'needs_review');

comment on column public.captures.aegis_sync_status is
  'Separate downstream state for ingestion into AEGIS HOME. Pepper interpretation status remains in captures.status.';

create or replace function public.pepper_capture_input(
  session_token_input uuid,
  source_input text,
  original_text_input text,
  dedupe_key_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  current_member uuid;
  current_household uuid;
  capture_id_value uuid;
  source_value text;
  original_text_value text;
  dedupe_key_value text;
  captured_at_value timestamptz;
begin
  current_member := private.pepper_set_session(session_token_input);
  current_household := private.pepper_current_household_id();
  perform private.pepper_touch_session(session_token_input);

  source_value := case lower(trim(coalesce(source_input, 'text')))
    when 'voice' then 'voice'
    when 'text' then 'text'
    else 'text'
  end;
  original_text_value := trim(coalesce(original_text_input, ''));
  dedupe_key_value := left(nullif(trim(coalesce(dedupe_key_input, '')), ''), 200);

  if original_text_value = '' then
    raise exception 'Tell Pepper something to save.' using errcode = '22023';
  end if;
  if length(original_text_value) > 4000 then
    raise exception 'That note is too long. Keep it under 4,000 characters.' using errcode = '22023';
  end if;

  if dedupe_key_value is not null then
    select c.id, c.captured_at
    into capture_id_value, captured_at_value
    from public.captures c
    where c.household_id = current_household
      and c.member_id = current_member
      and c.dedupe_key = dedupe_key_value
    limit 1;
  end if;

  if capture_id_value is null then
    insert into public.captures (
      household_id,
      member_id,
      source,
      original_text,
      status,
      extracted_facts,
      applied_changes,
      dedupe_key,
      aegis_sync_status
    ) values (
      current_household,
      current_member,
      source_value,
      original_text_value,
      'captured',
      '[]'::jsonb,
      '[]'::jsonb,
      dedupe_key_value,
      'pending'
    )
    on conflict (household_id, dedupe_key) where dedupe_key is not null
    do nothing
    returning id, captured_at into capture_id_value, captured_at_value;

    if capture_id_value is null and dedupe_key_value is not null then
      select c.id, c.captured_at
      into capture_id_value, captured_at_value
      from public.captures c
      where c.household_id = current_household
        and c.member_id = current_member
        and c.dedupe_key = dedupe_key_value
      limit 1;
    end if;
  end if;

  if capture_id_value is null then
    raise exception 'Pepper could not preserve that note.' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'capture_id', capture_id_value,
    'status', 'captured',
    'aegis_sync_status', 'pending',
    'captured_at', captured_at_value
  );
end;
$$;

create or replace function public.pepper_finalize_capture(
  session_token_input uuid,
  capture_id_input uuid,
  status_input text,
  extracted_facts_input jsonb default '[]'::jsonb,
  applied_changes_input jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  current_member uuid;
  current_household uuid;
  status_value text;
begin
  current_member := private.pepper_set_session(session_token_input);
  current_household := private.pepper_current_household_id();
  perform private.pepper_touch_session(session_token_input);

  status_value := lower(trim(coalesce(status_input, 'needs_review')));
  if status_value not in ('applied', 'partially_applied', 'needs_review') then
    raise exception 'Invalid capture status.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(extracted_facts_input, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(applied_changes_input, '[]'::jsonb)) <> 'array' then
    raise exception 'Capture facts and changes must be arrays.' using errcode = '22023';
  end if;
  if length(coalesce(extracted_facts_input, '[]'::jsonb)::text) > 10000
     or length(coalesce(applied_changes_input, '[]'::jsonb)::text) > 10000 then
    raise exception 'Capture result is too large.' using errcode = '22023';
  end if;

  update public.captures
  set status = status_value,
      extracted_facts = coalesce(extracted_facts_input, '[]'::jsonb),
      applied_changes = coalesce(applied_changes_input, '[]'::jsonb),
      updated_at = now()
  where id = capture_id_input
    and household_id = current_household
    and member_id = current_member;

  if not found then
    raise exception 'Capture not found or not permitted.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'capture_id', capture_id_input,
    'status', status_value,
    'aegis_sync_status', 'pending'
  );
end;
$$;

revoke all on public.captures from anon, authenticated;

revoke execute on function public.pepper_capture_input(uuid,text,text,text) from public;
revoke execute on function public.pepper_finalize_capture(uuid,uuid,text,jsonb,jsonb) from public;
grant execute on function public.pepper_capture_input(uuid,text,text,text) to anon, authenticated;
grant execute on function public.pepper_finalize_capture(uuid,uuid,text,jsonb,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
