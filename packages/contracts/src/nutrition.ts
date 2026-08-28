import { z } from 'zod';

/** The three nutrition values exposed by the first nutrition release. */
export const nutritionValuesSchema = z.object({
  calories: z.number().finite().nonnegative(),
  proteinGrams: z.number().finite().nonnegative(),
  carbohydratesGrams: z.number().finite().nonnegative(),
});
export type NutritionValues = z.infer<typeof nutritionValuesSchema>;

export const nutritionSourceTypeSchema = z.enum([
  'generic_food',
  'user_product',
  'ai_estimate',
  'manual',
]);
export type NutritionSourceType = z.infer<typeof nutritionSourceTypeSchema>;

export const nutritionStatusSchema = z.enum([
  'confirmed',
  'estimated',
  'missing',
]);
export type NutritionStatus = z.infer<typeof nutritionStatusSchema>;

export const nutritionBasisSchema = z.enum(['100g', '100ml', 'serving']);
export type NutritionBasis = z.infer<typeof nutritionBasisSchema>;

export const foodPreparationSchema = z.enum([
  'raw',
  'cooked',
  'not_applicable',
]);
export type FoodPreparation = z.infer<typeof foodPreparationSchema>;

/** Nutrients plus the provenance needed to explain how they were calculated. */
export const nutritionRecordSchema = nutritionValuesSchema.extend({
  sourceType: nutritionSourceTypeSchema,
  sourceId: z.string().uuid().nullable(),
  basis: nutritionBasisSchema,
  preparation: foodPreparationSchema,
  status: nutritionStatusSchema,
});
export type NutritionRecord = z.infer<typeof nutritionRecordSchema>;

export const nutritionSourceSchema = z.object({
  sourceType: nutritionSourceTypeSchema,
  sourceId: z.string().uuid().nullable(),
});
export type NutritionSource = z.infer<typeof nutritionSourceSchema>;

/** AI output used to prefill the product confirmation form. */
export const productLabelDraftSchema = z.object({
  name: z.string().min(1).max(300),
  brand: z.string().max(300).nullable(),
  servingSizeText: z.string().min(1).max(200),
  servingMassG: z.number().finite().positive().nullable(),
  servingVolumeMl: z.number().finite().positive().nullable(),
  calories: z.number().finite().nonnegative(),
  proteinGrams: z.number().finite().nonnegative(),
  carbohydratesGrams: z.number().finite().nonnegative(),
});
export type ProductLabelDraft = z.infer<typeof productLabelDraftSchema>;

export const nutritionEstimateIngredientSchema = z.object({
  name: z.string().min(1).max(300),
  quantity: z.number().finite().positive().nullable(),
  unit: z.string().max(50).nullable(),
});
export type NutritionEstimateIngredient = z.infer<
  typeof nutritionEstimateIngredientSchema
>;

export const nutritionEstimateItemSchema = nutritionValuesSchema.extend({
  name: z.string().min(1).max(300),
});
export type NutritionEstimateItem = z.infer<typeof nutritionEstimateItemSchema>;
