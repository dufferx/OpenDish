import type { NutritionValues } from './nutrition.ts';
import type { Quantity } from './recipe.ts';

export interface NutritionSourceRecord {
  id: string;
  sourceType: 'generic_food' | 'user_product' | 'ai_estimate' | 'manual';
  values: NutritionValues;
  /** The amount represented by `values`: grams, millilitres, or servings. */
  basis: '100g' | '100ml' | 'serving';
  preparation: 'raw' | 'cooked' | 'not_applicable';
  status: 'confirmed' | 'estimated' | 'missing';
}

export interface NutritionIngredientInput {
  name: string;
  quantity: Quantity | null;
  unit: string | null;
  source: NutritionSourceRecord | null;
}

export interface NutritionCalculation {
  values: NutritionValues;
  status: 'confirmed' | 'estimated' | 'missing';
  unresolvedIngredients: string[];
  ingredientValues: Record<string, NutritionValues>;
}

function quantityToNumber(quantity: Quantity): number {
  return quantity.num / quantity.den;
}

function normalizeUnit(unit: string | null): string | null {
  if (!unit) return null;
  return unit.trim().toLowerCase().replaceAll(' ', '_');
}

function basisAmount(
  quantity: Quantity,
  unit: string | null,
  sourceBasis: NutritionSourceRecord['basis'],
): number | null {
  const amount = quantityToNumber(quantity);
  const normalized = normalizeUnit(unit);
  if (sourceBasis === 'serving') {
    return normalized === 'serving' || normalized === 'servings'
      ? amount
      : null;
  }
  if (sourceBasis === '100g') {
    if (normalized === 'g' || normalized === 'gram' || normalized === 'grams') {
      return amount / 100;
    }
    if (
      normalized === 'kg' ||
      normalized === 'kilogram' ||
      normalized === 'kilograms'
    ) {
      return (amount * 1000) / 100;
    }
  }
  if (sourceBasis === '100ml') {
    if (
      normalized === 'ml' ||
      normalized === 'milliliter' ||
      normalized === 'milliliters'
    ) {
      return amount / 100;
    }
    if (
      normalized === 'l' ||
      normalized === 'liter' ||
      normalized === 'liters'
    ) {
      return (amount * 1000) / 100;
    }
  }
  return null;
}

function scale(values: NutritionValues, multiplier: number): NutritionValues {
  return {
    calories: values.calories * multiplier,
    proteinGrams: values.proteinGrams * multiplier,
    carbohydratesGrams: values.carbohydratesGrams * multiplier,
  };
}

function add(left: NutritionValues, right: NutritionValues): NutritionValues {
  return {
    calories: left.calories + right.calories,
    proteinGrams: left.proteinGrams + right.proteinGrams,
    carbohydratesGrams: left.carbohydratesGrams + right.carbohydratesGrams,
  };
}

function statusRank(status: NutritionCalculation['status']): number {
  return status === 'missing' ? 2 : status === 'estimated' ? 1 : 0;
}

/**
 * Calculate nutrition using declared source values and deterministic unit
 * conversion. Unknown units are reported as unresolved instead of guessed.
 */
export function calculateNutrition(
  ingredients: NutritionIngredientInput[],
  servings = 1,
): NutritionCalculation {
  if (!Number.isInteger(servings) || servings < 1) {
    throw new Error(`servings must be a positive integer (got ${servings})`);
  }

  let total: NutritionValues = {
    calories: 0,
    proteinGrams: 0,
    carbohydratesGrams: 0,
  };
  let status: NutritionCalculation['status'] = 'confirmed';
  const unresolvedIngredients: string[] = [];
  const ingredientValues: Record<string, NutritionValues> = {};

  for (const ingredient of ingredients) {
    if (!ingredient.source || !ingredient.quantity) {
      unresolvedIngredients.push(ingredient.name);
      status = 'missing';
      continue;
    }
    const multiplier = basisAmount(
      ingredient.quantity,
      ingredient.unit,
      ingredient.source.basis,
    );
    if (multiplier === null) {
      unresolvedIngredients.push(ingredient.name);
      status = 'missing';
      continue;
    }
    const ingredientTotal = scale(ingredient.source.values, multiplier);
    ingredientValues[ingredient.name] = ingredientTotal;
    total = add(total, ingredientTotal);
    if (statusRank(ingredient.source.status) > statusRank(status)) {
      status = ingredient.source.status;
    }
  }

  return {
    values: scale(total, 1 / servings),
    status,
    unresolvedIngredients,
    ingredientValues,
  };
}
