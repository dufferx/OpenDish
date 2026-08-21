-- Single-user enforcement (research R5): Google sign-in is restricted to one
-- owner email. Mechanism: Supabase Auth `before_user_created` hook
-- (pg-functions://postgres/public/assert_allowed_email, enabled in config.toml).
-- GoTrue invokes this function before creating a user; returning an `error`
-- object rejects the sign-up/sign-in with HTTP 403 before any session exists.

-- Owner email lives in a table (not env) so it can be changed without redeploying.
-- Set it after first reset:
--   update public.app_settings set value = 'you@gmail.com' where key = 'allowed_email';
-- The table has no grants to anon/authenticated, so it is unreachable via PostgREST.
create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
-- No policies and no client grants: deny-by-default for API roles.

-- Placeholder — MUST be replaced with the owner's Google email before first sign-in.
insert into public.app_settings (key, value) values ('allowed_email', 'owner@example.com');

create or replace function public.assert_allowed_email(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  allowed text;
  email text;
begin
  select s.value into allowed from public.app_settings s where s.key = 'allowed_email';
  email := lower(event -> 'user' ->> 'email');

  if allowed is null or email is null or lower(allowed) <> email then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Sign-in is restricted to the application owner.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

-- Only the Auth service may invoke the hook.
revoke all on function public.assert_allowed_email(jsonb) from public, anon, authenticated;
revoke all on function public.assert_allowed_email(jsonb) from service_role;
grant execute on function public.assert_allowed_email(jsonb) to supabase_auth_admin;
