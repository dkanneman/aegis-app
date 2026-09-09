alter table private.member_setup_profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'pepper-profile-photos',
  'pepper-profile-photos',
  false,
  1048576,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on column private.member_setup_profiles.avatar_path is
  'Private Supabase Storage object path for the member profile photo. Access is brokered by pepper-family-api.';

comment on column private.member_setup_profiles.avatar_updated_at is
  'Time the member profile photo was last replaced.';
