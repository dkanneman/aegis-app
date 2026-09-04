-- Preview sessions were created by automated verification before family rollout.
-- Revoke those sessions so each real family member claims their profile with the
-- existing invitation code and creates a personal PIN on first phone sign-in.
update public.member_sessions session
set revoked_at = now(),
    last_seen_at = now()
from public.household_members member
join public.households household on household.id = member.household_id
where session.member_id = member.id
  and household.slug = 'eriksen'
  and session.revoked_at is null;

update public.household_members member
set pin_setup_completed_at = null
from public.households household
where household.id = member.household_id
  and household.slug = 'eriksen';
