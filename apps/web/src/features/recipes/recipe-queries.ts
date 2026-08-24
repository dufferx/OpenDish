import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { makeQuantity, type Quantity } from '@opendish/contracts';

import { createSupabaseRecipeStore } from '@/domain/recipe-save.ts';
import { supabase } from '@/lib/supabase';

export interface RecipeListItem {
  id: string;
  title: string;
  description: string | null;
  isFavorite: boolean;
  tags: string[];
  imagePath: string | null;
}

export interface RecipeDetail {
  id: string;
  title: string;
  description: string | null;
  servings: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceRecipeId: string | null;
  sourceRecipe: {
    id: string;
    title: string;
  } | null;
  variantRecipes: {
    id: string;
    title: string;
  }[];
  isFavorite: boolean;
  imagePath: string | null;
  ingredients: {
    name: string;
    quantity: Quantity | null;
    unit: string | null;
  }[];
  steps: { text: string }[];
  tags: string[];
  origin: string;
  headVersion: number;
}

interface RawRecipeRow {
  id: string;
  title: string;
  description: string | null;
  image_path: string | null;
  is_favorite: boolean;
}

interface RecipeTagLink {
  recipe_id: string;
  tag_id: string;
}

export interface RecipeFilters {
  search: string;
  tag: string | null;
  favoritesOnly: boolean;
}

function buildSearchFilter(search: string): string | null {
  const term = search.trim();
  if (term === '') return null;
  return `%${term}%`;
}

/**
 * Fetch the current user's recipes and their tags. Search and favorites are
 * pushed to PostgREST; the active tag filter is applied client-side so the
 * tag chip list stays stable while filtering.
 */
export function useRecipes(filters: RecipeFilters) {
  return useQuery({
    queryKey: ['recipes', filters],
    queryFn: async (): Promise<RecipeListItem[]> => {
      let query = supabase
        .from('recipes')
        .select('id, title, description, image_path, is_favorite');

      const searchFilter = buildSearchFilter(filters.search);
      if (searchFilter) {
        query = query.or(
          `title.ilike.${searchFilter},description.ilike.${searchFilter}`,
        );
      }
      if (filters.favoritesOnly) {
        query = query.eq('is_favorite', true);
      }

      const { data: recipesData, error: recipesError } =
        await query.order('title');
      if (recipesError) throw new Error(recipesError.message);
      const recipes = (recipesData ?? []) as RawRecipeRow[];

      const recipeIds = recipes.map((r) => r.id);
      let tagsByRecipeId: Map<string, string[]> = new Map();
      if (recipeIds.length > 0) {
        const [
          { data: linksData, error: linksError },
          { data: tagsData, error: tagsError },
        ] = await Promise.all([
          supabase
            .from('recipe_tags')
            .select('recipe_id, tag_id')
            .in('recipe_id', recipeIds),
          supabase.from('tags').select('id, name'),
        ]);
        if (linksError) throw new Error(linksError.message);
        if (tagsError) throw new Error(tagsError.message);

        const nameByTagId = new Map(
          ((tagsData ?? []) as { id: string; name: string }[]).map((t) => [
            t.id,
            t.name,
          ]),
        );
        tagsByRecipeId = ((linksData ?? []) as RecipeTagLink[]).reduce(
          (map, link) => {
            const name = nameByTagId.get(link.tag_id);
            if (name) {
              const list = map.get(link.recipe_id) ?? [];
              list.push(name);
              map.set(link.recipe_id, list);
            }
            return map;
          },
          new Map<string, string[]>(),
        );
      }

      return recipes.map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
        description: recipe.description,
        isFavorite: recipe.is_favorite,
        imagePath: recipe.image_path,
        tags: tagsByRecipeId.get(recipe.id) ?? [],
      }));
    },
    // T106: keep the previously rendered recipes on screen (instead of an
    // "isLoading" refetch that unmounts the list) while a new search/filter
    // query key is in flight, so the search input never loses focus.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useRecipeDetail(recipeId: string | undefined) {
  return useQuery({
    queryKey: ['recipe', recipeId],
    queryFn: async (): Promise<RecipeDetail | null> => {
      if (!recipeId) return null;
      const store = createSupabaseRecipeStore(supabase);
      const state = await store.getRecipeState(recipeId);
      if (!state) return null;
      const sourceRecipeId = state.recipe.sourceRecipeId;
      const [sourceRecipeResult, variantsResult] = await Promise.all([
        sourceRecipeId
          ? supabase
              .from('recipes')
              .select('id, title')
              .eq('id', sourceRecipeId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('recipes')
          .select('id, title')
          .eq('source_recipe_id', recipeId)
          .order('title'),
      ]);

      if (sourceRecipeResult.error) {
        throw new Error(
          `Could not load source recipe details: ${sourceRecipeResult.error.message}`,
        );
      }
      if (variantsResult.error) {
        throw new Error(
          `Could not load recipe variants: ${variantsResult.error.message}`,
        );
      }

      const sourceRecipe = (sourceRecipeResult.data ?? null) as {
        id: string;
        title: string;
      } | null;
      const variantRecipes = (variantsResult.data ?? []) as {
        id: string;
        title: string;
      }[];

      return {
        id: state.recipe.id,
        title: state.recipe.title,
        description: state.recipe.description,
        servings: state.recipe.servings,
        prepTimeMinutes: state.recipe.prepTimeMinutes,
        cookTimeMinutes: state.recipe.cookTimeMinutes,
        sourceName: state.recipe.sourceName,
        sourceUrl: state.recipe.sourceUrl,
        sourceRecipeId,
        sourceRecipe,
        variantRecipes,
        isFavorite: state.recipe.isFavorite,
        imagePath: state.recipe.imagePath,
        ingredients: state.ingredients.map((ingredient) => ({
          name: ingredient.name,
          quantity:
            ingredient.quantityNum === null
              ? null
              : makeQuantity(
                  ingredient.quantityNum,
                  ingredient.quantityDen ?? 1,
                ),
          unit: ingredient.unit,
        })),
        steps: state.steps.map((step) => ({ text: step.text })),
        tags: state.tags,
        origin: state.recipe.origin,
        headVersion: state.recipe.headVersion,
      };
    },
    enabled: !!recipeId,
    staleTime: 30_000,
  });
}

export function useAllTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('tags')
        .select('name')
        .order('name');
      if (error) throw new Error(error.message);
      return ((data ?? []) as { name: string }[]).map((t) => t.name);
    },
    staleTime: 60_000,
  });
}

/** Pure filter helper for stable tag filtering and easy unit testing (T032). */
export function applyTagFilter(
  recipes: RecipeListItem[],
  tag: string | null,
): RecipeListItem[] {
  if (!tag) return recipes;
  return recipes.filter((recipe) => recipe.tags.includes(tag));
}
