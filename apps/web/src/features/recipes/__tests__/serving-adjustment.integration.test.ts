/**
 * Integration coverage for the serving-adjustment boundary against the local
 * Supabase stack. A temporary scale is a pure view transformation; only the
 * explicit save is allowed to persist it and append recipe history.
 *
 *   SUPABASE_URL=http://127.0.0.1:54421 \
 *   SUPABASE_SERVICE_ROLE_KEY=$(pnpm supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2 | tr -d '"') \
 *   pnpm --filter @opendish/web test -- serving-adjustment.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validRecipeDraft } from '@opendish/contracts';
import { saveRecipe } from '../../../domain/recipe-save.ts';
import { scaledRecipe } from '../../../domain/scaling.ts';

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  'http://127.0.0.1:54421';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  '';

const describeIntegration = SERVICE_ROLE_KEY ? describe : describe.skip;

describeIntegration('serving adjustment persistence (local Supabase)', () => {
  let supabase: SupabaseClient;
  let userId: string;
  let schemaReady = false;
  const createdRecipeIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const probe = await supabase.from('recipes').select('id').limit(1);
    schemaReady = !probe.error;
    if (!schemaReady) return;

    const { data, error } = await supabase.auth.admin.createUser({
      email: `serving-adjustment-test-${crypto.randomUUID()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    if (error || !data.user) {
      throw error ?? new Error('failed to create test user');
    }
    userId = data.user.id;
  });

  afterAll(async () => {
    if (!schemaReady) return;
    for (const recipeId of createdRecipeIds) {
      await supabase.from('recipes').delete().eq('id', recipeId);
    }
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  it('keeps temporary scaling local and persists only an explicit serving-adjustment save', async (ctx) => {
    if (!schemaReady) ctx.skip();

    const created = await saveRecipe(supabase, {
      ...validRecipeDraft,
      recipeId: null,
      changeKind: 'manual_edit',
      userId,
    });
    createdRecipeIds.push(created.recipeId);

    const scaled = scaledRecipe(validRecipeDraft, 4);

    const { data: temporaryRecipe, error: temporaryRecipeError } =
      await supabase
        .from('recipes')
        .select('servings, head_version')
        .eq('id', created.recipeId)
        .single();
    expect(temporaryRecipeError).toBeNull();
    expect(temporaryRecipe).toEqual({ servings: 2, head_version: 1 });

    const { data: temporaryIngredients, error: temporaryIngredientsError } =
      await supabase
        .from('recipe_ingredients')
        .select('position, quantity_num, quantity_den')
        .eq('recipe_id', created.recipeId)
        .order('position');
    expect(temporaryIngredientsError).toBeNull();
    expect(temporaryIngredients).toEqual([
      { position: 0, quantity_num: 1, quantity_den: 2 },
      { position: 1, quantity_num: 3, quantity_den: 2 },
      { position: 2, quantity_num: null, quantity_den: null },
    ]);

    const { data: temporaryHistory, error: temporaryHistoryError } =
      await supabase
        .from('recipe_history')
        .select('id')
        .eq('recipe_id', created.recipeId);
    expect(temporaryHistoryError).toBeNull();
    expect(temporaryHistory).toHaveLength(0);

    const saved = await saveRecipe(supabase, {
      ...scaled,
      recipeId: created.recipeId,
      changeKind: 'serving_adjustment',
      userId,
    });
    expect(saved.headVersion).toBe(2);

    const { data: persistedRecipe, error: persistedRecipeError } =
      await supabase
        .from('recipes')
        .select('servings, head_version')
        .eq('id', created.recipeId)
        .single();
    expect(persistedRecipeError).toBeNull();
    expect(persistedRecipe).toEqual({ servings: 4, head_version: 2 });

    const { data: persistedIngredients, error: persistedIngredientsError } =
      await supabase
        .from('recipe_ingredients')
        .select('position, quantity_num, quantity_den')
        .eq('recipe_id', created.recipeId)
        .order('position');
    expect(persistedIngredientsError).toBeNull();
    expect(persistedIngredients).toEqual([
      { position: 0, quantity_num: 1, quantity_den: 1 },
      { position: 1, quantity_num: 3, quantity_den: 1 },
      { position: 2, quantity_num: null, quantity_den: null },
    ]);

    const { data: history, error: historyError } = await supabase
      .from('recipe_history')
      .select('version, change_kind, snapshot')
      .eq('recipe_id', created.recipeId)
      .single();
    expect(historyError).toBeNull();
    expect(history).toMatchObject({
      version: 1,
      change_kind: 'serving_adjustment',
      snapshot: {
        servings: validRecipeDraft.servings,
        ingredients: validRecipeDraft.ingredients,
      },
    });
  });
});
