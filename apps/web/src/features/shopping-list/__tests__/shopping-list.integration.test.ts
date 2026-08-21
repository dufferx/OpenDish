/**
 * Integration tests for the shopping list against the LOCAL Supabase stack.
 * They run only when a service-role key is available:
 *
 *   SUPABASE_URL=http://127.0.0.1:54421 \
 *   SUPABASE_SERVICE_ROLE_KEY=$(pnpm supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2 | tr -d '"') \
 *   pnpm --filter @opendish/web test
 *
 * The service role bypasses RLS for test setup; a real `auth.users` row is
 * created (and deleted) per run so FK and ownership semantics hold.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { makeQuantity } from '@opendish/contracts';

import { saveRecipe } from '@/domain/recipe-save.ts';
import type { RecipeDetail } from '@/features/recipes/recipe-queries.ts';

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

import { addRecipeToShoppingList } from '@/features/shopping-list/shopping-list-queries.ts';

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  'http://127.0.0.1:54421';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  '';

const describeIntegration = SERVICE_ROLE_KEY ? describe : describe.skip;

describeIntegration('shopping list (local Supabase)', () => {
  let supabase: SupabaseClient;
  let userId: string;
  let schemaReady = false;
  const createdRecipeIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const probe = await supabase
      .from('shopping_list_items')
      .select('id')
      .limit(1);
    schemaReady = !probe.error;
    if (!schemaReady) return;

    const { data, error } = await supabase.auth.admin.createUser({
      email: `shopping-list-test-${crypto.randomUUID()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    if (error || !data.user) {
      throw error ?? new Error('failed to create test user');
    }
    userId = data.user.id;
  });

  beforeEach(async () => {
    if (!schemaReady) return;
    const { error } = await supabase
      .from('shopping_list_items')
      .delete()
      .eq('user_id', userId);
    expect(error).toBeNull();
  });

  afterAll(async () => {
    if (!schemaReady) return;
    await supabase.from('shopping_list_items').delete().eq('user_id', userId);
    for (const recipeId of createdRecipeIds) {
      await supabase.from('recipes').delete().eq('id', recipeId);
    }
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  function requireSchema(ctx: { skip: () => void }): void {
    if (!schemaReady) ctx.skip();
  }

  async function createRecipe(
    draft: Omit<RecipeDetail, 'id'>,
  ): Promise<RecipeDetail> {
    const result = await saveRecipe(supabase, {
      ...draft,
      recipeId: null,
      changeKind: 'manual_edit',
      userId,
      origin: draft.origin as 'manual' | 'imported' | 'ai_generated',
    });
    createdRecipeIds.push(result.recipeId);
    return { ...draft, id: result.recipeId };
  }

  async function listRowsForUser() {
    const { data, error } = await supabase
      .from('shopping_list_items')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true });
    expect(error).toBeNull();
    return (data ?? []) as {
      id: string;
      name: string;
      quantity_num: number | null;
      quantity_den: number | null;
      unit: string | null;
      is_purchased: boolean;
      source_recipe_id: string | null;
      servings_used: number | null;
      position: number;
    }[];
  }

  describe('T062: add recipe at servings with conservative merge', () => {
    it('writes correctly scaled quantities for the chosen servings', async (ctx) => {
      requireSchema(ctx);

      const recipe = await createRecipe({
        title: 'Scaling Test',
        description: null,
        servings: 4,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        sourceName: null,
        sourceUrl: null,
        isFavorite: false,
        imagePath: null,
        origin: 'manual',
        headVersion: 1,
        ingredients: [
          { name: 'Flour', quantity: makeQuantity(2, 1), unit: 'cups' },
          { name: 'Salt', quantity: null, unit: null },
        ],
        steps: [{ text: 'Mix.' }],
        tags: [],
      });

      await addRecipeToShoppingList(supabase, recipe, 2, userId);

      const rows = await listRowsForUser();
      expect(rows).toHaveLength(2);

      const flour = rows.find((r) => r.name === 'Flour');
      const salt = rows.find((r) => r.name === 'Salt');

      expect(flour).toMatchObject({
        quantity_num: 1,
        quantity_den: 1,
        unit: 'cups',
        source_recipe_id: recipe.id,
        servings_used: 2,
        is_purchased: false,
      });
      expect(salt).toMatchObject({
        quantity_num: null,
        quantity_den: null,
        unit: null,
        source_recipe_id: recipe.id,
        servings_used: 2,
      });
    });

    it('merges equal name + compatible unit by summing rationals', async (ctx) => {
      requireSchema(ctx);

      const recipeA = await createRecipe({
        title: 'Recipe A',
        description: null,
        servings: 2,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        sourceName: null,
        sourceUrl: null,
        isFavorite: false,
        imagePath: null,
        origin: 'manual',
        headVersion: 1,
        ingredients: [
          { name: 'Flour', quantity: makeQuantity(1, 1), unit: 'g' },
          { name: 'Sugar', quantity: makeQuantity(2, 1), unit: 'tbsp' },
        ],
        steps: [{ text: 'A' }],
        tags: [],
      });

      const recipeB = await createRecipe({
        title: 'Recipe B',
        description: null,
        servings: 4,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        sourceName: null,
        sourceUrl: null,
        isFavorite: false,
        imagePath: null,
        origin: 'manual',
        headVersion: 1,
        ingredients: [
          { name: 'Flour', quantity: makeQuantity(1, 2), unit: 'grams' },
          { name: 'Sugar', quantity: makeQuantity(1, 1), unit: 'tablespoons' },
        ],
        steps: [{ text: 'B' }],
        tags: [],
      });

      await addRecipeToShoppingList(supabase, recipeA, 2, userId);
      await addRecipeToShoppingList(supabase, recipeB, 4, userId);

      const rows = await listRowsForUser();
      expect(rows).toHaveLength(2);

      const flour = rows.find((r) => r.name === 'Flour');
      expect(flour).toMatchObject({
        quantity_num: 3,
        quantity_den: 2,
        unit: 'g',
        source_recipe_id: recipeB.id,
        servings_used: 4,
      });

      const sugar = rows.find((r) => r.name === 'Sugar');
      expect(sugar).toMatchObject({
        quantity_num: 3,
        quantity_den: 1,
        unit: 'tbsp',
        source_recipe_id: recipeB.id,
        servings_used: 4,
      });
    });

    it('keeps mismatched units and quantity-less items separate', async (ctx) => {
      requireSchema(ctx);

      const recipe = await createRecipe({
        title: 'Mismatched Units',
        description: null,
        servings: 2,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        sourceName: null,
        sourceUrl: null,
        isFavorite: false,
        imagePath: null,
        origin: 'manual',
        headVersion: 1,
        ingredients: [
          { name: 'Flour', quantity: makeQuantity(1, 1), unit: 'cup' },
          { name: 'Flour', quantity: makeQuantity(200, 1), unit: 'g' },
          { name: 'Salt', quantity: null, unit: null },
        ],
        steps: [{ text: 'Mix.' }],
        tags: [],
      });

      await addRecipeToShoppingList(supabase, recipe, 2, userId);

      const rows = await listRowsForUser();
      expect(rows).toHaveLength(3);

      const names = rows.map((r) => r.name);
      expect(names.filter((n) => n === 'Flour')).toHaveLength(2);
      expect(
        rows.some((r) => r.name === 'Salt' && r.quantity_num === null),
      ).toBe(true);
    });
  });

  describe('T063: item CRUD, purchased toggle, and provenance', () => {
    it('persists manual CRUD and purchased toggle', async (ctx) => {
      requireSchema(ctx);

      const { data: inserted, error: insertError } = await supabase
        .from('shopping_list_items')
        .insert({
          user_id: userId,
          name: 'Eggs',
          quantity_num: 6,
          quantity_den: 1,
          unit: null,
          is_purchased: false,
          source_recipe_id: null,
          servings_used: null,
          position: 0,
        })
        .select('*');
      expect(insertError).toBeNull();
      const id = (inserted as { id: string }[])[0].id;

      const { error: updateError } = await supabase
        .from('shopping_list_items')
        .update({ name: 'Large eggs', quantity_num: 12, quantity_den: 1 })
        .eq('id', id);
      expect(updateError).toBeNull();

      const { error: toggleError } = await supabase
        .from('shopping_list_items')
        .update({ is_purchased: true })
        .eq('id', id);
      expect(toggleError).toBeNull();

      const rows = await listRowsForUser();
      const row = rows.find((r) => r.id === id);
      expect(row).toMatchObject({
        name: 'Large eggs',
        quantity_num: 12,
        quantity_den: 1,
        is_purchased: true,
      });

      const { error: deleteError } = await supabase
        .from('shopping_list_items')
        .delete()
        .eq('id', id);
      expect(deleteError).toBeNull();

      const afterDelete = await listRowsForUser();
      expect(afterDelete.find((r) => r.id === id)).toBeUndefined();
    });

    it('keeps items when their source recipe is deleted, clearing source_recipe_id', async (ctx) => {
      requireSchema(ctx);

      const recipe = await createRecipe({
        title: 'Soon Deleted',
        description: null,
        servings: 2,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        sourceName: null,
        sourceUrl: null,
        isFavorite: false,
        imagePath: null,
        origin: 'manual',
        headVersion: 1,
        ingredients: [
          { name: 'Butter', quantity: makeQuantity(1, 2), unit: 'cup' },
        ],
        steps: [{ text: 'Melt.' }],
        tags: [],
      });

      await addRecipeToShoppingList(supabase, recipe, 2, userId);

      let rows = await listRowsForUser();
      expect(rows.some((r) => r.source_recipe_id === recipe.id)).toBe(true);

      const { error: deleteRecipeError } = await supabase
        .from('recipes')
        .delete()
        .eq('id', recipe.id);
      expect(deleteRecipeError).toBeNull();

      rows = await listRowsForUser();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'Butter',
        source_recipe_id: null,
      });

      // The orphaned item remains editable.
      const { error: updateError } = await supabase
        .from('shopping_list_items')
        .update({ quantity_num: 1, quantity_den: 1 })
        .eq('id', rows[0].id);
      expect(updateError).toBeNull();
    });
  });
});
