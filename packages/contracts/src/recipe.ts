import { z } from 'zod';
import { nutritionRecordSchema } from './nutrition.ts';

/**
 * Exact rational quantity (R3): num/den are positive integers and the
 * fraction is always stored reduced. The schema can only enforce the
 * positive-integer part — callers must construct values with
 * `makeQuantity` so the reduced invariant holds.
 */
export const quantitySchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});
export type Quantity = z.infer<typeof quantitySchema>;

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/** Construct a reduced, positive exact rational quantity. */
export function makeQuantity(num: number, den: number): Quantity {
  if (!Number.isInteger(num) || !Number.isInteger(den)) {
    throw new Error(
      `quantity numerator and denominator must be integers (got ${num}/${den})`,
    );
  }
  if (num <= 0 || den <= 0) {
    throw new Error(
      `quantity numerator and denominator must be positive (got ${num}/${den})`,
    );
  }
  const divisor = gcd(num, den);
  return { num: num / divisor, den: den / divisor };
}

export const ingredientSchema = z.object({
  name: z.string().min(1).max(300),
  quantity: quantitySchema.nullable(),
  unit: z.string().nullable(),
  nutritionSource: z
    .object({
      sourceType: z.enum(['generic_food', 'user_product']),
      sourceId: z.string().uuid(),
    })
    .nullable()
    .optional(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const stepSchema = z.object({
  text: z.string().min(1).max(5000),
  durationSeconds: z.number().int().positive().nullable().optional(),
});
export type Step = z.infer<typeof stepSchema>;

export const recipeDraftSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().nullable(),
  servings: z.number().int().min(1),
  prepTimeMinutes: z.number().int().min(0).nullable(),
  cookTimeMinutes: z.number().int().min(0).nullable(),
  sourceName: z.string().nullable(),
  sourceUrl: z.string().url().nullable(),
  ingredients: z.array(ingredientSchema).min(1),
  steps: z.array(stepSchema).min(1),
  tags: z.array(z.string()),
  nutrition: nutritionRecordSchema.nullable().optional(),
});
export type RecipeDraft = z.infer<typeof recipeDraftSchema>;

export const recipeImportExtractionMethodSchema = z.enum([
  'structured_markup',
  'ai',
  'video_metadata',
]);
export type RecipeImportExtractionMethod = z.infer<
  typeof recipeImportExtractionMethodSchema
>;

export const recipeSnapshotSchema = recipeDraftSchema.extend({
  imagePath: z.string().nullable(),
});
export type RecipeSnapshot = z.infer<typeof recipeSnapshotSchema>;
