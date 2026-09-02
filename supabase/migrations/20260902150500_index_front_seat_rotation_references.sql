create index if not exists family_rotations_created_by_member_idx
  on private.family_rotations (created_by_member_id)
  where created_by_member_id is not null;

create index if not exists family_rotations_updated_by_member_idx
  on private.family_rotations (updated_by_member_id)
  where updated_by_member_id is not null;

create index if not exists family_rotation_days_assigned_member_idx
  on private.family_rotation_days (assigned_member_id);

create index if not exists family_rotation_days_updated_by_member_idx
  on private.family_rotation_days (updated_by_member_id)
  where updated_by_member_id is not null;

create index if not exists family_rotation_days_confirmed_by_member_idx
  on private.family_rotation_days (confirmed_by_member_id)
  where confirmed_by_member_id is not null;
