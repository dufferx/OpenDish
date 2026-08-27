-- Phase A: deterministic nutrition foundations.
-- Generic records are shared read-only reference data; products are private.

create table public.nutrition_foods (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 300),
  normalized_name text not null,
  brand text,
  basis text not null check (basis in ('100g', '100ml')),
  preparation text not null default 'not_applicable'
    check (preparation in ('raw', 'cooked', 'not_applicable')),
  calories numeric(10,2) not null check (calories >= 0),
  protein_grams numeric(10,3) not null check (protein_grams >= 0),
  carbohydrates_grams numeric(10,3) not null check (carbohydrates_grams >= 0),
  source text not null,
  source_reference text,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'estimated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name, basis, preparation, source)
);

create index nutrition_foods_name_idx on public.nutrition_foods (normalized_name);

create trigger nutrition_foods_set_updated_at
  before update on public.nutrition_foods
  for each row execute function public.set_updated_at();

alter table public.nutrition_foods enable row level security;
alter table public.nutrition_foods force row level security;

create policy nutrition_foods_read_authenticated on public.nutrition_foods
  for select to authenticated using (true);

revoke all on public.nutrition_foods from anon, authenticated;
grant select on public.nutrition_foods to authenticated;
grant all on public.nutrition_foods to service_role;

create table public.user_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 300),
  brand text,
  serving_size_text text not null check (char_length(serving_size_text) between 1 and 200),
  serving_mass_g numeric(10,3) check (serving_mass_g > 0),
  serving_volume_ml numeric(10,3) check (serving_volume_ml > 0),
  calories numeric(10,2) not null check (calories >= 0),
  protein_grams numeric(10,3) not null check (protein_grams >= 0),
  carbohydrates_grams numeric(10,3) not null check (carbohydrates_grams >= 0),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'estimated')),
  label_image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (serving_mass_g is not null or serving_volume_ml is not null)
);

create index user_products_user_id_idx on public.user_products (user_id);

create trigger user_products_set_updated_at
  before update on public.user_products
  for each row execute function public.set_updated_at();

alter table public.user_products enable row level security;
alter table public.user_products force row level security;

create policy user_products_owner_all on public.user_products
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_products from anon, authenticated;
grant select, insert, update, delete on public.user_products to authenticated;
grant all on public.user_products to service_role;

alter table public.recipe_ingredients
  add column nutrition_food_id uuid references public.nutrition_foods (id) on delete set null,
  add column user_product_id uuid references public.user_products (id) on delete set null,
  add constraint recipe_ingredients_one_nutrition_source check (
    not (nutrition_food_id is not null and user_product_id is not null)
  );

drop policy recipe_ingredients_owner_all on public.recipe_ingredients;
create policy recipe_ingredients_owner_all on public.recipe_ingredients
  for all to authenticated
  using (
    exists (
      select 1
      from public.recipes r
      where r.id = recipe_id
        and r.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.recipes r
      where r.id = recipe_id
        and r.user_id = (select auth.uid())
    )
    and (
      user_product_id is null
      or exists (
        select 1
        from public.user_products p
        where p.id = user_product_id
          and p.user_id = (select auth.uid())
      )
    )
  );

alter table public.recipes
  add column nutrition_calories numeric(10,2) check (nutrition_calories >= 0),
  add column nutrition_protein_grams numeric(10,3) check (nutrition_protein_grams >= 0),
  add column nutrition_carbohydrates_grams numeric(10,3) check (nutrition_carbohydrates_grams >= 0),
  add column nutrition_status text check (nutrition_status in ('confirmed', 'estimated', 'missing')),
  add column nutrition_calculated_at timestamptz;
