-- Supabase hosted projects provide pg_cron as a platform-managed extension.
-- The local CLI database image ships the extension but does not enable it.
-- Apply this file only to a disposable local rehearsal before release preflight.

create extension if not exists pg_cron;
