-- T089: two-user RLS isolation across user-owned tables and Storage.

begin;

select plan(32);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  (
    'aaaaaaaa-0000-0000-0000-00000000000a',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'owner-a@example.com',
    '',
    now(),
    now(),
    now(),
    '{}',
    '{}'
  ),
  (
    'bbbbbbbb-0000-0000-0000-00000000000b',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'owner-b@example.com',
    '',
    now(),
    now(),
    now(),
    '{}',
    '{}'
  );

insert into public.recipes (id, user_id, title, servings)
values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Recipe A', 4),
  ('20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Recipe B', 2);

insert into public.recipe_ingredients (id, recipe_id, position, name, quantity_num, quantity_den, unit)
values
  ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 1, 'flour', 1, 2, 'cup'),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 1, 'rice', 1, 1, 'cup');

insert into public.recipe_steps (id, recipe_id, position, text)
values
  ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 1, 'Mix A.'),
  ('20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 1, 'Mix B.');

insert into public.tags (id, user_id, name)
values
  ('10000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-00000000000a', 'tag-a'),
  ('20000000-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-00000000000b', 'tag-b');

insert into public.recipe_tags (recipe_id, tag_id)
values
  ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004'),
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004');

insert into public.recipe_history (id, recipe_id, version, snapshot, change_kind)
values
  ('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 1, '{"title":"Recipe A"}', 'manual_edit'),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 1, '{"title":"Recipe B"}', 'manual_edit');

insert into public.conversations (id, user_id, recipe_id, kind)
values
  ('10000000-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'recipe'),
  ('20000000-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000001', 'recipe');

insert into public.conversation_messages (id, conversation_id, position, role, content)
values
  ('10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000006', 1, 'user', 'message-a'),
  ('20000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000006', 1, 'user', 'message-b');

insert into public.modification_proposals (id, conversation_id, message_id, recipe_id, base_version, operations)
values
  ('10000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 1, '[]'),
  ('20000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', 1, '[]');

insert into public.shopping_list_items (id, user_id, name, position)
values
  ('10000000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-00000000000a', 'item-a', 1),
  ('20000000-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-00000000000b', 'item-b', 1);

insert into public.ai_configurations (user_id, provider, model, vault_secret_name)
values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'openai', 'gpt-a', 'vault-a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'openai', 'gpt-b', 'vault-b');

insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', false)
on conflict (id) do nothing;

insert into storage.objects (
  id,
  bucket_id,
  name,
  owner,
  owner_id,
  metadata,
  version
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    'recipe-images',
    'aaaaaaaa-0000-0000-0000-00000000000a/10000000-0000-0000-0000-000000000001/photo-a.png',
    'aaaaaaaa-0000-0000-0000-00000000000a',
    'aaaaaaaa-0000-0000-0000-00000000000a',
    '{}'::jsonb,
    '1'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    'recipe-images',
    'bbbbbbbb-0000-0000-0000-00000000000b/20000000-0000-0000-0000-000000000001/photo-b.png',
    'bbbbbbbb-0000-0000-0000-00000000000b',
    'bbbbbbbb-0000-0000-0000-00000000000b',
    '{}'::jsonb,
    '1'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is(auth.uid(), 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid, 'A is impersonated');
select results_eq($$ select title from public.recipes order by title $$, $$ values ('Recipe A') $$, 'A sees only own recipes');
select results_eq($$ select snapshot->>'title' from public.recipe_history order by snapshot->>'title' $$, $$ values ('Recipe A') $$, 'A sees only own history');
select results_eq($$ select name from public.tags order by name $$, $$ values ('tag-a') $$, 'A sees only own tags');
select results_eq($$ select id from public.conversations $$, $$ values ('10000000-0000-0000-0000-000000000006'::uuid) $$, 'A sees only own conversations');
select results_eq($$ select id from public.modification_proposals $$, $$ values ('10000000-0000-0000-0000-000000000008'::uuid) $$, 'A sees only own proposals');
select results_eq($$ select name from public.shopping_list_items $$, $$ values ('item-a') $$, 'A sees only own shopping items');
select results_eq($$ select model from public.ai_configurations $$, $$ values ('gpt-a') $$, 'A sees only own AI metadata');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'recipe-images' order by name $$,
  $$ values ('aaaaaaaa-0000-0000-0000-00000000000a/10000000-0000-0000-0000-000000000001/photo-a.png') $$,
  'A sees only own storage objects'
);
select is_empty($$ select * from public.recipes where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b'::uuid $$, 'A cannot filter into B recipes');
select is_empty($$ update public.recipes set title = 'hacked-by-a' where id = '20000000-0000-0000-0000-000000000001' returning id $$, 'A cannot update B recipe');
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, version) values ('30000000-0000-0000-0000-000000000003', 'recipe-images', 'bbbbbbbb-0000-0000-0000-00000000000b/forged.png', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', '{}'::jsonb, '1') $$,
  '42501',
  null,
  'A cannot insert an object into B prefix'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-00000000000b', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is(auth.uid(), 'bbbbbbbb-0000-0000-0000-00000000000b'::uuid, 'B is impersonated');
select results_eq($$ select title from public.recipes order by title $$, $$ values ('Recipe B') $$, 'B sees only own recipes');
select results_eq($$ select snapshot->>'title' from public.recipe_history order by snapshot->>'title' $$, $$ values ('Recipe B') $$, 'B sees only own history');
select results_eq($$ select name from public.tags order by name $$, $$ values ('tag-b') $$, 'B sees only own tags');
select results_eq($$ select id from public.conversations $$, $$ values ('20000000-0000-0000-0000-000000000006'::uuid) $$, 'B sees only own conversations');
select results_eq($$ select id from public.modification_proposals $$, $$ values ('20000000-0000-0000-0000-000000000008'::uuid) $$, 'B sees only own proposals');
select results_eq($$ select name from public.shopping_list_items $$, $$ values ('item-b') $$, 'B sees only own shopping items');
select results_eq($$ select model from public.ai_configurations $$, $$ values ('gpt-b') $$, 'B sees only own AI metadata');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'recipe-images' order by name $$,
  $$ values ('bbbbbbbb-0000-0000-0000-00000000000b/20000000-0000-0000-0000-000000000001/photo-b.png') $$,
  'B sees only own storage objects'
);
select is_empty($$ select * from public.recipes where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid $$, 'B cannot filter into A recipes');
select is_empty($$ update public.recipes set title = 'hacked-by-b' where id = '10000000-0000-0000-0000-000000000001' returning id $$, 'B cannot update A recipe');
select throws_ok(
  $$ insert into public.tags (user_id, name) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'forged-tag') $$,
  '42501',
  null,
  'B cannot insert tags for A'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select results_eq($$ select count(*)::bigint from public.recipe_steps $$, $$ values (1::bigint) $$, 'A sees only own steps');
select results_eq($$ select count(*)::bigint from public.recipe_tags $$, $$ values (1::bigint) $$, 'A sees only own recipe_tags');
select results_eq($$ select count(*)::bigint from public.conversation_messages $$, $$ values (1::bigint) $$, 'A sees only own conversation_messages');
select throws_ok(
  $$ insert into public.recipe_ingredients (recipe_id, position, name) values ('20000000-0000-0000-0000-000000000001', 2, 'forged') $$,
  '42501',
  null,
  'A cannot insert ingredients into B recipe'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-00000000000b', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select results_eq($$ select count(*)::bigint from public.recipe_steps $$, $$ values (1::bigint) $$, 'B sees only own steps');
select results_eq($$ select count(*)::bigint from public.recipe_tags $$, $$ values (1::bigint) $$, 'B sees only own recipe_tags');
select results_eq($$ select count(*)::bigint from public.conversation_messages $$, $$ values (1::bigint) $$, 'B sees only own conversation_messages');
select throws_ok(
  $$ update public.ai_configurations set status = 'invalid' where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'B cannot update A AI metadata'
);

select * from finish();

rollback;
