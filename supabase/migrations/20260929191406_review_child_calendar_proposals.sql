-- Extend the existing capture/reconciliation ledger, not a second event pipeline.
alter table public.captures add column if not exists calendar_proposal jsonb;
alter table public.captures add column if not exists proposal_decision text;
do $$ begin
if not exists(select 1 from pg_constraint where conrelid='public.captures'::regclass and conname='captures_calendar_proposal_check') then
alter table public.captures add constraint captures_calendar_proposal_check check (
  (calendar_proposal is null and proposal_decision is null) or
  (calendar_proposal is not null and jsonb_typeof(calendar_proposal)='object'
   and proposal_decision is not null and proposal_decision in ('pending','approved','declined'))
);
end if; end $$;

-- Keep the established canonical writer intact except for this narrow delegation.
-- Fail closed if its reviewed ownership check has changed.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('private.apply_capture_plan(uuid,uuid,text,jsonb)'::regprocedure);
  if position('capture_row.calendar_proposal->''plan''=plan_input' in definition)>0 then
    if position('child.role in (''child'',''teen'')' in definition)>0 then return; end if;
    -- Upgrade only the reviewed child-only local rehearsal guard. This release
    -- migration has not been deployed; unknown definitions still fail closed.
    if position('child.role=''child''' in definition)=0 then
      raise exception 'Unrecognized proposal role authorization implementation';
    end if;
    execute replace(definition, 'child.role=''child''', 'child.role in (''child'',''teen'')');
    return;
  end if;
  if position('if not found or capture_row.member_id is distinct from actor_member_id_input then' in definition)=0 then
    raise exception 'Unrecognized capture authorization implementation';
  end if;
  definition := replace(definition,
    'if not found or capture_row.member_id is distinct from actor_member_id_input then',
    $guard$if not found or (capture_row.member_id is distinct from actor_member_id_input and not (
      capture_row.sharing_scope='household'
      and capture_row.calendar_proposal is not null and capture_row.proposal_decision is not null
      and capture_row.proposal_decision='pending'
      and capture_row.calendar_proposal->'plan'=plan_input
      and plan_kind_value='review_resolution'
      and exists(select 1 from public.household_members reviewer
        where reviewer.id=actor_member_id_input and reviewer.household_id=capture_row.household_id
          and reviewer.active and reviewer.removed_at is null and reviewer.role in ('adult','adult_admin'))
      and exists(select 1 from public.household_members child
        where child.id=capture_row.member_id and child.household_id=capture_row.household_id
          and child.role in ('child','teen'))
    )) then$guard$);
  execute definition;
end;
$migration$;

comment on column public.captures.calendar_proposal is
  'Server-frozen child or teen calendar interpretation. Only the capture owner and same-household adult reviewers receive its safe preview.';
-- Existing captures RLS/grants remain unchanged. No browser RPC or new grant.
