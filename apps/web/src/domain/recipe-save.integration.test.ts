/**
 * Integration tests for the recipe save path against the LOCAL Supabase
 * stack. They run only when a service-role key is available:
 *
 *   SUPABASE_URL=http://127.0.0.1:54421 \
 *   SUPABASE_SERVICE_ROLE_KEY=$(pnpm supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2 | tr -d '"') \
 *   pnpm --filter @opendish/web test
 *
 * The service role bypasses RLS for test setup; a real `auth.users` row is
 * created (and deleted) per run so FK and ownership semantics hold. When the
 * stack or the migrations are not up yet, every test skips itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validRecipeDraft } from '@opendish/contracts';
import {
  restoreRecipeVersion,
  saveRecipe,
  type SaveRecipeInput,
} from './recipe-save.ts';

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  'http://127.0.0.1:54421';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  '';

const describeIntegration = SERVICE_ROLE_KEY ? describe : describe.skip;

describeIntegration('recipe save path (local Supabase)', () => {
  let supabase: SupabaseClient;
  let userId: string;
  let schemaReady = false;
  const createdRecipeIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Probe: migrations applied?
    const probe = await supabase.from('recipes').select('id').limit(1);
    schemaReady = !probe.error;
    if (!schemaReady) return;
    const { data, error } = await supabase.auth.admin.createUser({
      email: `recipe-save-test-${crypto.randomUUID()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    if (error || !data.user)
      throw error ?? new Error('failed to create test user');
    userId = data.user.id;
  });

  afterAll(async () => {
    if (!schemaReady) return;
    for (const id of createdRecipeIds) {
      await supabase.from('recipes').delete().eq('id', id);
    }
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  function requireSchema(ctx: { skip: () => void }): void {
    if (!schemaReady) ctx.skip();
  }

  function input(overrides: Partial<SaveRecipeInput> = {}): SaveRecipeInput {
    return {
      ...validRecipeDraft,
      recipeId: null,
      changeKind: 'manual_edit',
      userId,
      ...overrides,
    };
  }

  it('creates a recipe at head_version 1 with ingredients, steps, tags and no history', async (ctx) => {
    requireSchema(ctx);
    const { recipeId, headVersion } = await saveRecipe(supabase, input());
    createdRecipeIds.push(recipeId);
    expect(headVersion).toBe(1);

    const { data: recipe } = await supabase
      .from('recipes')
      .select('*')
      .eq('id', recipeId)
      .single();
    expect(recipe).toMatchObject({
      title: validRecipeDraft.title,
      servings: validRecipeDraft.servings,
      user_id: userId,
      head_version: 1,
    });

    const { data: ings } = await supabase
      .from('recipe_ingredients')
      .select('*')
      .eq('recipe_id', recipeId)
      .order('position');
    expect(
      ings?.map((i) => [i.position, i.name, i.quantity_num, i.quantity_den]),
    ).toEqual([
      [0, 'Spaghetti', 1, 2],
      [1, 'Canned tomatoes', 3, 2],
      [2, 'Salt', null, null],
    ]);

    const { data: steps } = await supabase
      .from('recipe_steps')
      .select('position')
      .eq('recipe_id', recipeId);
    expect(steps).toHaveLength(3);

    const { data: tagLinks } = await supabase
      .from('recipe_tags')
      .select('tag_id')
      .eq('recipe_id', recipeId);
    expect(tagLinks).toHaveLength(2);

    const { data: history } = await supabase
      .from('recipe_history')
      .select('id')
      .eq('recipe_id', recipeId);
    expect(history).toHaveLength(0);
  });

  it('update snapshots the previous state with change_kind and increments head_version', async (ctx) => {
    requireSchema(ctx);
    const { recipeId } = await saveRecipe(supabase, input());
    createdRecipeIds.push(recipeId);

    const result = await saveRecipe(
      supabase,
      input({ recipeId, title: 'Renamed Pasta', changeKind: 'manual_edit' }),
    );
    expect(result.headVersion).toBe(2);

    const { data: recipe } = await supabase
      .from('recipes')
      .select('title, head_version')
      .eq('id', recipeId)
      .single();
    expect(recipe).toMatchObject({ title: 'Renamed Pasta', head_version: 2 });

    const { data: history } = await supabase
      .from('recipe_history')
      .select('*')
      .eq('recipe_id', recipeId);
    expect(history).toHaveLength(1);
    expect(history?.[0]).toMatchObject({
      version: 1,
      change_kind: 'manual_edit',
    });
    expect(history?.[0].snapshot).toMatchObject({
      title: validRecipeDraft.title,
      servings: validRecipeDraft.servings,
      ingredients: validRecipeDraft.ingredients,
      steps: validRecipeDraft.steps,
      tags: validRecipeDraft.tags,
    });
  });

  it('records change_kind values like serving_adjustment', async (ctx) => {
    requireSchema(ctx);
    const { recipeId } = await saveRecipe(supabase, input());
    createdRecipeIds.push(recipeId);
    await saveRecipe(
      supabase,
      input({ recipeId, servings: 4, changeKind: 'serving_adjustment' }),
    );
    const { data: history } = await supabase
      .from('recipe_history')
      .select('change_kind')
      .eq('recipe_id', recipeId);
    expect(history?.map((h) => h.change_kind)).toEqual(['serving_adjustment']);
  });

  it('restoreRecipeVersion writes the snapshot as current state and adds a restore entry', async (ctx) => {
    requireSchema(ctx);
    const { recipeId } = await saveRecipe(supabase, input());
    createdRecipeIds.push(recipeId);
    await saveRecipe(supabase, input({ recipeId, title: 'v2' }));

    const { data: entries } = await supabase
      .from('recipe_history')
      .select('id')
      .eq('recipe_id', recipeId)
      .eq('version', 1);
    const historyId = entries![0].id as string;

    const result = await restoreRecipeVersion(supabase, recipeId, historyId);
    expect(result.headVersion).toBe(3);

    const { data: recipe } = await supabase
      .from('recipes')
      .select('title, servings, head_version')
      .eq('id', recipeId)
      .single();
    expect(recipe).toMatchObject({
      title: validRecipeDraft.title,
      servings: validRecipeDraft.servings,
      head_version: 3,
    });

    const { data: history } = await supabase
      .from('recipe_history')
      .select('version, change_kind')
      .eq('recipe_id', recipeId)
      .order('version');
    expect(history).toEqual([
      { version: 1, change_kind: 'manual_edit' },
      { version: 2, change_kind: 'restore' },
    ]);
  });

  it('temporary (non-save) reads create nothing', async (ctx) => {
    requireSchema(ctx);
    const { recipeId } = await saveRecipe(supabase, input());
    createdRecipeIds.push(recipeId);

    await supabase.from('recipes').select('*').eq('id', recipeId);
    await supabase.from('recipe_history').select('*').eq('recipe_id', recipeId);

    const { data: history } = await supabase
      .from('recipe_history')
      .select('id')
      .eq('recipe_id', recipeId);
    expect(history).toHaveLength(0);
    const { data: recipe } = await supabase
      .from('recipes')
      .select('head_version')
      .eq('id', recipeId)
      .single();
    expect(recipe?.head_version).toBe(1);
  });

  it('rejects invalid drafts without writing anything', async (ctx) => {
    requireSchema(ctx);
    await expect(saveRecipe(supabase, input({ title: '' }))).rejects.toThrow();
    const { data } = await supabase
      .from('recipes')
      .select('id')
      .eq('user_id', userId);
    expect(data).toHaveLength(createdRecipeIds.length);
  });
});
