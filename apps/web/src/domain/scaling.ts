import {
  makeQuantity,
  type Ingredient,
  type RecipeDraft,
} from '@opendish/contracts';
import { multiplyQuantity } from './rational.ts';

/** Maximum servings the UI/domain accepts; anything larger is an input bug. */
export const MAX_SERVINGS = 100;

/** Typed error for invalid serving counts (non-positive, non-integer, absurd). */
export class ScalingError extends Error {
  readonly baseServings: number;
  readonly desiredServings: number;

  constructor(message: string, baseServings: number, desiredServings: number) {
    super(message);
    this.name = 'ScalingError';
    this.baseServings = baseServings;
    this.desiredServings = desiredServings;
  }
}

function assertServings(
  value: number,
  label: string,
  base: number,
  desired: number,
): void {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_SERVINGS) {
    throw new ScalingError(
      `${label} servings must be an integer between 1 and ${MAX_SERVINGS} (got ${value})`,
      base,
      desired,
    );
  }
}

/**
 * Exact rational serving scaling (research R3): every quantity is multiplied
 * by `desiredServings / baseServings` and reduced. Quantity-less ingredients
 * (quantity `null`) pass through untouched. Pure: inputs are not mutated.
 */
export function scaleIngredients(
  ingredients: Ingredient[],
  baseServings: number,
  desiredServings: number,
): Ingredient[] {
  assertServings(baseServings, 'base', baseServings, desiredServings);
  assertServings(desiredServings, 'desired', baseServings, desiredServings);
  const factor = makeQuantity(desiredServings, baseServings);
  return ingredients.map((ingredient) =>
    ingredient.quantity === null
      ? { ...ingredient }
      : {
          ...ingredient,
          quantity: multiplyQuantity(ingredient.quantity, factor),
        },
  );
}

/**
 * A copy of the draft scaled from its own servings to `servings`: ingredient
 * quantities are scaled exactly and `servings` is updated. Nothing is saved —
 * persisting an adjustment goes through the domain save path (recipe-save).
 */
export function scaledRecipe(
  draft: RecipeDraft,
  servings: number,
): RecipeDraft {
  return {
    ...draft,
    servings,
    ingredients: scaleIngredients(draft.ingredients, draft.servings, servings),
  };
}
