-- Canonical capture reconciliation supports direct browser writes in the full
-- V6 deployment. The isolated private preview routes all writes through
-- trusted Edge Functions, so restore its stricter no-direct-table-access rule.

drop policy if exists captures_member_insert on public.captures;
revoke all on table public.captures from anon, authenticated;

notify pgrst, 'reload schema';
