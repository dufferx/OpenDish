import { describe, expect, it } from 'vitest';
import {
  makeQuantity,
  validRecipeDraft,
  type Ingredient,
} from '@opendish/contracts';
import { ScalingError, scaleIngredients, scaledRecipe } from './scaling.ts';

const ingredients: Ingredient[] = [
  { name: 'Flour', quantity: makeQuantity(1, 2), unit: 'cup' },
  { name: 'Sugar', quantity: makeQuantity(3, 2), unit: 'tbsp' },
  { name: 'Salt', quantity: null, unit: null },
  { name: 'Vanilla', quantity: null, unit: 'tsp' },
];

describe('scaleIngredients', () => {
  it('halves quantities exactly when going 4 -> 2 servings', () => {
    const scaled = scaleIngredients(ingredients, 4, 2);
    expect(scaled[0].quantity).toEqual(makeQuantity(1, 4));
    expect(scaled[1].quantity).toEqual(makeQuantity(3, 4));
  });

  it('scales up 2 -> 3 with exact thirds', () => {
    const scaled = scaleIngredients(ingredients, 2, 3);
    expect(scaled[0].quantity).toEqual(makeQuantity(3, 4));
    expect(scaled[1].quantity).toEqual(makeQuantity(9, 4));
  });

  it('scales 3 -> 1 without floating point drift', () => {
    const scaled = scaleIngredients(
      [{ name: 'Milk', quantity: makeQuantity(1, 3), unit: 'cup' }],
      1,
      3,
    );
    expect(scaled[0].quantity).toEqual(makeQuantity(1, 1));
  });

  it('passes quantity-less ingredients through untouched', () => {
    const scaled = scaleIngredients(ingredients, 4, 2);
    expect(scaled[2]).toEqual({ name: 'Salt', quantity: null, unit: null });
    expect(scaled[3]).toEqual({ name: 'Vanilla', quantity: null, unit: 'tsp' });
  });

  it('keeps name and unit, returns a new list', () => {
    const scaled = scaleIngredients(ingredients, 4, 8);
    expect(scaled).not.toBe(ingredients);
    expect(scaled[0]).toMatchObject({ name: 'Flour', unit: 'cup' });
    expect(scaled[1].quantity).toEqual(makeQuantity(3, 1));
  });

  it('does not mutate the input ingredients', () => {
    const before = structuredClone(ingredients);
    scaleIngredients(ingredients, 4, 2);
    expect(ingredients).toEqual(before);
  });

  it('is a no-op when base equals desired', () => {
    const scaled = scaleIngredients(ingredients, 4, 4);
    expect(scaled).toEqual(ingredients);
  });

  it.each([
    ['zero base', 0, 2],
    ['negative base', -4, 2],
    ['zero desired', 4, 0],
    ['negative desired', 4, -2],
    ['non-integer desired', 4, 2.5],
    ['absurd desired', 4, 101],
    ['absurd base', 101, 4],
    ['far absurd desired', 2, 10000],
  ])('rejects %s (%s -> %s) with ScalingError', (_label, base, desired) => {
    expect(() => scaleIngredients(ingredients, base, desired)).toThrow(
      ScalingError,
    );
  });
});

describe('scaledRecipe', () => {
  it('scales ingredients and updates servings', () => {
    const scaled = scaledRecipe(validRecipeDraft, 4);
    expect(scaled.servings).toBe(4);
    expect(scaled.ingredients[0].quantity).toEqual(makeQuantity(1, 1));
    expect(scaled.ingredients[1].quantity).toEqual(makeQuantity(3, 1));
    expect(scaled.ingredients[2]).toEqual({
      name: 'Salt',
      quantity: null,
      unit: null,
    });
  });

  it('leaves steps, tags and metadata untouched', () => {
    const scaled = scaledRecipe(validRecipeDraft, 1);
    expect(scaled.steps).toEqual(validRecipeDraft.steps);
    expect(scaled.tags).toEqual(validRecipeDraft.tags);
    expect(scaled.title).toBe(validRecipeDraft.title);
    expect(scaled.sourceUrl).toBe(validRecipeDraft.sourceUrl);
  });

  it('does not mutate the original draft', () => {
    const before = structuredClone(validRecipeDraft);
    scaledRecipe(validRecipeDraft, 6);
    expect(validRecipeDraft).toEqual(before);
  });

  it('rejects invalid target servings', () => {
    expect(() => scaledRecipe(validRecipeDraft, 0)).toThrow(ScalingError);
    expect(() => scaledRecipe(validRecipeDraft, 500)).toThrow(ScalingError);
  });
});
