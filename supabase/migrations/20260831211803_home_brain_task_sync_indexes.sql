create index if not exists home_brain_task_exports_household_idx
  on private.home_brain_task_exports (household_id);

create index if not exists home_brain_task_ledger_actor_member_idx
  on private.home_brain_task_ledger (actor_member_id)
  where actor_member_id is not null;
