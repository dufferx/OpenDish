import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HeartIcon,
  ImportIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { EmptyState, ErrorState, Loading } from '@/app/states';
import { ConfirmDialog } from '@/app/confirm-dialog.tsx';

import {
  applyTagFilter,
  useAllTags,
  useRecipes,
  type RecipeFilters,
  type RecipeListItem,
} from './recipe-queries.ts';
import { useRecipeActions } from './use-recipe-actions.ts';
import { RecipeCard } from './recipe-card.tsx';

export function RecipeListPage() {
  const [filters, setFilters] = useState<RecipeFilters>({
    search: '',
    tag: null,
    favoritesOnly: false,
  });
  const deferredFilters = useDeferredValue(filters);
  const [deleteTarget, setDeleteTarget] = useState<RecipeListItem | null>(null);

  const {
    data: recipes,
    isLoading,
    error,
    refetch,
  } = useRecipes(deferredFilters);
  const { data: allTags } = useAllTags();
  const { deleteRecipe, duplicateRecipe, toggleFavorite, isDeleting } =
    useRecipeActions();

  const visibleRecipes = useMemo(
    () => applyTagFilter(recipes ?? [], deferredFilters.tag),
    [recipes, deferredFilters.tag],
  );

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    await deleteRecipe(deleteTarget.id);
    setDeleteTarget(null);
  }

  if (isLoading) return <Loading label="Loading recipes…" />;
  if (error)
    return (
      <ErrorState
        title="Could not load recipes"
        description={error.message}
        onRetry={() => void refetch()}
      />
    );

  return (
    <section className="flex flex-col gap-6" aria-labelledby="recipes-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1
          id="recipes-title"
          className="text-2xl font-semibold tracking-tight"
        >
          Recipes
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link to="/recipes/new">
              <PlusIcon className="size-4" />
              New
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/import">
              <ImportIcon className="size-4" />
              Import
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/generate">
              <SparklesIcon className="size-4" />
              AI Create
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search recipes"
            className="pl-9"
            value={filters.search}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, search: e.target.value }))
            }
            aria-label="Search recipes"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={filters.favoritesOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                favoritesOnly: !prev.favoritesOnly,
              }))
            }
            aria-pressed={filters.favoritesOnly}
          >
            <HeartIcon
              className={
                filters.favoritesOnly
                  ? 'mr-1.5 size-4 fill-current'
                  : 'mr-1.5 size-4'
              }
            />
            Favorites
          </Button>
          {(allTags ?? []).map((tag) => (
            <Button
              key={tag}
              type="button"
              variant={filters.tag === tag ? 'default' : 'outline'}
              size="sm"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  tag: prev.tag === tag ? null : tag,
                }))
              }
              aria-pressed={filters.tag === tag}
            >
              {tag}
            </Button>
          ))}
          {filters.tag || filters.favoritesOnly || filters.search ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setFilters({ search: '', tag: null, favoritesOnly: false })
              }
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {visibleRecipes.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="No recipes yet"
          description="Start your collection by creating a recipe or importing one."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild>
                <Link to="/recipes/new">
                  <PlusIcon className="size-4" />
                  Create recipe
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/import">
                  <ImportIcon className="size-4" />
                  Import
                </Link>
              </Button>
            </div>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleRecipes.map((recipe) => (
            <li key={recipe.id}>
              <RecipeCard
                recipe={recipe}
                onToggleFavorite={(id, isFavorite) =>
                  void toggleFavorite({ recipeId: id, isFavorite })
                }
                onDuplicate={(id) => void duplicateRecipe(id)}
                onDelete={(r) => setDeleteTarget(r)}
              />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete recipe?"
        description={`"${deleteTarget?.title ?? ''}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        pending={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
      />
    </section>
  );
}
