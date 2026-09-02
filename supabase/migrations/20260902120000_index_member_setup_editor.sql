create index if not exists member_setup_profiles_updated_by_idx
  on private.member_setup_profiles (updated_by_member_id)
  where updated_by_member_id is not null;
