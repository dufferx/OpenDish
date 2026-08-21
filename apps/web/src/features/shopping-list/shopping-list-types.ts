import type { Quantity } from '@opendish/contracts';

/**
 * A shopping-list row as the UI understands it. Extra DB metadata
 * (source recipe, servings chosen at add time, manual ordering) is kept
 * alongside the contracts `ShoppingListItem` shape.
 */
export interface ShoppingListItem {
  id: string;
  name: string;
  quantity: Quantity | null;
  unit: string | null;
  isPurchased: boolean;
  sourceRecipeId: string | null;
  servingsUsed: number | null;
  position: number;
  sourceRecipeTitle: string | null;
}

/** Raw PostgREST row for `public.shopping_list_items`. */
export interface ShoppingListItemDbRow {
  id: string;
  user_id: string;
  name: string;
  quantity_num: number | null;
  quantity_den: number | null;
  unit: string | null;
  is_purchased: boolean;
  source_recipe_id: string | null;
  servings_used: number | null;
  position: number;
  created_at: string;
  updated_at: string;
}
