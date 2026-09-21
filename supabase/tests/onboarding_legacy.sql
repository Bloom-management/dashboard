-- Disposable test-runner fixtures only, loaded immediately BEFORE migration027.
insert into public.users(clerk_user_id,role,approved_city_id,initial_city_selected_at) values
 ('onboarding_legacy_owner','owner',null,null),
 ('onboarding_legacy_admin','admin',null,null),
 ('onboarding_legacy_cleaner','cleaner','00000000-0000-4000-8000-000000000001',now()),
 ('onboarding_legacy_partial','cleaner',null,null);
