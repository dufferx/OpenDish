import { useQuery } from '@tanstack/react-query';
import type { NutritionSourceRecord } from '@opendish/contracts';

import { supabase } from '@/lib/supabase';

export interface NutritionSourceOption extends NutritionSourceRecord {
  label: string;
}

interface NutritionFoodRow {
  id: string;
  name: string;
  brand: string | null;
  basis: '100g' | '100ml';
  preparation: 'raw' | 'cooked' | 'not_applicable';
  calories: number;
  protein_grams: number;
  carbohydrates_grams: number;
  status: 'confirmed' | 'estimated';
}

function sourceLabel(name: string, brand: string | null, suffix: string) {
  return `${name}${brand ? ` · ${brand}` : ''} (${suffix})`;
}

export function useNutritionSources() {
  return useQuery({
    queryKey: ['nutrition-sources'],
    queryFn: fetchNutritionSources,
    staleTime: 30_000,
  });
}

export async function fetchNutritionSources(): Promise<
  NutritionSourceOption[]
> {
  const [
    { data: foods, error: foodsError },
    { data: products, error: productsError },
  ] = await Promise.all([
    supabase
      .from('nutrition_foods')
      .select(
        'id, name, brand, basis, preparation, calories, protein_grams, carbohydrates_grams, status',
      )
      .order('name'),
    supabase
      .from('user_products')
      .select(
        'id, name, brand, calories, protein_grams, carbohydrates_grams, status',
      )
      .order('name'),
  ]);
  if (foodsError) throw new Error(foodsError.message);
  if (productsError) throw new Error(productsError.message);

  const genericSources = ((foods ?? []) as NutritionFoodRow[]).map((food) => ({
    id: food.id,
    sourceType: 'generic_food' as const,
    values: {
      calories: Number(food.calories),
      proteinGrams: Number(food.protein_grams),
      carbohydratesGrams: Number(food.carbohydrates_grams),
    },
    basis: food.basis,
    preparation: food.preparation,
    status: food.status,
    label: sourceLabel(
      food.name,
      food.brand,
      `${food.basis}${food.preparation === 'not_applicable' ? '' : `, ${food.preparation}`}`,
    ),
  }));
  const productSources = (
    (products ?? []) as {
      id: string;
      name: string;
      brand: string | null;
      calories: number;
      protein_grams: number;
      carbohydrates_grams: number;
      status: 'confirmed' | 'estimated';
    }[]
  ).map((product) => ({
    id: product.id,
    sourceType: 'user_product' as const,
    values: {
      calories: Number(product.calories),
      proteinGrams: Number(product.protein_grams),
      carbohydratesGrams: Number(product.carbohydrates_grams),
    },
    basis: 'serving' as const,
    preparation: 'not_applicable' as const,
    status: product.status,
    label: sourceLabel(product.name, product.brand, 'per serving'),
  }));
  return [...genericSources, ...productSources];
}
