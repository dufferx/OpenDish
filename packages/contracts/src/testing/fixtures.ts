import type { ModificationProposal } from '../modification.ts';
import type { RecipeDraft, RecipeSnapshot } from '../recipe.ts';
import { makeQuantity } from '../recipe.ts';

/** A schema-valid `RecipeDraft` fixture for tests. */
export const validRecipeDraft: RecipeDraft = {
  title: 'Tomato Pasta',
  description: 'A simple weeknight pasta.',
  servings: 2,
  prepTimeMinutes: 10,
  cookTimeMinutes: 20,
  sourceName: 'Example Kitchen',
  sourceUrl: 'https://example.com/recipes/tomato-pasta',
  ingredients: [
    { name: 'Spaghetti', quantity: makeQuantity(1, 2), unit: 'lb' },
    { name: 'Canned tomatoes', quantity: makeQuantity(3, 2), unit: 'cups' },
    { name: 'Salt', quantity: null, unit: null },
  ],
  steps: [
    { text: 'Boil salted water and cook the spaghetti.' },
    { text: 'Simmer the tomatoes into a sauce.' },
    { text: 'Combine and serve.' },
  ],
  tags: ['pasta', 'quick'],
};

/** A schema-valid `RecipeSnapshot` fixture for tests. */
export const validRecipeSnapshot: RecipeSnapshot = {
  ...validRecipeDraft,
  imagePath: null,
};

/**
 * A schema-valid `ModificationProposal` fixture: scale 2 -> 4 servings and
 * double the spaghetti. `resultingRecipe` is consistent with `operations`
 * applied to `validRecipeDraft`.
 */
export const validProposal: ModificationProposal = {
  summary: 'Scale the recipe from 2 to 4 servings and double the spaghetti.',
  operations: [
    { kind: 'setServings', servings: 4 },
    {
      kind: 'updateIngredient',
      position: 0,
      patch: { quantity: makeQuantity(1, 1) },
    },
  ],
  resultingRecipe: {
    ...validRecipeDraft,
    servings: 4,
    ingredients: [
      { name: 'Spaghetti', quantity: makeQuantity(1, 1), unit: 'lb' },
      validRecipeDraft.ingredients[1],
      validRecipeDraft.ingredients[2],
    ],
  },
};
