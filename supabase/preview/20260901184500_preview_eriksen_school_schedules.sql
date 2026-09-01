-- Preview-only verified 2026-27 school state for the Eriksen household.
-- Dates and bell times were checked against official district and school sources
-- on 2026-09-01. Production remains unchanged until a separate reviewed cutover.

with profile_rows as (
  select * from (values
    (
      'posey', '2026-27', 'La Mariposa Elementary School',
      'Pleasant Valley School District', '5th grade',
      time '07:50', time '08:05', time '14:25',
      date '2026-08-19', date '2027-06-11',
      'La Mariposa FAQ and bell times',
      'https://lms.pleasantvalleysd.org/faq'
    ),
    (
      'chloe', '2026-27', 'Las Colinas Middle School',
      'Pleasant Valley School District', '7th grade',
      time '08:15', null::time, time '15:05',
      date '2026-08-19', date '2027-06-11',
      'Las Colinas bell schedule',
      'https://www.pleasantvalleysd.org/fs/resource-manager/view/2a855926-b72d-4c4c-b828-4b93aa4bd3b3'
    ),
    (
      'lyra', '2026-27', 'Rancho Campana High School',
      'Oxnard Union High School District', 'Sophomore',
      time '08:00', null::time, time '15:33',
      date '2026-08-12', date '2027-06-02',
      'Rancho Campana bell schedule',
      'https://www.ranchocampanahigh.us/about-us/bell-schedule'
    )
  ) as rows(
    member_slug, academic_year, school_name, district_name, grade_label,
    family_arrival_target_local, first_bell_local, normal_dismissal_local,
    first_day, last_day, source_label, source_url
  )
)
insert into private.school_profiles (
  household_id,
  student_member_id,
  academic_year,
  school_name,
  district_name,
  grade_label,
  timezone,
  family_arrival_target_local,
  first_bell_local,
  normal_dismissal_local,
  first_day,
  last_day,
  source_label,
  source_url,
  source_checked_on,
  confidence
)
select
  h.id,
  m.id,
  p.academic_year,
  p.school_name,
  p.district_name,
  p.grade_label,
  'America/Los_Angeles',
  p.family_arrival_target_local,
  p.first_bell_local,
  p.normal_dismissal_local,
  p.first_day,
  p.last_day,
  p.source_label,
  p.source_url,
  date '2026-09-01',
  1.000
from profile_rows p
join public.households h on h.slug = 'eriksen'
join public.household_members m
  on m.household_id = h.id
 and m.slug = p.member_slug
on conflict (household_id, student_member_id, academic_year) do update set
  school_name = excluded.school_name,
  district_name = excluded.district_name,
  grade_label = excluded.grade_label,
  timezone = excluded.timezone,
  family_arrival_target_local = excluded.family_arrival_target_local,
  first_bell_local = excluded.first_bell_local,
  normal_dismissal_local = excluded.normal_dismissal_local,
  first_day = excluded.first_day,
  last_day = excluded.last_day,
  source_label = excluded.source_label,
  source_url = excluded.source_url,
  source_checked_on = excluded.source_checked_on,
  confidence = excluded.confidence,
  updated_at = now();

with rule_rows as (
  select * from (values
    (
      'posey', 'normal_day', 'Normal dismissal',
      array[1,2,3,4,5]::smallint[], time '14:25',
      'La Mariposa FAQ and bell times',
      'https://lms.pleasantvalleysd.org/faq'
    ),
    (
      'chloe', 'normal_day', 'Normal dismissal',
      array[1,2,3,4,5]::smallint[], time '15:05',
      'Las Colinas bell schedule',
      'https://www.pleasantvalleysd.org/fs/resource-manager/view/2a855926-b72d-4c4c-b828-4b93aa4bd3b3'
    ),
    (
      'chloe', 'recurring_early_release', 'Thursday early release',
      array[4]::smallint[], time '14:05',
      'Las Colinas bell schedule',
      'https://www.pleasantvalleysd.org/fs/resource-manager/view/2a855926-b72d-4c4c-b828-4b93aa4bd3b3'
    ),
    (
      'lyra', 'normal_day', 'Normal dismissal',
      array[1,2,3,4,5]::smallint[], time '15:33',
      'Rancho Campana bell schedule',
      'https://www.ranchocampanahigh.us/about-us/bell-schedule'
    ),
    (
      'lyra', 'recurring_early_release', 'Friday early release',
      array[5]::smallint[], time '14:40',
      'Rancho Campana bell schedule',
      'https://www.ranchocampanahigh.us/about-us/bell-schedule'
    )
  ) as rows(
    member_slug, rule_kind, title, days_of_week, dismissal_local,
    source_label, source_url
  )
)
insert into private.school_schedule_rules (
  school_profile_id,
  rule_kind,
  title,
  days_of_week,
  dismissal_local,
  starts_on,
  ends_on,
  transportation_impact,
  source_label,
  source_url,
  source_checked_on,
  confidence
)
select
  p.id,
  r.rule_kind,
  r.title,
  r.days_of_week,
  r.dismissal_local,
  p.first_day,
  p.last_day,
  true,
  r.source_label,
  r.source_url,
  date '2026-09-01',
  1.000
from rule_rows r
join public.households h on h.slug = 'eriksen'
join public.household_members m
  on m.household_id = h.id
 and m.slug = r.member_slug
join private.school_profiles p
  on p.household_id = h.id
 and p.student_member_id = m.id
 and p.academic_year = '2026-27'
on conflict (school_profile_id, rule_kind, title) do update set
  days_of_week = excluded.days_of_week,
  dismissal_local = excluded.dismissal_local,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  transportation_impact = excluded.transportation_impact,
  source_label = excluded.source_label,
  source_url = excluded.source_url,
  source_checked_on = excluded.source_checked_on,
  confidence = excluded.confidence,
  updated_at = now();

with closure_rows as (
  select * from (values
    (date '2026-08-17', 'Staff development day'),
    (date '2026-09-07', 'Labor Day'),
    (date '2026-09-21', 'Yom Kippur'),
    (date '2026-10-26', 'Staff development day'),
    (date '2026-11-11', 'Veterans Day'),
    (date '2026-11-23', 'Thanksgiving break'),
    (date '2026-11-24', 'Thanksgiving break'),
    (date '2026-11-25', 'Thanksgiving break'),
    (date '2026-11-26', 'Thanksgiving break'),
    (date '2026-11-27', 'Thanksgiving break'),
    (date '2026-12-21', 'Winter break'),
    (date '2026-12-22', 'Winter break'),
    (date '2026-12-23', 'Winter break'),
    (date '2026-12-24', 'Winter break'),
    (date '2026-12-25', 'Winter break'),
    (date '2026-12-28', 'Winter break'),
    (date '2026-12-29', 'Winter break'),
    (date '2026-12-30', 'Winter break'),
    (date '2026-12-31', 'Winter break'),
    (date '2027-01-01', 'Winter break'),
    (date '2027-01-04', 'Staff development day'),
    (date '2027-01-18', 'Martin Luther King Jr. Day'),
    (date '2027-02-15', 'Presidents Week'),
    (date '2027-02-16', 'Presidents Week'),
    (date '2027-02-17', 'Presidents Week'),
    (date '2027-02-18', 'Presidents Week'),
    (date '2027-02-19', 'Presidents Week'),
    (date '2027-03-29', 'Spring break'),
    (date '2027-03-30', 'Spring break'),
    (date '2027-03-31', 'Spring break'),
    (date '2027-04-01', 'Spring break'),
    (date '2027-04-02', 'Spring break'),
    (date '2027-04-19', 'Staff development day'),
    (date '2027-05-31', 'Memorial Day')
  ) as rows(exception_date, title)
), selected_profiles as (
  select p.id
  from private.school_profiles p
  join public.households h on h.id = p.household_id and h.slug = 'eriksen'
  join public.household_members m
    on m.id = p.student_member_id
   and m.slug in ('posey', 'chloe')
  where p.academic_year = '2026-27'
)
insert into private.school_schedule_exceptions (
  school_profile_id,
  exception_date,
  exception_type,
  title,
  attendance_required,
  dismissal_local,
  transportation_impact,
  source_label,
  source_url,
  source_checked_on,
  confidence
)
select
  p.id,
  c.exception_date,
  'no_school',
  c.title,
  false,
  null,
  true,
  'PVSD 2026-27 school calendar',
  'https://lcs.pleasantvalleysd.org/fs/resource-manager/view/df0c9911-4b6a-410f-8ce1-820d3b4b365d',
  date '2026-09-01',
  1.000
from selected_profiles p
cross join closure_rows c
on conflict (school_profile_id, exception_date) do update set
  exception_type = excluded.exception_type,
  title = excluded.title,
  attendance_required = excluded.attendance_required,
  dismissal_local = excluded.dismissal_local,
  transportation_impact = excluded.transportation_impact,
  source_label = excluded.source_label,
  source_url = excluded.source_url,
  schedule_source_label = excluded.schedule_source_label,
  schedule_source_url = excluded.schedule_source_url,
  source_checked_on = excluded.source_checked_on,
  confidence = excluded.confidence,
  updated_at = now();

with exception_rows as (
  select * from (values
    ('posey', date '2026-10-05', 'minimum_day', 'Minimum day', time '12:00'),
    ('posey', date '2026-10-06', 'minimum_day', 'Minimum day', time '12:00'),
    ('posey', date '2026-10-07', 'minimum_day', 'Minimum day', time '12:00'),
    ('posey', date '2026-10-08', 'minimum_day', 'Minimum day', time '12:00'),
    ('posey', date '2026-10-09', 'minimum_day', 'Minimum day', time '12:00'),
    ('posey', date '2027-03-08', 'early_release', 'Early dismissal', time '13:25'),
    ('posey', date '2027-03-09', 'early_release', 'Early dismissal', time '13:25'),
    ('posey', date '2027-06-11', 'minimum_day', 'Minimum day and last day', time '12:00'),
    ('chloe', date '2027-06-10', 'minimum_day', 'Minimum day', time '12:05'),
    ('chloe', date '2027-06-11', 'minimum_day', 'Minimum day and last day', time '12:05')
  ) as rows(member_slug, exception_date, exception_type, title, dismissal_local)
)
insert into private.school_schedule_exceptions (
  school_profile_id,
  exception_date,
  exception_type,
  title,
  attendance_required,
  dismissal_local,
  transportation_impact,
  source_label,
  source_url,
  schedule_source_label,
  schedule_source_url,
  source_checked_on,
  confidence
)
select
  p.id,
  e.exception_date,
  e.exception_type,
  e.title,
  true,
  e.dismissal_local,
  true,
  'PVSD 2026-27 school calendar',
  'https://lcs.pleasantvalleysd.org/fs/resource-manager/view/df0c9911-4b6a-410f-8ce1-820d3b4b365d',
  case
    when e.member_slug = 'posey' then 'La Mariposa FAQ and bell times'
    else 'Las Colinas bell schedule'
  end,
  case
    when e.member_slug = 'posey' then 'https://lms.pleasantvalleysd.org/faq'
    else 'https://www.pleasantvalleysd.org/fs/resource-manager/view/2a855926-b72d-4c4c-b828-4b93aa4bd3b3'
  end,
  date '2026-09-01',
  1.000
from exception_rows e
join public.households h on h.slug = 'eriksen'
join public.household_members m
  on m.household_id = h.id
 and m.slug = e.member_slug
join private.school_profiles p
  on p.household_id = h.id
 and p.student_member_id = m.id
 and p.academic_year = '2026-27'
on conflict (school_profile_id, exception_date) do update set
  exception_type = excluded.exception_type,
  title = excluded.title,
  attendance_required = excluded.attendance_required,
  dismissal_local = excluded.dismissal_local,
  transportation_impact = excluded.transportation_impact,
  source_label = excluded.source_label,
  source_url = excluded.source_url,
  schedule_source_label = excluded.schedule_source_label,
  schedule_source_url = excluded.schedule_source_url,
  source_checked_on = excluded.source_checked_on,
  confidence = excluded.confidence,
  updated_at = now();

with closure_rows as (
  select * from (values
    (date '2026-08-10', 'Professional development day', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-08-11', 'Teacher preparation day', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-09-07', 'Labor Day', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-10-12', 'Professional development day', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-11-11', 'Veterans Day', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-11-23', 'Thanksgiving break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-11-24', 'Thanksgiving break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-11-25', 'Thanksgiving break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-11-26', 'Thanksgiving break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-11-27', 'Thanksgiving break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-12-21', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-12-22', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-12-23', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-12-24', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-12-25', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-12-28', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-12-29', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-12-30', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2026-12-31', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-01-01', 'Winter break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-01-04', 'Teacher preparation day', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-01-18', 'Martin Luther King Jr. Day', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-02-15', 'February break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-02-16', 'February break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-02-17', 'February break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-02-18', 'February break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-02-19', 'February break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-03-01', 'Teacher preparation day', 'Rancho Campana trimester calendar', 'https://www.ranchocampanahigh.us/fs/resource-manager/view/24617d5e-c295-461d-84d9-2a7e0144f354'),
    (date '2027-03-29', 'Spring break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-03-30', 'Spring break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-03-31', 'Spring break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-04-01', 'Spring break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-04-02', 'Spring break', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf'),
    (date '2027-05-31', 'Memorial Day', 'OUHSD 2026-27 district calendar', 'https://resources.finalsite.net/images/v1781216340/oxnardunionorg/yqnnwqi76qaozkitew54/2026-2027Quarter-SemesterCalendar.pdf')
  ) as rows(exception_date, title, source_label, source_url)
)
insert into private.school_schedule_exceptions (
  school_profile_id,
  exception_date,
  exception_type,
  title,
  attendance_required,
  dismissal_local,
  transportation_impact,
  source_label,
  source_url,
  source_checked_on,
  confidence
)
select
  p.id,
  c.exception_date,
  'no_school',
  c.title,
  false,
  null,
  true,
  c.source_label,
  c.source_url,
  date '2026-09-01',
  1.000
from closure_rows c
join public.households h on h.slug = 'eriksen'
join public.household_members m
  on m.household_id = h.id
 and m.slug = 'lyra'
join private.school_profiles p
  on p.household_id = h.id
 and p.student_member_id = m.id
 and p.academic_year = '2026-27'
on conflict (school_profile_id, exception_date) do update set
  exception_type = excluded.exception_type,
  title = excluded.title,
  attendance_required = excluded.attendance_required,
  dismissal_local = excluded.dismissal_local,
  transportation_impact = excluded.transportation_impact,
  source_label = excluded.source_label,
  source_url = excluded.source_url,
  schedule_source_label = excluded.schedule_source_label,
  schedule_source_url = excluded.schedule_source_url,
  source_checked_on = excluded.source_checked_on,
  confidence = excluded.confidence,
  updated_at = now();

with exception_rows as (
  select * from (values
    (date '2026-09-04', 'minimum_day', 'Minimum day', time '12:50'),
    (date '2026-11-04', 'finals', 'Trimester 1 finals - day 1', time '15:33'),
    (date '2026-11-05', 'finals', 'Trimester 1 finals - day 2', time '12:50'),
    (date '2026-11-06', 'finals', 'Trimester 1 finals - day 3', time '12:50'),
    (date '2026-11-20', 'minimum_day', 'Minimum day', time '12:50'),
    (date '2027-02-12', 'minimum_day', 'Minimum day', time '12:50'),
    (date '2027-02-24', 'finals', 'Trimester 2 finals - day 1', time '15:33'),
    (date '2027-02-25', 'finals', 'Trimester 2 finals - day 2', time '12:50'),
    (date '2027-02-26', 'finals', 'Trimester 2 finals - day 3', time '12:50'),
    (date '2027-03-26', 'minimum_day', 'Minimum day', time '12:50'),
    (date '2027-04-16', 'minimum_day', 'Minimum day', time '12:50'),
    (date '2027-05-28', 'finals', 'Trimester 3 finals - minimum day', time '12:50'),
    (date '2027-06-01', 'finals', 'Trimester 3 finals', time '12:50'),
    (date '2027-06-02', 'finals', 'Trimester 3 finals and last day', time '12:50')
  ) as rows(exception_date, exception_type, title, dismissal_local)
)
insert into private.school_schedule_exceptions (
  school_profile_id,
  exception_date,
  exception_type,
  title,
  attendance_required,
  dismissal_local,
  transportation_impact,
  source_label,
  source_url,
  schedule_source_label,
  schedule_source_url,
  source_checked_on,
  confidence
)
select
  p.id,
  e.exception_date,
  e.exception_type,
  e.title,
  true,
  e.dismissal_local,
  true,
  'Rancho Campana trimester calendar',
  'https://www.ranchocampanahigh.us/fs/resource-manager/view/24617d5e-c295-461d-84d9-2a7e0144f354',
  'Rancho Campana bell schedule',
  'https://www.ranchocampanahigh.us/about-us/bell-schedule',
  date '2026-09-01',
  1.000
from exception_rows e
join public.households h on h.slug = 'eriksen'
join public.household_members m
  on m.household_id = h.id
 and m.slug = 'lyra'
join private.school_profiles p
  on p.household_id = h.id
 and p.student_member_id = m.id
 and p.academic_year = '2026-27'
on conflict (school_profile_id, exception_date) do update set
  exception_type = excluded.exception_type,
  title = excluded.title,
  attendance_required = excluded.attendance_required,
  dismissal_local = excluded.dismissal_local,
  transportation_impact = excluded.transportation_impact,
  source_label = excluded.source_label,
  source_url = excluded.source_url,
  schedule_source_label = excluded.schedule_source_label,
  schedule_source_url = excluded.schedule_source_url,
  source_checked_on = excluded.source_checked_on,
  confidence = excluded.confidence,
  updated_at = now();

update private.family_routines r
set
  effective_start = p.first_day,
  effective_end = p.last_day,
  source = 'official_school_profile',
  updated_at = now()
from private.school_profiles p
join public.household_members m on m.id = p.student_member_id
where r.household_id = p.household_id
  and r.person_slug = m.slug
  and r.kind in ('school_dropoff', 'school_pickup')
  and p.academic_year = '2026-27';
