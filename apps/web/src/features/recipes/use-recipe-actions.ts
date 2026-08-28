import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { saveRecipe } from '@/domain/recipe-save.ts';
import { createSupabaseRecipeStore } from '@/domain/recipe-save.ts';
import { scaledRecipe } from '@/domain/scaling.ts';
import { supabase } from '@/lib/supabase';

import type { RecipeDetail } from './recipe-queries.ts';

export function useRecipeActions() {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      const { error } = await supabase
        .from('recipes')
        .delete()
        .eq('id', recipeId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not delete the recipe.');
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      const store = createSupabaseRecipeStore(supabase);
      const state = await store.getRecipeState(recipeId);
      if (!state) throw new Error('Recipe not found');
      const { recipe, ingredients, steps, tags } = state;
      return saveRecipe(supabase, {
        recipeId: null,
        changeKind: 'manual_edit',
        userId: recipe.userId,
        title: `${recipe.title} (copy)`,
        description: recipe.description,
        servings: recipe.servings,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        sourceName: recipe.sourceName,
        sourceUrl: recipe.sourceUrl,
        imagePath: null, // Do not copy the image object; the duplicate starts without one.
        ingredients: ingredients.map((ingredient) => ({
          name: ingredient.name,
          quantity:
            ingredient.quantityNum === null
              ? null
              : {
                  num: ingredient.quantityNum,
                  den: ingredient.quantityDen ?? 1,
                },
          unit: ingredient.unit,
          nutritionSource:
            ingredient.nutritionFoodId != null
              ? {
                  sourceType: 'generic_food',
                  sourceId: ingredient.nutritionFoodId,
                }
              : ingredient.userProductId != null
                ? {
                    sourceType: 'user_product',
                    sourceId: ingredient.userProductId,
                  }
                : null,
        })),
        steps: steps.map((step) => ({
          text: step.text,
          durationSeconds: step.durationSeconds ?? null,
        })),
        tags,
        nutrition: recipe.nutrition,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      toast.success('Recipe duplicated.');
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not duplicate the recipe.');
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: async ({
      recipeId,
      isFavorite,
    }: {
      recipeId: string;
      isFavorite: boolean;
    }) => {
      const { error } = await supabase
        .from('recipes')
        .update({ is_favorite: isFavorite })
        .eq('id', recipeId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      void queryClient.invalidateQueries({
        queryKey: ['recipe', variables.recipeId],
      });
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not update favorite status.');
    },
  });

  const servingAdjustmentMutation = useMutation({
    mutationFn: async ({
      recipe,
      targetServings,
    }: {
      recipe: RecipeDetail;
      targetServings: number;
    }) => {
      const scaled = scaledRecipe(recipe, targetServings);
      return saveRecipe(supabase, {
        ...scaled,
        recipeId: recipe.id,
        changeKind: 'serving_adjustment',
        userId: null,
        imagePath: recipe.imagePath,
      });
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['recipe', variables.recipe.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['recipe-state', variables.recipe.id],
      });
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      toast.success('Serving adjustment saved.');
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not save the serving adjustment.');
    },
  });

  return {
    deleteRecipe: deleteMutation.mutateAsync,
    duplicateRecipe: duplicateMutation.mutateAsync,
    toggleFavorite: favoriteMutation.mutateAsync,
    saveServingAdjustment: servingAdjustmentMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    isDuplicating: duplicateMutation.isPending,
    isSavingServingAdjustment: servingAdjustmentMutation.isPending,
  };
}
