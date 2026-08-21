-- T033: RLS policy tests (pgTAP, run with `supabase test db`).
-- A second authenticated user must be able to read/write nothing owned by the
-- owner across: recipes, recipe_ingredients, shopping_list_items,
-- ai_configurations, conversations, modification_proposals (plus select checks
-- on the remaining child tables), while the owner retains full access.

begin;

select plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures: two auth users and a full object graph owned by user A.
-- (Runs as the test superuser, which bypasses RLS.)
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.com', '', now(), now(), now(), '{}', '{}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'intruder@example.com', '', now(), now(), now(), '{}', '{}');

insert into public.recipes (id, user_id, title, servings)
values ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Owner recipe', 4);

insert into public.recipe_ingredients (id, recipe_id, position, name, quantity_num, quantity_den, unit)
values ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 1, 'flour', 1, 2, 'cup');

insert into public.recipe_steps (id, recipe_id, position, text)
values ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 1, 'Mix.');

insert into public.tags (id, user_id, name)
values ('10000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-00000000000a', 'dinner');

insert into public.recipe_tags (recipe_id, tag_id)
values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004');

insert into public.recipe_history (id, recipe_id, version, snapshot, change_kind)
values ('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 1, '{"title":"Owner recipe"}', 'manual_edit');

insert into public.conversations (id, user_id, recipe_id, kind)
values ('10000000-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'recipe');

insert into public.conversation_messages (id, conversation_id, position, role, content)
values ('10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000006', 1, 'user', 'make it vegan');

insert into public.modification_proposals (id, conversation_id, message_id, recipe_id, base_version, operations)
values ('10000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 1, '[]');

insert into public.shopping_list_items (id, user_id, name, position)
values ('10000000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-00000000000a', 'flour', 1);

insert into public.ai_configurations (user_id, provider, model, vault_secret_name)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'openai', 'gpt-5', 'openai_api_key');

-- ---------------------------------------------------------------------------
-- Impersonate user B (the intruder).
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-00000000000b', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is(auth.uid(), 'bbbbbbbb-0000-0000-0000-00000000000b'::uuid, 'impersonating intruder user B');

-- recipes
select is_empty($$ select * from public.recipes $$, 'B cannot select recipes');
select throws_ok($$ insert into public.recipes (user_id, title, servings) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'forged', 1) $$, '42501', null, 'B cannot insert recipes as A');
select is_empty($$ update public.recipes set title = 'hacked' returning id $$, 'B cannot update recipes');
select is_empty($$ delete from public.recipes returning id $$, 'B cannot delete recipes');

-- recipe_ingredients
select is_empty($$ select * from public.recipe_ingredients $$, 'B cannot select recipe_ingredients');
select throws_ok($$ insert into public.recipe_ingredients (recipe_id, position, name) values ('10000000-0000-0000-0000-000000000001', 2, 'forged') $$, '42501', null, 'B cannot insert into A''s recipe_ingredients');
select is_empty($$ update public.recipe_ingredients set name = 'hacked' returning id $$, 'B cannot update recipe_ingredients');
select is_empty($$ delete from public.recipe_ingredients returning id $$, 'B cannot delete recipe_ingredients');

-- shopping_list_items
select is_empty($$ select * from public.shopping_list_items $$, 'B cannot select shopping_list_items');
select throws_ok($$ insert into public.shopping_list_items (user_id, name, position) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'forged', 1) $$, '42501', null, 'B cannot insert shopping_list_items as A');
select is_empty($$ update public.shopping_list_items set name = 'hacked' returning id $$, 'B cannot update shopping_list_items');
select is_empty($$ delete from public.shopping_list_items returning id $$, 'B cannot delete shopping_list_items');

-- ai_configurations (select-own policy; no client write grants at all, so
-- writes fail with a privilege error rather than merely returning zero rows)
select is_empty($$ select * from public.ai_configurations $$, 'B cannot select ai_configurations');
select throws_ok($$ insert into public.ai_configurations (user_id, provider, model, vault_secret_name) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'openai', 'gpt-5', 'forged') $$, '42501', null, 'B cannot insert ai_configurations (no client write grant/policy)');
select throws_ok($$ update public.ai_configurations set status = 'valid' $$, '42501', null, 'B cannot update ai_configurations (no client write grant/policy)');
select throws_ok($$ delete from public.ai_configurations $$, '42501', null, 'B cannot delete ai_configurations (no client write grant/policy)');

-- conversations
select is_empty($$ select * from public.conversations $$, 'B cannot select conversations');
select throws_ok($$ insert into public.conversations (user_id, recipe_id, kind) values ('aaaaaaaa-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'recipe') $$, '42501', null, 'B cannot insert conversations as A');
select is_empty($$ update public.conversations set kind = 'generation' returning id $$, 'B cannot update conversations');
select is_empty($$ delete from public.conversations returning id $$, 'B cannot delete conversations');

-- modification_proposals
select is_empty($$ select * from public.modification_proposals $$, 'B cannot select modification_proposals');
select throws_ok($$ insert into public.modification_proposals (conversation_id, message_id, recipe_id, base_version, operations) values ('10000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 1, '[]') $$, '42501', null, 'B cannot insert modification_proposals on A''s recipe');
select is_empty($$ update public.modification_proposals set status = 'discarded' returning id $$, 'B cannot update modification_proposals');
select is_empty($$ delete from public.modification_proposals returning id $$, 'B cannot delete modification_proposals');

-- remaining child/user tables: select visibility
select is_empty($$ select * from public.recipe_steps $$, 'B cannot select recipe_steps');
select is_empty($$ select * from public.recipe_history $$, 'B cannot select recipe_history');
select is_empty($$ select * from public.conversation_messages $$, 'B cannot select conversation_messages');
select is_empty($$ select * from public.recipe_tags $$, 'B cannot select recipe_tags');
select is_empty($$ select * from public.tags $$, 'B cannot select tags');

-- ---------------------------------------------------------------------------
-- Impersonate owner A: full access to own data (positive control).
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select results_eq(
  $$ select title from public.recipes $$,
  $$ values ('Owner recipe') $$,
  'owner A selects own recipes'
);

select results_eq(
  $$ select provider, model from public.ai_configurations $$,
  $$ values ('openai', 'gpt-5') $$,
  'owner A selects own ai_configurations'
);

select * from finish();

rollback;
