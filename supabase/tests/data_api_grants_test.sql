-- T086: explicit Data API grants for authenticated access and anonymous denial.

begin;

select plan(17);

select ok(has_schema_privilege('authenticated', 'public', 'usage'), 'authenticated has usage on public schema');

select ok(not has_table_privilege('anon', 'public.recipes', 'select'), 'anon cannot select recipes by privilege');
select ok(has_table_privilege('authenticated', 'public.recipes', 'select'), 'authenticated can select recipes by privilege');
select ok(has_table_privilege('authenticated', 'public.recipes', 'insert'), 'authenticated can insert recipes by privilege');
select ok(has_table_privilege('authenticated', 'public.recipes', 'update'), 'authenticated can update recipes by privilege');
select ok(has_table_privilege('authenticated', 'public.recipes', 'delete'), 'authenticated can delete recipes by privilege');

select ok(not has_table_privilege('anon', 'public.ai_configurations', 'select'), 'anon cannot select ai_configurations by privilege');
select ok(has_table_privilege('authenticated', 'public.ai_configurations', 'select'), 'authenticated can select ai_configurations by privilege');
select ok(not has_table_privilege('authenticated', 'public.ai_configurations', 'insert'), 'authenticated cannot insert ai_configurations by privilege');
select ok(not has_table_privilege('authenticated', 'public.ai_configurations', 'update'), 'authenticated cannot update ai_configurations by privilege');
select ok(not has_table_privilege('authenticated', 'public.ai_configurations', 'delete'), 'authenticated cannot delete ai_configurations by privilege');

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
values (
  'cccccccc-0000-0000-0000-00000000000c',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'grants@example.com',
  '',
  now(),
  now(),
  now(),
  '{}',
  '{}'
);

set local role anon;
select throws_ok($$ select * from public.recipes $$, '42501', null, 'anon select on recipes is denied before RLS');
select throws_ok($$ select * from public.ai_configurations $$, '42501', null, 'anon select on ai_configurations is denied before RLS');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-00000000000c', true);
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.recipes (user_id, title, servings) values ('cccccccc-0000-0000-0000-00000000000c', 'Grant-owned recipe', 3) $$,
  'authenticated can insert own recipe through granted privileges'
);
select results_eq(
  $$ select title from public.recipes $$,
  $$ values ('Grant-owned recipe') $$,
  'authenticated can read own recipe through granted privileges'
);
select is_empty(
  $$ select * from public.ai_configurations $$,
  'authenticated select on ai_configurations succeeds and still respects RLS'
);
select throws_ok(
  $$ insert into public.ai_configurations (user_id, provider, model, vault_secret_name) values ('cccccccc-0000-0000-0000-00000000000c', 'openai', 'gpt-test', 'vault-test') $$,
  '42501',
  null,
  'authenticated writes to ai_configurations remain denied without explicit grant'
);

select * from finish();

rollback;
