import { z } from 'zod';
import type { FieldErrors } from 'react-hook-form';
import type { RecipeDraft } from '@opendish/contracts';

import { parseQuantityInput } from '@/domain/rational.ts';

export const formIngredientSchema = z.object({
  name: z.string().min(1, 'Ingredient name is required').max(300),
  quantityText: z.string().max(50),
  unit: z.string().max(50),
  nutritionSource: z
    .object({
      sourceType: z.enum(['generic_food', 'user_product']),
      sourceId: z.string().uuid(),
    })
    .nullable()
    .optional(),
});

export const formStepSchema = z.object({
  text: z.string().min(1, 'Step text is required').max(5000),
});

export const recipeFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  description: z.string().max(2000).nullable(),
  servings: z.coerce.number().int().min(1, 'Servings must be at least 1'),
  prepTimeMinutes: z.coerce.number().int().min(0).nullable(),
  cookTimeMinutes: z.coerce.number().int().min(0).nullable(),
  sourceName: z.string().max(300).nullable(),
  sourceUrl: z.string().max(500).nullable(),
  ingredients: z
    .array(formIngredientSchema)
    .min(1, 'At least one ingredient is required'),
  steps: z.array(formStepSchema).min(1, 'At least one step is required'),
  tags: z.array(z.string().min(1).max(50)),
});

export type RecipeFormValues = z.infer<typeof recipeFormSchema>;

export interface ParsedDraftResult {
  draft: RecipeDraft;
  fieldErrors: FieldErrors<RecipeFormValues>;
}

function normalizeNullableString(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeUrl(value: string | null): string | null {
  const normalized = normalizeNullableString(value);
  if (normalized === null) return null;
  try {
    new URL(normalized);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Convert form values to a schema-valid `RecipeDraft`, collecting per-field
 * errors (e.g. unparsable quantities, invalid URLs) so React Hook Form can
 * display them.
 */
export function parseRecipeFormValues(
  values: RecipeFormValues,
): ParsedDraftResult {
  const fieldErrors: FieldErrors<RecipeFormValues> = {};

  const ingredients = values.ingredients.map((ingredient, index) => {
    const quantityText = ingredient.quantityText.trim();
    let quantity: RecipeDraft['ingredients'][number]['quantity'] = null;
    if (quantityText !== '') {
      const parsed = parseQuantityInput(quantityText);
      if (parsed === null) {
        (fieldErrors.ingredients ??= {})[index] = {
          quantityText: {
            type: 'manual',
            message: 'Enter a quantity like 2, 1.5, 1/2, 1 ½, or leave blank.',
          },
        };
      } else {
        quantity = parsed;
      }
    }
    return {
      name: ingredient.name.trim(),
      quantity,
      unit: ingredient.unit.trim() === '' ? null : ingredient.unit.trim(),
      nutritionSource: ingredient.nutritionSource,
    };
  });

  const sourceUrl = normalizeUrl(values.sourceUrl);
  if (
    values.sourceUrl &&
    values.sourceUrl.trim() !== '' &&
    sourceUrl === null
  ) {
    fieldErrors.sourceUrl = {
      type: 'manual',
      message: 'Enter a valid URL or leave blank.',
    };
  }

  const draft: RecipeDraft = {
    title: values.title.trim(),
    description: normalizeNullableString(values.description),
    servings: values.servings,
    prepTimeMinutes: values.prepTimeMinutes,
    cookTimeMinutes: values.cookTimeMinutes,
    sourceName: normalizeNullableString(values.sourceName),
    sourceUrl,
    ingredients,
    steps: values.steps.map((step) => ({ text: step.text.trim() })),
    tags: values.tags.map((tag) => tag.trim()).filter((tag) => tag !== ''),
  };

  return { draft, fieldErrors };
}
