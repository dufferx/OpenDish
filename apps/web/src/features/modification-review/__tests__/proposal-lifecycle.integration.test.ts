/**
 * Integration contract for the proposal lifecycle against local Supabase.
 *
 * The implementation module intentionally does not exist when this tests-first
 * task lands. Its public API is expected to be:
 *
 * - discardProposal(client, { proposalId })
 *     -> Promise<{ proposalId: string; status: 'discarded' }>
 * - applyProposal(client, { proposalId, resultingRecipe })
 *     -> Promise<{ recipeId: string; headVersion: number }>
 * - saveProposalAsVariant(client, { proposalId, resultingRecipe })
 *     -> Promise<{ recipeId: string; headVersion: number }>
 *
 * Each action must load and transition the persisted proposal itself. Callers
 * do not supply trusted recipe ids, base versions, or statuses.
 *
 *   eval "$(pnpm supabase status -o env)"
 *   SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
 *     pnpm --filter @opendish/web exec vitest run \
 *       src/features/modification-review/__tests__/proposal-lifecycle.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  validRecipeDraft,
  type ModificationOp,
  type RecipeDraft,
} from '@opendish/contracts';

import { saveRecipe } from '../../../domain/recipe-save.ts';
import {
  applyProposal,
  discardProposal,
  saveProposalAsVariant,
} from '../proposal-actions.ts';

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  'http://127.0.0.1:54421';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  '';

const describeIntegration = SERVICE_ROLE_KEY ? describe : describe.skip;
const RESULT_TITLE = 'AI-updated tomato pasta';
const operations: ModificationOp[] = [
  { kind: 'setTitle', title: RESULT_TITLE },
];
const resultingRecipe: RecipeDraft = {
  ...validRecipeDraft,
  title: RESULT_TITLE,
};

describeIntegration('modification proposal lifecycle (local Supabase)', () => {
  let supabase: SupabaseClient;
  let userId: string;
  let schemaReady = false;
  const createdRecipeIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const probes = await Promise.all([
      supabase.from('recipes').select('id').limit(1),
      supabase.from('conversations').select('id').limit(1),
      supabase.from('modification_proposals').select('id').limit(1),
    ]);
    schemaReady = probes.every((probe) => !probe.error);
    if (!schemaReady) return;

    const { data, error } = await supabase.auth.admin.createUser({
      email: `proposal-lifecycle-${crypto.randomUUID()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    if (error || !data.user) {
      throw error ?? new Error('failed to create proposal lifecycle test user');
    }
    userId = data.user.id;
  });

  afterAll(async () => {
    if (!schemaReady) return;
    for (const recipeId of [...createdRecipeIds].reverse()) {
      await supabase.from('recipes').delete().eq('id', recipeId);
    }
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  function requireSchema(ctx: { skip: () => void }): void {
    if (!schemaReady) ctx.skip();
  }

  async function seedPendingProposal(baseVersion = 1) {
    const created = await saveRecipe(supabase, {
      ...validRecipeDraft,
      recipeId: null,
      changeKind: 'manual_edit',
      userId,
    });
    createdRecipeIds.push(created.recipeId);

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .insert({
        user_id: userId,
        recipe_id: created.recipeId,
        kind: 'recipe',
      })
      .select('id')
      .single();
    if (conversationError) throw conversationError;

    const { data: message, error: messageError } = await supabase
      .from('conversation_messages')
      .insert({
        conversation_id: conversation.id,
        position: 0,
        role: 'assistant',
        content: 'I can update the recipe title.',
      })
      .select('id')
      .single();
    if (messageError) throw messageError;

    const { data: proposal, error: proposalError } = await supabase
      .from('modification_proposals')
      .insert({
        conversation_id: conversation.id,
        message_id: message.id,
        recipe_id: created.recipeId,
        base_version: baseVersion,
        operations,
        status: 'pending',
      })
      .select('id')
      .single();
    if (proposalError) throw proposalError;

    return { recipeId: created.recipeId, proposalId: proposal.id };
  }

  async function readRecipe(recipeId: string) {
    const { data, error } = await supabase
      .from('recipes')
      .select('id, title, servings, head_version, source_recipe_id')
      .eq('id', recipeId)
      .single();
    if (error) throw error;
    return data;
  }

  async function readProposalStatus(proposalId: string) {
    const { data, error } = await supabase
      .from('modification_proposals')
      .select('status')
      .eq('id', proposalId)
      .single();
    if (error) throw error;
    return data.status as string;
  }

  it('transitions pending to discarded without changing the recipe', async (ctx) => {
    requireSchema(ctx);
    const { recipeId, proposalId } = await seedPendingProposal();
    const recipeBefore = await readRecipe(recipeId);

    await expect(discardProposal(supabase, { proposalId })).resolves.toEqual({
      proposalId,
      status: 'discarded',
    });

    expect(await readProposalStatus(proposalId)).toBe('discarded');
    expect(await readRecipe(recipeId)).toEqual(recipeBefore);
    const { count: historyCount } = await supabase
      .from('recipe_history')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', recipeId);
    expect(historyCount).toBe(0);

    await expect(discardProposal(supabase, { proposalId })).rejects.toThrow(
      /pending/i,
    );
    expect(await readProposalStatus(proposalId)).toBe('discarded');
  });

  it('applies a current proposal through ai_applied history and only once', async (ctx) => {
    requireSchema(ctx);
    const { recipeId, proposalId } = await seedPendingProposal();

    await expect(
      applyProposal(supabase, { proposalId, resultingRecipe }),
    ).resolves.toEqual({ recipeId, headVersion: 2 });

    expect(await readProposalStatus(proposalId)).toBe('applied');
    expect(await readRecipe(recipeId)).toMatchObject({
      id: recipeId,
      title: RESULT_TITLE,
      servings: validRecipeDraft.servings,
      head_version: 2,
      source_recipe_id: null,
    });

    const { data: history, error: historyError } = await supabase
      .from('recipe_history')
      .select('version, change_kind, snapshot')
      .eq('recipe_id', recipeId)
      .single();
    expect(historyError).toBeNull();
    expect(history).toMatchObject({
      version: 1,
      change_kind: 'ai_applied',
      snapshot: {
        title: validRecipeDraft.title,
        servings: validRecipeDraft.servings,
        ingredients: validRecipeDraft.ingredients,
        steps: validRecipeDraft.steps,
        tags: validRecipeDraft.tags,
      },
    });

    await expect(
      applyProposal(supabase, { proposalId, resultingRecipe }),
    ).rejects.toThrow(/pending/i);
    const { count: historyCount } = await supabase
      .from('recipe_history')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', recipeId);
    expect(historyCount).toBe(1);
  });

  it('rejects caller content that does not match persisted operations', async (ctx) => {
    requireSchema(ctx);
    const { recipeId, proposalId } = await seedPendingProposal();
    const recipeBefore = await readRecipe(recipeId);
    const callerSuppliedRecipe: RecipeDraft = {
      ...resultingRecipe,
      title: 'Caller-supplied content unrelated to the proposal',
    };

    await expect(
      applyProposal(supabase, {
        proposalId,
        resultingRecipe: callerSuppliedRecipe,
      }),
    ).rejects.toThrow(/does not match persisted operations/i);

    expect(await readProposalStatus(proposalId)).toBe('pending');
    expect(await readRecipe(recipeId)).toEqual(recipeBefore);
    const { count: historyCount } = await supabase
      .from('recipe_history')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', recipeId);
    expect(historyCount).toBe(0);
  });

  it('rejects a stale base_version without mutating recipe or proposal', async (ctx) => {
    requireSchema(ctx);
    const { recipeId, proposalId } = await seedPendingProposal();

    await saveRecipe(supabase, {
      ...validRecipeDraft,
      title: 'Manual edit after proposal',
      recipeId,
      changeKind: 'manual_edit',
      userId,
    });
    const recipeBeforeApply = await readRecipe(recipeId);

    await expect(
      applyProposal(supabase, { proposalId, resultingRecipe }),
    ).rejects.toThrow(/stale|modified|version/i);

    expect(await readProposalStatus(proposalId)).toBe('pending');
    expect(await readRecipe(recipeId)).toEqual(recipeBeforeApply);
    const { data: history, error: historyError } = await supabase
      .from('recipe_history')
      .select('version, change_kind')
      .eq('recipe_id', recipeId);
    expect(historyError).toBeNull();
    expect(history).toEqual([{ version: 1, change_kind: 'manual_edit' }]);
  });

  it('creates a linked variant and leaves the source recipe intact', async (ctx) => {
    requireSchema(ctx);
    const { recipeId: sourceRecipeId, proposalId } =
      await seedPendingProposal();
    const sourceBefore = await readRecipe(sourceRecipeId);

    const variant = await saveProposalAsVariant(supabase, {
      proposalId,
      resultingRecipe,
    });
    createdRecipeIds.push(variant.recipeId);

    expect(variant).toMatchObject({ headVersion: 2 });
    expect(variant.recipeId).not.toBe(sourceRecipeId);
    expect(await readProposalStatus(proposalId)).toBe('variant_created');
    expect(await readRecipe(sourceRecipeId)).toEqual(sourceBefore);
    expect(await readRecipe(variant.recipeId)).toMatchObject({
      id: variant.recipeId,
      title: RESULT_TITLE,
      servings: resultingRecipe.servings,
      head_version: 2,
      source_recipe_id: sourceRecipeId,
    });

    const { data: variantIngredients, error: ingredientsError } = await supabase
      .from('recipe_ingredients')
      .select('position, name, quantity_num, quantity_den, unit')
      .eq('recipe_id', variant.recipeId)
      .order('position');
    expect(ingredientsError).toBeNull();
    expect(variantIngredients).toEqual(
      resultingRecipe.ingredients.map((ingredient, position) => ({
        position,
        name: ingredient.name,
        quantity_num: ingredient.quantity?.num ?? null,
        quantity_den: ingredient.quantity?.den ?? null,
        unit: ingredient.unit,
      })),
    );
  });
});
