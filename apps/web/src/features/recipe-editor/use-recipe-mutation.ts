import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  saveRecipe,
  type SaveRecipeInput,
  type SaveRecipeResult,
} from '@/domain/recipe-save.ts';
import { supabase } from '@/lib/supabase';
import { uploadRecipeImage } from '@/lib/recipe-images.ts';

export interface RecipeMutationVariables {
  draft: SaveRecipeInput;
  imageFile?: File | null;
}

async function saveWithOptionalImage(
  variables: RecipeMutationVariables,
): Promise<SaveRecipeResult> {
  const { draft, imageFile } = variables;

  // For creates, first persist the recipe so we know the recipe id for the
  // storage path (`{user_id}/{recipe_id}/{file}`).
  if (draft.recipeId === null) {
    const created = await saveRecipe(supabase, { ...draft, imagePath: null });
    if (imageFile) {
      const imagePath = await uploadRecipeImage(imageFile, created.recipeId);
      await saveRecipe(supabase, {
        ...draft,
        recipeId: created.recipeId,
        changeKind: draft.changeKind,
        imagePath,
      });
      return {
        recipeId: created.recipeId,
        headVersion: created.headVersion + 1,
      };
    }
    return created;
  }

  let imagePath: string | null | undefined;
  if (imageFile) {
    imagePath = await uploadRecipeImage(imageFile, draft.recipeId);
  }
  return saveRecipe(supabase, {
    ...draft,
    imagePath: imageFile ? imagePath : draft.imagePath,
  });
}

/** Create or update a recipe through the single domain save path (T036). */
export function useRecipeMutation() {
  const queryClient = useQueryClient();

  return useMutation<SaveRecipeResult, Error, RecipeMutationVariables>({
    mutationFn: saveWithOptionalImage,
    onSuccess: ({ recipeId }) => {
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      void queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
    },
    onError: (error) => {
      toast.error(
        error.message ?? 'Could not save the recipe. Please try again.',
      );
    },
  });
}
