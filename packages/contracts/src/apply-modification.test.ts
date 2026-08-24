import { describe, expect, it } from 'vitest';
import { applyModificationOperations } from './apply-modification.ts';
import { makeQuantity } from './recipe.ts';
import { validRecipeDraft } from './testing/fixtures.ts';

describe('applyModificationOperations', () => {
  it('does not mutate the base recipe', () => {
    const before = JSON.stringify(validRecipeDraft);
    applyModificationOperations(validRecipeDraft, [
      { kind: 'setTitle', title: 'Changed' },
    ]);
    expect(JSON.stringify(validRecipeDraft)).toBe(before);
  });

  describe('addIngredient', () => {
    it('appends to the end when afterPosition is omitted', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        {
          kind: 'addIngredient',
          ingredient: { name: 'Bacon', quantity: null, unit: null },
        },
      ]);
      expect(result.ingredients.at(-1)).toEqual({
        name: 'Bacon',
        quantity: null,
        unit: null,
      });
      expect(result.ingredients).toHaveLength(
        validRecipeDraft.ingredients.length + 1,
      );
    });

    it('inserts after the given position', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        {
          kind: 'addIngredient',
          ingredient: { name: 'Bacon', quantity: null, unit: null },
          afterPosition: 0,
        },
      ]);
      expect(result.ingredients[1]).toEqual({
        name: 'Bacon',
        quantity: null,
        unit: null,
      });
      expect(result.ingredients[0]).toEqual(validRecipeDraft.ingredients[0]);
      expect(result.ingredients[2]).toEqual(validRecipeDraft.ingredients[1]);
    });

    it('throws when afterPosition is outside the recipe', () => {
      expect(() =>
        applyModificationOperations(validRecipeDraft, [
          {
            kind: 'addIngredient',
            ingredient: { name: 'Bacon', quantity: null, unit: null },
            afterPosition: 99,
          },
        ]),
      ).toThrow();
      expect(() =>
        applyModificationOperations(validRecipeDraft, [
          {
            kind: 'addIngredient',
            ingredient: { name: 'Bacon', quantity: null, unit: null },
            afterPosition: -1,
          },
        ]),
      ).toThrow();
    });
  });

  describe('removeIngredient', () => {
    it('removes the ingredient at the given position', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        { kind: 'removeIngredient', position: 1 },
      ]);
      expect(result.ingredients).toEqual([
        validRecipeDraft.ingredients[0],
        validRecipeDraft.ingredients[2],
      ]);
    });

    it('throws when the position is outside the recipe', () => {
      expect(() =>
        applyModificationOperations(validRecipeDraft, [
          { kind: 'removeIngredient', position: 99 },
        ]),
      ).toThrow();
    });

    it('throws instead of leaving an empty ingredient list (final schema check)', () => {
      const oneIngredient = {
        ...validRecipeDraft,
        ingredients: [validRecipeDraft.ingredients[0]],
      };
      expect(() =>
        applyModificationOperations(oneIngredient, [
          { kind: 'removeIngredient', position: 0 },
        ]),
      ).toThrow();
    });
  });

  describe('updateIngredient', () => {
    it('merges the patch into the existing ingredient', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        {
          kind: 'updateIngredient',
          position: 0,
          patch: { quantity: makeQuantity(1, 1) },
        },
      ]);
      expect(result.ingredients[0]).toEqual({
        ...validRecipeDraft.ingredients[0],
        quantity: makeQuantity(1, 1),
      });
    });

    it('throws when the position is outside the recipe', () => {
      expect(() =>
        applyModificationOperations(validRecipeDraft, [
          { kind: 'updateIngredient', position: 99, patch: { unit: 'g' } },
        ]),
      ).toThrow();
    });
  });

  describe('steps', () => {
    it('addStep appends by default and inserts after a position', () => {
      const appended = applyModificationOperations(validRecipeDraft, [
        { kind: 'addStep', step: { text: 'Garnish and serve.' } },
      ]);
      expect(appended.steps.at(-1)).toEqual({ text: 'Garnish and serve.' });

      const inserted = applyModificationOperations(validRecipeDraft, [
        {
          kind: 'addStep',
          step: { text: 'Preheat the oven.' },
          afterPosition: 0,
        },
      ]);
      expect(inserted.steps[1]).toEqual({ text: 'Preheat the oven.' });
    });

    it('removeStep removes the given step and throws out of range', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        { kind: 'removeStep', position: 0 },
      ]);
      expect(result.steps).toEqual(validRecipeDraft.steps.slice(1));
      expect(() =>
        applyModificationOperations(validRecipeDraft, [
          { kind: 'removeStep', position: 99 },
        ]),
      ).toThrow();
    });

    it('updateStep replaces the step text at the given position', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        { kind: 'updateStep', position: 1, text: 'Simmer for 15 minutes.' },
      ]);
      expect(result.steps[1]).toEqual({ text: 'Simmer for 15 minutes.' });
    });

    it('reorderSteps accepts a full permutation', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        { kind: 'reorderSteps', order: [2, 0, 1] },
      ]);
      expect(result.steps).toEqual([
        validRecipeDraft.steps[2],
        validRecipeDraft.steps[0],
        validRecipeDraft.steps[1],
      ]);
    });

    it('reorderSteps throws on a duplicate index', () => {
      expect(() =>
        applyModificationOperations(validRecipeDraft, [
          { kind: 'reorderSteps', order: [0, 0, 2] },
        ]),
      ).toThrow();
    });

    it('reorderSteps throws when an index is missing', () => {
      expect(() =>
        applyModificationOperations(validRecipeDraft, [
          { kind: 'reorderSteps', order: [0, 1] },
        ]),
      ).toThrow();
    });

    it('reorderSteps throws when an index is out of range', () => {
      expect(() =>
        applyModificationOperations(validRecipeDraft, [
          { kind: 'reorderSteps', order: [0, 1, 99] },
        ]),
      ).toThrow();
    });
  });

  describe('recipe-level operations', () => {
    it('setServings, setTitle, and setDescription (including clearing) replace their field', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        { kind: 'setServings', servings: 6 },
        { kind: 'setTitle', title: 'New Title' },
        { kind: 'setDescription', description: null },
      ]);
      expect(result.servings).toBe(6);
      expect(result.title).toBe('New Title');
      expect(result.description).toBeNull();
    });

    it('setTimes only overwrites keys that are present, leaving others untouched', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        { kind: 'setTimes', cookTimeMinutes: 45 },
      ]);
      expect(result.cookTimeMinutes).toBe(45);
      expect(result.prepTimeMinutes).toBe(validRecipeDraft.prepTimeMinutes);
    });

    it('setTimes can explicitly clear a value with null', () => {
      const result = applyModificationOperations(validRecipeDraft, [
        { kind: 'setTimes', prepTimeMinutes: null },
      ]);
      expect(result.prepTimeMinutes).toBeNull();
      expect(result.cookTimeMinutes).toBe(validRecipeDraft.cookTimeMinutes);
    });
  });

  it('applies multiple operations in sequence (the "add bacon" shape)', () => {
    const result = applyModificationOperations(validRecipeDraft, [
      {
        kind: 'addIngredient',
        ingredient: { name: 'Bacon', quantity: makeQuantity(4, 1), unit: 'slices' },
      },
      {
        kind: 'addStep',
        step: { text: 'Cook the bacon until crispy and crumble it in.' },
      },
    ]);
    expect(result.ingredients.at(-1)).toEqual({
      name: 'Bacon',
      quantity: makeQuantity(4, 1),
      unit: 'slices',
    });
    expect(result.steps.at(-1)).toEqual({
      text: 'Cook the bacon until crispy and crumble it in.',
    });
    // Untouched fields survive unchanged.
    expect(result.title).toBe(validRecipeDraft.title);
    expect(result.servings).toBe(validRecipeDraft.servings);
  });
});
