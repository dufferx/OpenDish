import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { calculateNutrition, type NutritionRecord } from '@opendish/contracts';
import { useNavigate, useParams } from 'react-router-dom';

import { Loading, ErrorState } from '@/app/states';
import {
  createSupabaseRecipeStore,
  type StoredRecipeState,
} from '@/domain/recipe-save.ts';
import { formatQuantity } from '@/domain/rational.ts';
import { supabase } from '@/lib/supabase';

import {
  RecipeEditorForm,
  type RecipeEditorFormProps,
} from './recipe-editor-form.tsx';
import { useRecipeMutation } from './use-recipe-mutation.ts';
import type { RecipeFormValues } from './form-schema.ts';
import { useNutritionSources } from '@/features/products/nutrition-source-queries.ts';
import {
  estimateItemsToRecord,
  estimateMissingNutrition,
} from '@/features/recipes/nutrition-estimate-api.ts';

function storedStateToFormValues(state: StoredRecipeState): RecipeFormValues {
  return {
    title: state.recipe.title,
    description: state.recipe.description,
    servings: state.recipe.servings,
    prepTimeMinutes: state.recipe.prepTimeMinutes,
    cookTimeMinutes: state.recipe.cookTimeMinutes,
    sourceName: state.recipe.sourceName,
    sourceUrl: state.recipe.sourceUrl,
    ingredients: state.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantityText:
        ingredient.quantityNum === null
          ? ''
          : formatQuantity({
              num: ingredient.quantityNum,
              den: ingredient.quantityDen ?? 1,
            }),
      unit: ingredient.unit ?? '',
      nutritionSource:
        ingredient.nutritionFoodId != null
          ? { sourceType: 'generic_food', sourceId: ingredient.nutritionFoodId }
          : ingredient.userProductId != null
            ? { sourceType: 'user_product', sourceId: ingredient.userProductId }
            : null,
    })),
    steps: state.steps.map((step) => ({
      text: step.text,
      durationSeconds: step.durationSeconds ?? null,
    })),
    tags: state.tags,
  };
}

function useRecipeQuery(recipeId: string | undefined) {
  return useQuery({
    // Keep the editor's StoredRecipeState cache separate from the detail
    // page's RecipeDetail cache; both routes use the same recipe id but have
    // different object shapes.
    queryKey: ['recipe-state', recipeId],
    queryFn: async () => {
      if (!recipeId) return null;
      const store = createSupabaseRecipeStore(supabase);
      return store.getRecipeState(recipeId);
    },
    enabled: !!recipeId,
    staleTime: 30_000,
  });
}

interface RecipeEditorPageProps {
  mode: 'create' | 'edit';
}

export function RecipeEditorPage({ mode }: RecipeEditorPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const recipeId = mode === 'edit' ? id : undefined;
  const { data: state, isLoading, error, refetch } = useRecipeQuery(recipeId);
  const mutation = useRecipeMutation();
  const { data: nutritionSources = [], isLoading: isLoadingNutritionSources } =
    useNutritionSources();

  const initialValues = useMemo<Partial<RecipeFormValues> | undefined>(() => {
    if (mode === 'create') return undefined;
    if (!state) return undefined;
    return storedStateToFormValues(state);
  }, [mode, state]);

  if (mode === 'edit') {
    if (isLoading) return <Loading label="Loading recipe…" />;
    if (error)
      return (
        <ErrorState
          title="Could not load recipe"
          description={error.message}
          onRetry={() => void refetch()}
        />
      );
    if (!state) {
      return (
        <ErrorState
          title="Recipe not found"
          description="The recipe you are trying to edit does not exist."
        />
      );
    }
  }

  const handleSubmit: RecipeEditorFormProps['onSubmit'] = async (
    draft,
    imageFile,
    calculatedNutrition,
  ) => {
    const sourceByKey = new Map(
      nutritionSources.map((source) => [
        `${source.sourceType}:${source.id}`,
        source,
      ]),
    );
    const calculation = calculateNutrition(
      draft.ingredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        source: ingredient.nutritionSource
          ? (sourceByKey.get(
              `${ingredient.nutritionSource.sourceType}:${ingredient.nutritionSource.sourceId}`,
            ) ?? null)
          : null,
      })),
      draft.servings,
    );
    let nutrition: NutritionRecord = calculatedNutrition ?? {
      ...calculation.values,
      sourceType: calculation.status === 'estimated' ? 'ai_estimate' : 'manual',
      sourceId: null,
      basis: 'serving',
      preparation: 'not_applicable',
      status: calculation.status,
    };
    if (!calculatedNutrition && calculation.unresolvedIngredients.length > 0) {
      try {
        const items = await estimateMissingNutrition(
          draft.ingredients
            .filter((ingredient) =>
              calculation.unresolvedIngredients.includes(ingredient.name),
            )
            .map((ingredient) => ({
              name: ingredient.name,
              quantity: ingredient.quantity
                ? ingredient.quantity.num / ingredient.quantity.den
                : null,
              unit: ingredient.unit,
            })),
        );
        const estimate = estimateItemsToRecord(items, draft.servings);
        const localTotal = calculation.values;
        nutrition = {
          ...localTotal,
          calories: localTotal.calories + estimate.calories,
          proteinGrams: localTotal.proteinGrams + estimate.proteinGrams,
          carbohydratesGrams:
            localTotal.carbohydratesGrams + estimate.carbohydratesGrams,
          sourceType: 'ai_estimate',
          sourceId: null,
          basis: 'serving',
          preparation: 'not_applicable',
          status:
            items.length === calculation.unresolvedIngredients.length
              ? 'estimated'
              : 'missing',
        };
      } catch {
        // Keep the deterministic partial result and its incomplete status.
      }
    }
    const result = await mutation.mutateAsync({
      draft: {
        ...draft,
        nutrition,
        recipeId: mode === 'edit' && id ? id : null,
        changeKind: 'manual_edit',
        userId: null,
        imagePath: state?.recipe.imagePath,
      },
      imageFile,
    });
    navigate(`/recipes/${result.recipeId}`);
  };

  return (
    <section className="flex flex-col gap-6" aria-labelledby="editor-title">
      <h1 id="editor-title" className="text-2xl font-semibold tracking-tight">
        {mode === 'create' ? 'New recipe' : 'Edit recipe'}
      </h1>
      <RecipeEditorForm
        initialValues={initialValues}
        existingImagePath={state?.recipe.imagePath}
        recipeId={mode === 'edit' ? id : null}
        onSubmit={handleSubmit}
        isSubmitting={mutation.isPending}
        submitLabel={mode === 'create' ? 'Create recipe' : 'Save changes'}
        nutritionSources={nutritionSources}
        isLoadingNutritionSources={isLoadingNutritionSources}
        enableDraftAssistant
      />
    </section>
  );
}
