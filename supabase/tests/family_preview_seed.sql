-- Synthetic local preview only. The existing login RPC resolves slug eriksen.
-- Run solely in the disposable pepper-oauth-local-gate database.
begin;
insert into public.households(id,slug,name) values
 ('90000000-0000-4000-8000-000000000001','eriksen','[PEPPER TEST] Local family');
insert into public.household_members(id,household_id,slug,display_name,role,pin_hash,pin_setup_completed_at) values
 ('90000000-0000-4000-8000-000000000011','90000000-0000-4000-8000-000000000001','test-parent','Test Parent','adult_admin',extensions.crypt('246810',extensions.gen_salt('bf')),now()),
 ('90000000-0000-4000-8000-000000000014','90000000-0000-4000-8000-000000000001','test-child','Test Child','child',extensions.crypt('135790',extensions.gen_salt('bf')),now()),
 ('90000000-0000-4000-8000-000000000015','90000000-0000-4000-8000-000000000001','test-teen','Test Teen','teen',extensions.crypt('357913',extensions.gen_salt('bf')),now());
insert into public.events(id,household_id,title,person_slug,starts_at,ends_at,kind,source,visibility,owner_member_id) values
 ('90000000-0000-4000-8000-000000000101','90000000-0000-4000-8000-000000000001','[PEPPER TEST] Afternoon practice','test-child',
 ((now() at time zone 'America/Los_Angeles')::date+time '15:15') at time zone 'America/Los_Angeles',
 ((now() at time zone 'America/Los_Angeles')::date+time '16:30') at time zone 'America/Los_Angeles','activity','pepper','household','90000000-0000-4000-8000-000000000014');
insert into public.tasks(id,household_id,title,owner_member_id,creator_member_id,visibility,status,source,area,classification,due_at,recurrence) values
 ('90000000-0000-4000-8000-000000000201','90000000-0000-4000-8000-000000000001','[PEPPER TEST] Clear the table','90000000-0000-4000-8000-000000000014','90000000-0000-4000-8000-000000000011','household','open','pepper_chore','Home','Chore',now()+interval '4 hours','none'),
 ('90000000-0000-4000-8000-000000000202','90000000-0000-4000-8000-000000000001','[PEPPER TEST] Parent private task','90000000-0000-4000-8000-000000000011','90000000-0000-4000-8000-000000000011','private','open','pepper','Work','Task',now()+interval '3 hours','none');
insert into public.meal_plan(household_id,meal_date,meal_name,owner_member_id,eat_at) values
 ('90000000-0000-4000-8000-000000000001',(now() at time zone 'America/Los_Angeles')::date,'[PEPPER TEST] Pasta and vegetables','90000000-0000-4000-8000-000000000011',((now() at time zone 'America/Los_Angeles')::date+time '18:30') at time zone 'America/Los_Angeles');
insert into public.groceries(id,household_id,item,status) values
 ('90000000-0000-4000-8000-000000000301','90000000-0000-4000-8000-000000000001','[PEPPER TEST] Tomatoes','open');
commit;
