import { describe, expect, it } from 'vitest';
import {
  ingredientSchema,
  makeQuantity,
  quantitySchema,
  recipeDraftSchema,
  recipeImportExtractionMethodSchema,
  recipeSnapshotSchema,
  stepSchema,
} from './recipe.ts';
import { validRecipeDraft } from './testing/fixtures.ts';

describe('makeQuantity', () => {
  it('reduces fractions via gcd', () => {
    expect(makeQuantity(2, 4)).toEqual({ num: 1, den: 2 });
    expect(makeQuantity(6, 9)).toEqual({ num: 2, den: 3 });
    expect(makeQuantity(12, 8)).toEqual({ num: 3, den: 2 });
  });

  it('keeps already-reduced and whole-number quantities', () => {
    expect(makeQuantity(1, 2)).toEqual({ num: 1, den: 2 });
    expect(makeQuantity(5, 1)).toEqual({ num: 5, den: 1 });
  });

  it('throws on non-positive or non-integer inputs', () => {
    expect(() => makeQuantity(0, 2)).toThrow();
    expect(() => makeQuantity(1, 0)).toThrow();
    expect(() => makeQuantity(-1, 2)).toThrow();
    expect(() => makeQuantity(1.5, 2)).toThrow();
  });

  it('produces values that pass quantitySchema', () => {
    expect(quantitySchema.safeParse(makeQuantity(7, 3)).success).toBe(true);
  });
});

describe('quantitySchema', () => {
  it('rejects zero, negative, and non-integer parts', () => {
    expect(quantitySchema.safeParse({ num: 0, den: 2 }).success).toBe(false);
    expect(quantitySchema.safeParse({ num: 1, den: -2 }).success).toBe(false);
    expect(quantitySchema.safeParse({ num: 0.5, den: 2 }).success).toBe(false);
  });
});

describe('ingredientSchema', () => {
  it('accepts a quantity-less ingredient', () => {
    const result = ingredientSchema.safeParse({
      name: 'Salt',
      quantity: null,
      unit: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a quantity without a unit', () => {
    const result = ingredientSchema.safeParse({
      name: 'Egg',
      quantity: { num: 2, den: 1 },
      unit: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty name and a name over 300 chars', () => {
    expect(
      ingredientSchema.safeParse({ name: '', quantity: null, unit: null })
        .success,
    ).toBe(false);
    expect(
      ingredientSchema.safeParse({
        name: 'x'.repeat(301),
        quantity: null,
        unit: null,
      }).success,
    ).toBe(false);
  });
});

describe('stepSchema', () => {
  it('rejects empty text and text over 5000 chars', () => {
    expect(stepSchema.safeParse({ text: '' }).success).toBe(false);
    expect(stepSchema.safeParse({ text: 'x'.repeat(5001) }).success).toBe(
      false,
    );
    expect(stepSchema.safeParse({ text: 'Mix well.' }).success).toBe(true);
  });

  it('accepts optional positive durations and rejects zero', () => {
    expect(
      stepSchema.safeParse({ text: 'Simmer.', durationSeconds: 90 }).success,
    ).toBe(true);
    expect(
      stepSchema.safeParse({ text: 'Simmer.', durationSeconds: null }).success,
    ).toBe(true);
    expect(
      stepSchema.safeParse({ text: 'Simmer.', durationSeconds: 0 }).success,
    ).toBe(false);
  });
});

describe('recipeDraftSchema', () => {
  it('accepts the valid fixture', () => {
    expect(recipeDraftSchema.safeParse(validRecipeDraft).success).toBe(true);
  });

  it('rejects an invalid sourceUrl and accepts a null one', () => {
    expect(
      recipeDraftSchema.safeParse({
        ...validRecipeDraft,
        sourceUrl: 'not-a-url',
      }).success,
    ).toBe(false);
    expect(
      recipeDraftSchema.safeParse({ ...validRecipeDraft, sourceUrl: null })
        .success,
    ).toBe(true);
  });

  it('rejects empty title and title over 300 chars', () => {
    expect(
      recipeDraftSchema.safeParse({ ...validRecipeDraft, title: '' }).success,
    ).toBe(false);
    expect(
      recipeDraftSchema.safeParse({
        ...validRecipeDraft,
        title: 'x'.repeat(301),
      }).success,
    ).toBe(false);
  });

  it('rejects empty ingredients or steps arrays', () => {
    expect(
      recipeDraftSchema.safeParse({ ...validRecipeDraft, ingredients: [] })
        .success,
    ).toBe(false);
    expect(
      recipeDraftSchema.safeParse({ ...validRecipeDraft, steps: [] }).success,
    ).toBe(false);
  });

  it('rejects servings below 1 or non-integer', () => {
    expect(
      recipeDraftSchema.safeParse({ ...validRecipeDraft, servings: 0 }).success,
    ).toBe(false);
    expect(
      recipeDraftSchema.safeParse({ ...validRecipeDraft, servings: 1.5 })
        .success,
    ).toBe(false);
  });

  it('rejects negative times and accepts null times', () => {
    expect(
      recipeDraftSchema.safeParse({ ...validRecipeDraft, prepTimeMinutes: -1 })
        .success,
    ).toBe(false);
    expect(
      recipeDraftSchema.safeParse({
        ...validRecipeDraft,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
      }).success,
    ).toBe(true);
  });
});

describe('recipeSnapshotSchema', () => {
  it('accepts a draft plus imagePath and rejects a missing imagePath', () => {
    expect(
      recipeSnapshotSchema.safeParse({ ...validRecipeDraft, imagePath: null })
        .success,
    ).toBe(true);
    expect(recipeSnapshotSchema.safeParse(validRecipeDraft).success).toBe(
      false,
    );
  });
});

describe('recipeImportExtractionMethodSchema', () => {
  it('accepts the supported extraction methods and rejects unknown values', () => {
    expect(
      recipeImportExtractionMethodSchema.safeParse('structured_markup').success,
    ).toBe(true);
    expect(recipeImportExtractionMethodSchema.safeParse('ai').success).toBe(
      true,
    );
    expect(
      recipeImportExtractionMethodSchema.safeParse('video_metadata').success,
    ).toBe(true);
    expect(
      recipeImportExtractionMethodSchema.safeParse('unknown').success,
    ).toBe(false);
  });
});
