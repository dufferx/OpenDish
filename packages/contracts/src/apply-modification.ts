import {
  recipeDraftSchema,
  type Ingredient,
  type RecipeDraft,
  type Step,
} from './recipe.ts';
import type { ModificationOp } from './modification.ts';

function insertAfter<T>(items: T[], value: T, afterPosition?: number): T[] {
  if (afterPosition === undefined) return [...items, value];
  if (afterPosition < 0 || afterPosition >= items.length) {
    throw new Error('operation position is outside the recipe');
  }
  const result = [...items];
  result.splice(afterPosition + 1, 0, value);
  return result;
}

function requirePosition<T>(items: T[], position: number): T {
  const value = items[position];
  if (value === undefined) {
    throw new Error('operation position is outside the recipe');
  }
  return value;
}

function applyOperation(
  recipe: RecipeDraft,
  operation: ModificationOp,
): RecipeDraft {
  switch (operation.kind) {
    case 'addIngredient':
      return {
        ...recipe,
        ingredients: insertAfter(
          recipe.ingredients,
          operation.ingredient,
          operation.afterPosition,
        ),
      };
    case 'removeIngredient': {
      requirePosition(recipe.ingredients, operation.position);
      return {
        ...recipe,
        ingredients: recipe.ingredients.filter(
          (_ingredient, position) => position !== operation.position,
        ),
      };
    }
    case 'updateIngredient': {
      const current = requirePosition(recipe.ingredients, operation.position);
      const ingredients: Ingredient[] = [...recipe.ingredients];
      ingredients[operation.position] = { ...current, ...operation.patch };
      return { ...recipe, ingredients };
    }
    case 'addStep':
      return {
        ...recipe,
        steps: insertAfter(
          recipe.steps,
          operation.step,
          operation.afterPosition,
        ),
      };
    case 'removeStep': {
      requirePosition(recipe.steps, operation.position);
      return {
        ...recipe,
        steps: recipe.steps.filter(
          (_step, position) => position !== operation.position,
        ),
      };
    }
    case 'updateStep': {
      const current = requirePosition(recipe.steps, operation.position);
      const steps: Step[] = [...recipe.steps];
      steps[operation.position] = {
        ...current,
        text: operation.text,
        ...(operation.durationSeconds !== undefined
          ? { durationSeconds: operation.durationSeconds }
          : {}),
      };
      return { ...recipe, steps };
    }
    case 'reorderSteps': {
      if (
        operation.order.length !== recipe.steps.length ||
        new Set(operation.order).size !== recipe.steps.length ||
        operation.order.some(
          (position) => position < 0 || position >= recipe.steps.length,
        )
      ) {
        throw new Error('reorderSteps must contain every step position once');
      }
      return {
        ...recipe,
        steps: operation.order.map((position) =>
          requirePosition(recipe.steps, position),
        ),
      };
    }
    case 'setServings':
      return { ...recipe, servings: operation.servings };
    case 'setTitle':
      return { ...recipe, title: operation.title };
    case 'setDescription':
      return { ...recipe, description: operation.description };
    case 'setTimes':
      return {
        ...recipe,
        prepTimeMinutes:
          operation.prepTimeMinutes === undefined
            ? recipe.prepTimeMinutes
            : operation.prepTimeMinutes,
        cookTimeMinutes:
          operation.cookTimeMinutes === undefined
            ? recipe.cookTimeMinutes
            : operation.cookTimeMinutes,
      };
  }
}

/**
 * Deterministically re-applies structured modification operations. The input
 * is never mutated and the final draft is validated against the domain schema.
 */
export function applyModificationOperations(
  baseRecipe: RecipeDraft,
  operations: ModificationOp[],
): RecipeDraft {
  const result = operations.reduce(applyOperation, baseRecipe);
  return recipeDraftSchema.parse(result);
}
