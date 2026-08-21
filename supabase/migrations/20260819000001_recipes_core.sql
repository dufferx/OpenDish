-- T013: recipes, recipe_ingredients, recipe_steps, tags, recipe_tags
-- Per specs/001-ai-recipe-manager/data-model.md. RLS policies ship with their tables.

-- Shared updated_at maintenance trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  servings int not null check (servings > 0),
  prep_time_minutes int check (prep_time_minutes >= 0),
  cook_time_minutes int check (cook_time_minutes >= 0),
  -- Storage object path only (bucket recipe-images), never binary data.
  image_path text,
  source_name text,
  source_url text,
  is_favorite boolean not null default false,
  -- Variant link; variants detach and become standalone on source deletion (research R7).
  source_recipe_id uuid references public.recipes (id) on delete set null,
  -- Incremented on every save; staleness anchor for modification_proposals.base_version.
  head_version bigint not null default 1,
  origin text not null default 'manual' check (origin in ('manual', 'imported', 'ai_generated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipes_user_id_idx on public.recipes (user_id);
create index recipes_source_recipe_id_idx on public.recipes (source_recipe_id);

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

alter table public.recipes enable row level security;

create policy recipes_owner_all on public.recipes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.recipes to authenticated;
grant all on public.recipes to service_role;

-- Exact-rational quantities (research R3): num/den are both NULL (quantity-less
-- ingredient, scaling skips it) or both set, with den > 0.
create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  position int not null,
  name text not null check (char_length(name) between 1 and 300),
  quantity_num int,
  quantity_den int check (quantity_den > 0),
  unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_id, position),
  check ((quantity_num is null) = (quantity_den is null))
);

create trigger recipe_ingredients_set_updated_at
  before update on public.recipe_ingredients
  for each row execute function public.set_updated_at();

alter table public.recipe_ingredients enable row level security;

create policy recipe_ingredients_owner_all on public.recipe_ingredients
  for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()));

grant select, insert, update, delete on public.recipe_ingredients to authenticated;
grant all on public.recipe_ingredients to service_role;

create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  position int not null,
  text text not null check (char_length(text) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_id, position)
);

create trigger recipe_steps_set_updated_at
  before update on public.recipe_steps
  for each row execute function public.set_updated_at();

alter table public.recipe_steps enable row level security;

create policy recipe_steps_owner_all on public.recipe_steps
  for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()));

grant select, insert, update, delete on public.recipe_steps to authenticated;
grant all on public.recipe_steps to service_role;

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tag names are unique per user, case-insensitively.
create unique index tags_user_id_lower_name_key on public.tags (user_id, lower(name));

create trigger tags_set_updated_at
  before update on public.tags
  for each row execute function public.set_updated_at();

alter table public.tags enable row level security;

create policy tags_owner_all on public.tags
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.tags to authenticated;
grant all on public.tags to service_role;

create table public.recipe_tags (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recipe_id, tag_id)
);

alter table public.recipe_tags enable row level security;

create policy recipe_tags_owner_all on public.recipe_tags
  for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid()));

grant select, insert, update, delete on public.recipe_tags to authenticated;
grant all on public.recipe_tags to service_role;
