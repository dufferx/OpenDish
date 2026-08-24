import { describe, expect, it } from 'vitest';
import {
  makeQuantity,
  validProposal,
  validRecipeSnapshot,
  type ModificationProposal,
} from '../../../packages/contracts/src/index.ts';
import { validateModificationProposal } from '../_shared/recipe-modification.ts';

describe('validateModificationProposal', () => {
  it('accepts a schema-valid, coherent proposal', () => {
    const result = validateModificationProposal(
      validRecipeSnapshot,
      validProposal,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.resultingRecipe).toEqual(
        validProposal.resultingRecipe,
      );
    }
  });

  it('rejects a schema-invalid payload without throwing', () => {
    const result = validateModificationProposal(validRecipeSnapshot, {
      summary: '',
      operations: [],
      resultingRecipe: null,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a completely unrelated payload shape', () => {
    expect(
      validateModificationProposal(validRecipeSnapshot, 'not a proposal')
        .ok,
    ).toBe(false);
    expect(validateModificationProposal(validRecipeSnapshot, null).ok).toBe(
      false,
    );
    expect(
      validateModificationProposal(validRecipeSnapshot, undefined).ok,
    ).toBe(false);
  });

  it('reproduces the reported bug: a single valid "add bacon" operation must succeed even when the AI-supplied resultingRecipe diverges', () => {
    // Shape of the real failure: the operations list is a perfectly valid,
    // minimal addIngredient — but the AI's freestanding `resultingRecipe`
    // text has drifted from what those operations actually produce (here,
    // it's missing the new ingredient entirely, as an LLM might if its two
    // outputs disagree). Before the fix, this was rejected wholesale with
    // "invalid recipe change"; the correct behavior is to derive the result
    // from the operations and ignore the AI's inconsistent copy.
    const addBacon: ModificationProposal = {
      summary: 'Add bacon to the ingredient list.',
      operations: [
        {
          kind: 'addIngredient',
          ingredient: {
            name: 'Bacon',
            quantity: makeQuantity(4, 1),
            unit: 'slices',
          },
        },
      ],
      resultingRecipe: {
        ...validRecipeSnapshot,
        // Deliberately diverges: the AI's own copy is stale/inconsistent.
      },
    };

    const result = validateModificationProposal(validRecipeSnapshot, addBacon);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.resultingRecipe.ingredients.at(-1)).toEqual({
      name: 'Bacon',
      quantity: makeQuantity(4, 1),
      unit: 'slices',
    });
  });

  it('rejects operations that reference a position outside the recipe', () => {
    const outOfRange: ModificationProposal = {
      ...validProposal,
      operations: [{ kind: 'removeIngredient', position: 99 }],
    };
    expect(validateModificationProposal(validRecipeSnapshot, outOfRange).ok).toBe(
      false,
    );
  });

  it('rejects an incomplete reorderSteps permutation', () => {
    const badReorder: ModificationProposal = {
      ...validProposal,
      operations: [{ kind: 'reorderSteps', order: [0, 0] }],
    };
    expect(
      validateModificationProposal(validRecipeSnapshot, badReorder).ok,
    ).toBe(false);
  });

  it('rejects operations that would leave the recipe schema-invalid (removing the last ingredient)', () => {
    const singleIngredientSnapshot = {
      ...validRecipeSnapshot,
      ingredients: [validRecipeSnapshot.ingredients[0]],
    };
    const removeOnly: ModificationProposal = {
      ...validProposal,
      operations: [{ kind: 'removeIngredient', position: 0 }],
    };
    expect(
      validateModificationProposal(singleIngredientSnapshot, removeOnly).ok,
    ).toBe(false);
  });

  it('ignores the imagePath field on the snapshot (not part of RecipeDraft)', () => {
    const withImage = { ...validRecipeSnapshot, imagePath: 'some/path.jpg' };
    const result = validateModificationProposal(withImage, validProposal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.resultingRecipe).not.toHaveProperty('imagePath');
    }
  });
});
