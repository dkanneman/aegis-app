-- Private-preview-only data for Apple's TestFlight reviewer.
-- The reviewer PIN is provisioned out of band and must never be committed here.

do $$
declare
  review_household_id uuid;
  reviewer_id uuid;
  partner_id uuid;
  teen_id uuid;
  child_id uuid;
  younger_child_id uuid;
  today_la date := (now() at time zone 'America/Los_Angeles')::date;
  first_meal_id uuid;
begin
  insert into public.households (slug, name)
  values ('pepper-review', 'Pepper Review Household')
  on conflict (slug) do update set name = excluded.name
  returning id into review_household_id;

  insert into public.household_members (household_id, slug, display_name, role)
  values
    (review_household_id, 'reviewer', 'Alex', 'adult_admin'),
    (review_household_id, 'partner', 'Jordan', 'adult'),
    (review_household_id, 'teen', 'Riley', 'teen'),
    (review_household_id, 'child', 'Casey', 'teen'),
    (review_household_id, 'younger-child', 'Sam', 'child')
  on conflict (household_id, slug) do update
    set display_name = excluded.display_name,
        role = excluded.role;

  select id into reviewer_id from public.household_members
  where household_id = review_household_id and slug = 'reviewer';
  select id into partner_id from public.household_members
  where household_id = review_household_id and slug = 'partner';
  select id into teen_id from public.household_members
  where household_id = review_household_id and slug = 'teen';
  select id into child_id from public.household_members
  where household_id = review_household_id and slug = 'child';
  select id into younger_child_id from public.household_members
  where household_id = review_household_id and slug = 'younger-child';

  insert into private.member_setup_profiles (
    member_id, household_id, activities, school_name, grade_label,
    dietary_preferences, medications, goals, updated_by_member_id
  ) values
    (reviewer_id, review_household_id, array['Work', 'Family coordination'], '', '', array['Vegetarian-friendly meals'], array[]::text[], array['Protect family time'], reviewer_id),
    (partner_id, review_household_id, array['Client meetings', 'School transportation'], '', '', array[]::text[], array[]::text[], array['Share household ownership'], reviewer_id),
    (teen_id, review_household_id, array['Theatre', 'Homework'], 'North Shore High School', '10th grade', array[]::text[], array[]::text[], array['Finish history project'], reviewer_id),
    (child_id, review_household_id, array['Cross country', 'Homework'], 'Harbor Middle School', '8th grade', array[]::text[], array[]::text[], array['Prepare for Friday meet'], reviewer_id),
    (younger_child_id, review_household_id, array['Dance', 'Reading'], 'Seaside Elementary School', '4th grade', array[]::text[], array[]::text[], array['Read twenty minutes'], reviewer_id)
  on conflict (member_id) do update set
    activities = excluded.activities,
    school_name = excluded.school_name,
    grade_label = excluded.grade_label,
    dietary_preferences = excluded.dietary_preferences,
    medications = excluded.medications,
    goals = excluded.goals,
    updated_by_member_id = excluded.updated_by_member_id,
    updated_at = now();

  insert into public.events (
    household_id, title, person_slug, starts_at, ends_at, location,
    status, visibility, owner_member_id, kind, transport_owner_member_id,
    transport_status, source, dedupe_key, notes
  ) values
    (review_household_id, 'Sam - School drop-off', 'younger-child', (today_la + time '07:50') at time zone 'America/Los_Angeles', (today_la + time '08:10') at time zone 'America/Los_Angeles', 'Seaside Elementary School', 'confirmed', 'household', reviewer_id, 'school_dropoff', reviewer_id, 'confirmed', 'review_fixture', 'review-school-dropoff-sam', 'Routine school transportation.'),
    (review_household_id, 'Riley - School drop-off', 'teen', (today_la + time '08:05') at time zone 'America/Los_Angeles', (today_la + time '08:25') at time zone 'America/Los_Angeles', 'North Shore High School', 'confirmed', 'household', partner_id, 'school_dropoff', partner_id, 'confirmed', 'review_fixture', 'review-school-dropoff-riley', 'Routine school transportation.'),
    (review_household_id, 'Casey - Cross country practice', 'child', (today_la + time '15:30') at time zone 'America/Los_Angeles', (today_la + time '17:00') at time zone 'America/Los_Angeles', 'Harbor Middle School', 'confirmed', 'household', child_id, 'activity', reviewer_id, 'assigned', 'review_fixture', 'review-cross-country', 'Bring water and running shoes.'),
    (review_household_id, 'Riley - Theatre rehearsal', 'teen', ((today_la + 1) + time '17:00') at time zone 'America/Los_Angeles', ((today_la + 1) + time '20:00') at time zone 'America/Los_Angeles', 'Community Arts Center', 'confirmed', 'household', teen_id, 'activity', partner_id, 'assigned', 'review_fixture', 'review-theatre-rehearsal', 'Pickup is assigned.'),
    (review_household_id, 'Sam - Annual checkup', 'younger-child', ((today_la + 2) + time '10:30') at time zone 'America/Los_Angeles', ((today_la + 2) + time '11:15') at time zone 'America/Los_Angeles', 'Harbor Family Clinic', 'confirmed', 'household', reviewer_id, 'appointment', reviewer_id, 'confirmed', 'review_fixture', 'review-annual-checkup', 'Synthetic appointment for App Review.'),
    (review_household_id, 'Family dinner', null, ((today_la + 2) + time '18:30') at time zone 'America/Los_Angeles', ((today_la + 2) + time '19:30') at time zone 'America/Los_Angeles', 'Home', 'confirmed', 'household', reviewer_id, 'event', null, null, 'review_fixture', 'review-family-dinner', 'Weekly family dinner.');

  insert into public.tasks (
    household_id, title, owner_member_id, creator_member_id, visibility,
    status, due_at, source, area, project, priority, classification,
    tags, notes, recurrence, next_action
  ) values
    (review_household_id, 'Send client follow-up', reviewer_id, reviewer_id, 'private', 'open', (today_la + time '11:30') at time zone 'America/Los_Angeles', 'review_fixture', 'Work', 'Client work', 'P1', 'Open', array['work'], 'Synthetic work item for App Review.', 'none', 'Send the prepared follow-up.'),
    (review_household_id, 'Confirm Friday transportation', partner_id, reviewer_id, 'household', 'open', ((today_la + 1) + time '17:00') at time zone 'America/Los_Angeles', 'review_fixture', 'Family', 'Family coordination', 'P1', 'Open', array['family', 'transportation'], 'Confirm the pickup handoff.', 'none', 'Confirm the assigned driver.'),
    (review_household_id, 'Unload dishwasher', teen_id, reviewer_id, 'household', 'open', (today_la + time '17:00') at time zone 'America/Los_Angeles', 'review_fixture', 'Home', 'Family chores', 'P2', 'Chore', array['home', 'chores'], 'Shared household chore.', 'daily', 'Unload the dishwasher.'),
    (review_household_id, 'Finish history project outline', teen_id, teen_id, 'private', 'in_progress', ((today_la + 1) + time '17:00') at time zone 'America/Los_Angeles', 'review_fixture', 'School', 'History', 'P1', 'Open', array['school', 'homework'], 'Personal school task.', 'none', 'Draft the final two sections.'),
    (review_household_id, 'Set the table', younger_child_id, reviewer_id, 'household', 'open', (today_la + time '18:00') at time zone 'America/Los_Angeles', 'review_fixture', 'Home', 'Family chores', 'P2', 'Chore', array['home', 'chores'], 'Shared household chore.', 'daily', 'Set plates and napkins.') ;

  insert into public.meal_plan (
    household_id, meal_date, meal_name, prep_at, eat_at,
    owner_member_id, shopping_owner_member_id
  ) values
    (review_household_id, today_la, 'Build-your-own taco bowls', (today_la + time '17:45') at time zone 'America/Los_Angeles', (today_la + time '18:30') at time zone 'America/Los_Angeles', reviewer_id, partner_id),
    (review_household_id, today_la + 1, 'Pasta marinara and salad', ((today_la + 1) + time '17:45') at time zone 'America/Los_Angeles', ((today_la + 1) + time '18:30') at time zone 'America/Los_Angeles', partner_id, partner_id),
    (review_household_id, today_la + 2, 'Sheet-pan vegetables and rice', ((today_la + 2) + time '17:30') at time zone 'America/Los_Angeles', ((today_la + 2) + time '18:30') at time zone 'America/Los_Angeles', reviewer_id, partner_id)
  on conflict (household_id, meal_date) do update set
    meal_name = excluded.meal_name,
    prep_at = excluded.prep_at,
    eat_at = excluded.eat_at,
    owner_member_id = excluded.owner_member_id,
    shopping_owner_member_id = excluded.shopping_owner_member_id,
    updated_at = now();

  select id into first_meal_id from public.meal_plan
  where household_id = review_household_id and meal_date = today_la;

  insert into public.groceries (
    household_id, item, status, added_by_member_id, owner_member_id, meal_plan_id
  ) values
    (review_household_id, 'Black beans', 'open', reviewer_id, partner_id, first_meal_id),
    (review_household_id, 'Avocados', 'open', reviewer_id, partner_id, first_meal_id),
    (review_household_id, 'Salad greens', 'open', reviewer_id, reviewer_id, null);

  insert into public.family_meal_needs (
    household_id, member_id, need_type, label, details, created_by_member_id
  ) values
    (review_household_id, reviewer_id, 'preference', 'Vegetarian-friendly', 'Include a meat-free option.', reviewer_id),
    (review_household_id, younger_child_id, 'preference', 'Mild flavors', 'Keep one serving mild.', reviewer_id);
end;
$$;

create or replace function public.pepper_start_family_session(
  member_slug_input text,
  pin_input text,
  device_label_input text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to public, private, pg_temp
as $$
begin
  -- A 10-digit PIN is reserved for the isolated TestFlight reviewer account.
  if lower(trim(coalesce(member_slug_input, ''))) = 'elle'
     and coalesce(pin_input, '') ~ '^[0-9]{10}$' then
    return private.pepper_start_session(
      'pepper-review', 'reviewer', pin_input, device_label_input
    );
  end if;

  return private.pepper_start_session(
    'eriksen', member_slug_input, pin_input, device_label_input
  );
end;
$$;

revoke execute on function public.pepper_start_family_session(text, text, text) from public;
grant execute on function public.pepper_start_family_session(text, text, text) to anon, authenticated, service_role;
