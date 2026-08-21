-- T016: shopping_list_items and ai_configurations.

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- Same exact-rational rule as recipe_ingredients: both NULL or both set, den > 0.
  quantity_num int,
  quantity_den int check (quantity_den > 0),
  unit text,
  is_purchased boolean not null default false,
  -- Provenance only; items survive recipe deletion (research R9 / data-model).
  source_recipe_id uuid references public.recipes (id) on delete set null,
  -- Serving count chosen when the recipe was added to the list.
  servings_used int,
  position int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((quantity_num is null) = (quantity_den is null))
);

create trigger shopping_list_items_set_updated_at
  before update on public.shopping_list_items
  for each row execute function public.set_updated_at();

alter table public.shopping_list_items enable row level security;

create policy shopping_list_items_owner_all on public.shopping_list_items
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.shopping_list_items to authenticated;
grant all on public.shopping_list_items to service_role;

-- BYOK metadata only (research R4). The API key itself lives in vault.secrets,
-- written/read exclusively by Edge Functions under the service role. Clients get
-- SELECT of their own row (status display) but NO direct write grants: all
-- create/update/delete goes through the ai-configure Edge Function, which uses
-- the service role and therefore bypasses RLS.
create table public.ai_configurations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null check (provider in ('openai')),
  -- Override for OpenAI-compatible endpoints.
  base_url text,
  model text not null,
  -- Opaque Vault reference, NOT the key.
  vault_secret_name text not null,
  status text not null default 'unverified' check (status in ('unverified', 'valid', 'invalid')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_configurations_set_updated_at
  before update on public.ai_configurations
  for each row execute function public.set_updated_at();

alter table public.ai_configurations enable row level security;

-- Select-own only; intentionally no insert/update/delete policies for clients.
create policy ai_configurations_owner_select on public.ai_configurations
  for select to authenticated
  using (auth.uid() = user_id);

grant select on public.ai_configurations to authenticated;
grant all on public.ai_configurations to service_role;
