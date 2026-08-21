import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { makeQuantity, type Quantity } from '@opendish/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { mergeItems, normalizeName, normalizeUnit } from '@/domain/shopping.ts';
import { MAX_SERVINGS, scaleIngredients } from '@/domain/scaling.ts';
import { parseQuantityInput } from '@/domain/rational.ts';
import { toast } from 'sonner';

import { useAuth } from '@/features/auth/auth-context';
import type { RecipeDetail } from '@/features/recipes/recipe-queries.ts';

import type {
  ShoppingListItem,
  ShoppingListItemDbRow,
} from './shopping-list-types.ts';

const LIST_QUERY_KEY = ['shopping-list'] as const;

function rowToQuantity(
  num: number | null,
  den: number | null,
): Quantity | null {
  if (num === null || den === null) return null;
  return makeQuantity(num, den);
}

function quantityToRow(
  quantity: Quantity | null,
): Pick<ShoppingListItemDbRow, 'quantity_num' | 'quantity_den'> {
  return {
    quantity_num: quantity?.num ?? null,
    quantity_den: quantity?.den ?? null,
  };
}

function rowToItem(row: ShoppingListItemDbRow): ShoppingListItem {
  return {
    id: row.id,
    name: row.name,
    quantity: rowToQuantity(row.quantity_num, row.quantity_den),
    unit: row.unit,
    isPurchased: row.is_purchased,
    sourceRecipeId: row.source_recipe_id,
    servingsUsed: row.servings_used,
    position: row.position,
    sourceRecipeTitle: null,
  };
}

function mergeKey(
  name: string,
  quantity: Quantity | null,
  unit: string | null,
): string | null {
  if (quantity === null) return null;
  return `${normalizeName(name)}\x00${normalizeUnit(unit) ?? ''}`;
}

function assertServings(value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_SERVINGS) {
    throw new Error(
      `Servings must be an integer between 1 and ${MAX_SERVINGS}.`,
    );
  }
}

export interface AddRecipeResult {
  newCount: number;
  mergedCount: number;
}

/**
 * Scale a recipe's ingredients to the chosen servings and merge them into the
 * current shopping list. Existing rows are updated when a conservative match
 * is found; new rows are appended. Source recipe and chosen servings are
 * recorded on every row touched by this add (research R9, FR-027).
 */
export async function addRecipeToShoppingList(
  client: SupabaseClient,
  recipe: RecipeDetail,
  servings: number,
  userId: string,
): Promise<AddRecipeResult> {
  assertServings(servings);

  const scaled = scaleIngredients(
    recipe.ingredients,
    recipe.servings,
    servings,
  );
  const incoming = scaled.map((ingredient) => ({
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    isPurchased: false,
  }));

  const { data: existingRows, error: fetchError } = await client
    .from('shopping_list_items')
    .select('*')
    .order('position', { ascending: true });
  if (fetchError) throw new Error(fetchError.message);

  const existing = (existingRows ?? []) as ShoppingListItemDbRow[];
  const existingItems = existing.map((row) => rowToItem(row));

  const merged = mergeItems(
    existingItems.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      isPurchased: item.isPurchased,
    })),
    incoming,
  );

  // Determine which existing rows were matched by an incoming item.
  const matchedKeys = new Set<string>();
  for (const candidate of incoming) {
    const key = mergeKey(candidate.name, candidate.quantity, candidate.unit);
    if (key !== null) matchedKeys.add(key);
  }

  const updates: { id: string; quantity: Quantity | null }[] = [];
  for (let i = 0; i < existing.length; i++) {
    const row = existing[i];
    const key = mergeKey(
      row.name,
      rowToQuantity(row.quantity_num, row.quantity_den),
      row.unit,
    );
    if (key !== null && matchedKeys.has(key)) {
      updates.push({ id: row.id, quantity: merged[i].quantity });
    }
  }

  let nextPosition =
    existing.length === 0
      ? 0
      : Math.max(...existing.map((row) => row.position)) + 1;

  const inserts = [];
  for (let i = existing.length; i < merged.length; i++) {
    const item = merged[i];
    inserts.push({
      user_id: userId,
      name: item.name,
      ...quantityToRow(item.quantity),
      unit: item.unit,
      is_purchased: item.isPurchased,
      source_recipe_id: recipe.id,
      servings_used: servings,
      position: nextPosition++,
    });
  }

  await Promise.all(
    updates.map(({ id, quantity }) =>
      client
        .from('shopping_list_items')
        .update({
          ...quantityToRow(quantity),
          source_recipe_id: recipe.id,
          servings_used: servings,
        })
        .eq('id', id),
    ),
  );

  if (inserts.length > 0) {
    const { error: insertError } = await client
      .from('shopping_list_items')
      .insert(inserts);
    if (insertError) throw new Error(insertError.message);
  }

  return {
    newCount: inserts.length,
    mergedCount: updates.length,
  };
}

export function useShoppingListItems() {
  return useQuery({
    queryKey: LIST_QUERY_KEY,
    queryFn: async (): Promise<ShoppingListItem[]> => {
      const { data: rows, error } = await supabase
        .from('shopping_list_items')
        .select('*')
        .order('position', { ascending: true });
      if (error) throw new Error(error.message);

      const items = ((rows ?? []) as ShoppingListItemDbRow[]).map(rowToItem);
      const sourceIds = [
        ...new Set(
          items
            .map((item) => item.sourceRecipeId)
            .filter((id): id is string => id !== null),
        ),
      ];

      let titles = new Map<string, string>();
      if (sourceIds.length > 0) {
        const { data: recipes, error: recipesError } = await supabase
          .from('recipes')
          .select('id, title')
          .in('id', sourceIds);
        if (recipesError) throw new Error(recipesError.message);
        titles = new Map(
          ((recipes ?? []) as { id: string; title: string }[]).map((r) => [
            r.id,
            r.title,
          ]),
        );
      }

      return items.map((item) => ({
        ...item,
        sourceRecipeTitle: item.sourceRecipeId
          ? (titles.get(item.sourceRecipeId) ?? null)
          : null,
      }));
    },
    staleTime: 30_000,
  });
}

export function useShoppingListActions() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const userId = auth.status === 'authenticated' ? auth.session.user.id : null;

  const togglePurchased = useMutation({
    mutationFn: async ({
      id,
      isPurchased,
    }: {
      id: string;
      isPurchased: boolean;
    }) => {
      const { error } = await supabase
        .from('shopping_list_items')
        .update({ is_purchased: isPurchased })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not update the item.');
    },
  });

  const updateItem = useMutation({
    mutationFn: async (item: ShoppingListItem) => {
      const { error } = await supabase
        .from('shopping_list_items')
        .update({
          name: item.name,
          ...quantityToRow(item.quantity),
          unit: item.unit,
        })
        .eq('id', item.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
      toast.success('Item updated.');
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not update the item.');
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('shopping_list_items')
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
      toast.success('Item deleted.');
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not delete the item.');
    },
  });

  const addManualItem = useMutation({
    mutationFn: async ({
      name,
      quantityText,
      unit,
    }: {
      name: string;
      quantityText: string;
      unit: string;
    }) => {
      if (userId === null) throw new Error('Not authenticated.');
      const trimmedName = name.trim();
      if (trimmedName === '') throw new Error('Item name is required.');

      const quantity =
        quantityText.trim() === '' ? null : parseQuantityInput(quantityText);
      if (quantityText.trim() !== '' && quantity === null) {
        throw new Error(`"${quantityText}" is not a valid quantity.`);
      }

      const { data: lastRow, error: positionError } = await supabase
        .from('shopping_list_items')
        .select('position')
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (positionError) throw new Error(positionError.message);

      const nextPosition =
        lastRow === null ? 0 : (lastRow as { position: number }).position + 1;

      const { error } = await supabase.from('shopping_list_items').insert({
        user_id: userId,
        name: trimmedName,
        ...quantityToRow(quantity),
        unit: unit.trim() || null,
        is_purchased: false,
        source_recipe_id: null,
        servings_used: null,
        position: nextPosition,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
      toast.success('Item added.');
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not add the item.');
    },
  });

  const addRecipe = useMutation({
    mutationFn: async ({
      recipe,
      servings,
    }: {
      recipe: RecipeDetail;
      servings: number;
    }) => {
      if (userId === null) throw new Error('Not authenticated.');
      return addRecipeToShoppingList(supabase, recipe, servings, userId);
    },
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
      const summary =
        result.mergedCount > 0
          ? `${result.newCount} new, ${result.mergedCount} merged`
          : `${result.newCount} new`;
      toast.success(
        `Added ${variables.recipe.title} for ${variables.servings} servings (${summary}).`,
      );
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not add recipe to shopping list.');
    },
  });

  return {
    togglePurchased: togglePurchased.mutateAsync,
    updateItem: updateItem.mutateAsync,
    deleteItem: deleteItem.mutateAsync,
    addManualItem: addManualItem.mutateAsync,
    addRecipe: addRecipe.mutateAsync,
    isToggling: togglePurchased.isPending,
    isUpdating: updateItem.isPending,
    isDeleting: deleteItem.isPending,
    isAddingManual: addManualItem.isPending,
    isAddingRecipe: addRecipe.isPending,
  };
}
