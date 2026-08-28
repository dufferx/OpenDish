import {
  nutritionEstimateItemSchema,
  type NutritionEstimateIngredient,
  type NutritionEstimateItem,
  type NutritionRecord,
} from '@opendish/contracts';
import { supabase } from '@/lib/supabase';

export async function estimateMissingNutrition(
  ingredients: NutritionEstimateIngredient[],
): Promise<NutritionEstimateItem[]> {
  const { data, error } = await supabase.functions.invoke(
    'ai-estimate-nutrition',
    {
      body: { ingredients },
    },
  );
  if (error) throw new Error('Could not estimate missing nutrition with AI.');
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items))
    throw new Error('The AI returned an invalid nutrition estimate.');
  const parsed = items.map((item) =>
    nutritionEstimateItemSchema.safeParse(item),
  );
  if (parsed.some((item) => !item.success))
    throw new Error('The AI returned an invalid nutrition estimate.');
  return parsed.flatMap((item) => (item.success ? [item.data] : []));
}

export function estimateItemsToRecord(
  items: NutritionEstimateItem[],
  servings: number,
): NutritionRecord {
  const total = items.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      proteinGrams: sum.proteinGrams + item.proteinGrams,
      carbohydratesGrams: sum.carbohydratesGrams + item.carbohydratesGrams,
    }),
    { calories: 0, proteinGrams: 0, carbohydratesGrams: 0 },
  );
  return {
    calories: total.calories / servings,
    proteinGrams: total.proteinGrams / servings,
    carbohydratesGrams: total.carbohydratesGrams / servings,
    sourceType: 'ai_estimate',
    sourceId: null,
    basis: 'serving',
    preparation: 'not_applicable',
    status: 'estimated',
  };
}
