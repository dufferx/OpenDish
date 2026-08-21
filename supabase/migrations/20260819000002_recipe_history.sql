-- T014: recipe_history — immutable JSONB snapshots (research R6).
-- Written exclusively by the application-level save path; append-only per recipe.

create table public.recipe_history (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  -- The recipes.head_version this snapshot was current at.
  version bigint not null,
  -- Complete recipe snapshot (Zod RecipeSnapshot shape from packages/contracts).
  snapshot jsonb not null,
  change_kind text not null check (
    change_kind in ('manual_edit', 'ai_applied', 'serving_adjustment', 'restore', 'variant_created')
  ),
  created_at timestamptz not null default now(),
  unique (recipe_id, version)
);

create index recipe_history_recipe_id_idx on public.recipe_history (recipe_id);

alter table public.recipe_history enable row level security;
alter table public.recipe_history force row level security;

create policy recipe_history_owner_all on public.recipe_history
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
  );

revoke all on public.recipe_history from anon, authenticated;
grant select, insert, update, delete on public.recipe_history to authenticated;
grant all on public.recipe_history to service_role;
