import type { RecipeDraft } from '@opendish/contracts';

import { formatQuantity } from '@/domain/rational.ts';
import type { RecipeFormValues } from '@/features/recipe-editor';

/**
 * Converts a structured recipe draft (from JSON-LD or AI extraction) into the
 * shape expected by the shared recipe editor form.
 */
export function draftToFormValues(draft: RecipeDraft): RecipeFormValues {
  return {
    title: draft.title,
    description: draft.description,
    servings: draft.servings,
    prepTimeMinutes: draft.prepTimeMinutes,
    cookTimeMinutes: draft.cookTimeMinutes,
    sourceName: draft.sourceName,
    sourceUrl: draft.sourceUrl,
    ingredients: draft.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantityText:
        ingredient.quantity === null ? '' : formatQuantity(ingredient.quantity),
      unit: ingredient.unit ?? '',
    })),
    steps: draft.steps.map((step) => ({
      text: step.text,
      durationSeconds: step.durationSeconds ?? null,
    })),
    tags: draft.tags,
  };
}
