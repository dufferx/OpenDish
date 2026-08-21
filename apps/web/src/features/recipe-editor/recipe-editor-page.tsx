import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
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
    })),
    steps: state.steps.map((step) => ({ text: step.text })),
    tags: state.tags,
  };
}

function useRecipeQuery(recipeId: string | undefined) {
  return useQuery({
    queryKey: ['recipe', recipeId],
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
  ) => {
    const result = await mutation.mutateAsync({
      draft: {
        ...draft,
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
      />
    </section>
  );
}
