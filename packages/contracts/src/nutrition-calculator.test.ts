import { describe, expect, it } from 'vitest';
import { calculateNutrition } from './nutrition-calculator.ts';
import { makeQuantity } from './recipe.ts';

const source = (values: {
  calories: number;
  proteinGrams: number;
  carbohydratesGrams: number;
}) => ({
  id: '00000000-0000-0000-0000-000000000001',
  sourceType: 'generic_food' as const,
  values,
  basis: '100g' as const,
  preparation: 'raw' as const,
  status: 'confirmed' as const,
});

describe('calculateNutrition', () => {
  it('scales per-100g sources, sums ingredients, and divides by servings', () => {
    const result = calculateNutrition(
      [
        {
          name: 'Beef',
          quantity: makeQuantity(200, 1),
          unit: 'g',
          source: source({
            calories: 250,
            proteinGrams: 26,
            carbohydratesGrams: 0,
          }),
        },
        {
          name: 'Onion',
          quantity: makeQuantity(100, 1),
          unit: 'g',
          source: source({
            calories: 40,
            proteinGrams: 1.1,
            carbohydratesGrams: 9.3,
          }),
        },
      ],
      2,
    );

    expect(result.values).toEqual({
      calories: 270,
      proteinGrams: 26.55,
      carbohydratesGrams: 4.65,
    });
    expect(result.status).toBe('confirmed');
    expect(result.unresolvedIngredients).toEqual([]);
  });

  it('supports label servings and preserves estimated status', () => {
    const result = calculateNutrition([
      {
        name: 'Yogurt',
        quantity: makeQuantity(2, 1),
        unit: 'servings',
        source: {
          ...source({ calories: 120, proteinGrams: 10, carbohydratesGrams: 8 }),
          sourceType: 'user_product',
          basis: 'serving',
          preparation: 'not_applicable',
          status: 'estimated',
        },
      },
    ]);

    expect(result.values).toEqual({
      calories: 240,
      proteinGrams: 20,
      carbohydratesGrams: 16,
    });
    expect(result.status).toBe('estimated');
  });

  it('does not guess unsupported units or missing sources', () => {
    const result = calculateNutrition([
      {
        name: 'One onion',
        quantity: makeQuantity(1, 1),
        unit: 'piece',
        source: source({
          calories: 40,
          proteinGrams: 1,
          carbohydratesGrams: 9,
        }),
      },
      { name: 'Salt', quantity: null, unit: null, source: null },
    ]);

    expect(result.values).toEqual({
      calories: 0,
      proteinGrams: 0,
      carbohydratesGrams: 0,
    });
    expect(result.status).toBe('missing');
    expect(result.unresolvedIngredients).toEqual(['One onion', 'Salt']);
  });
});
