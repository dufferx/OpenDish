import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  validRecipeDraft,
  type ModificationOp,
  type RecipeDraft,
} from '@opendish/contracts';

import {
  restoreRecipeVersion,
  saveRecipe,
  type SaveRecipeInput,
} from '../../../domain/recipe-save.ts';
import {
  applyProposal,
  saveProposalAsVariant,
} from '../../modification-review/proposal-actions.ts';

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  'http://127.0.0.1:54421';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  '';

const describeIntegration = SERVICE_ROLE_KEY ? describe : describe.skip;
const AI_RESULT_TITLE = 'AI-updated tomato pasta';
const VARIANT_TITLE = 'Variant tomato pasta';
const VARIANT_EDITED_TITLE = 'Edited variant tomato pasta';

describeIntegration('recipe history lifecycle (local Supabase)', () => {
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
      supabase.from('recipe_history').select('id').limit(1),
      supabase.from('conversations').select('id').limit(1),
      supabase.from('conversation_messages').select('id').limit(1),
      supabase.from('modification_proposals').select('id').limit(1),
    ]);
    schemaReady = probes.every((probe) => !probe.error);
    if (!schemaReady) return;

    const { data, error } = await supabase.auth.admin.createUser({
      email: `recipe-history-${crypto.randomUUID()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    if (error || !data.user) {
      throw error ?? new Error('failed to create recipe history test user');
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

  function input(overrides: Partial<SaveRecipeInput> = {}): SaveRecipeInput {
    return {
      ...validRecipeDraft,
      recipeId: null,
      changeKind: 'manual_edit',
      userId,
      ...overrides,
    };
  }

  async function seedPendingProposal(options?: {
    title?: string;
    baseVersion?: number;
    operations?: ModificationOp[];
  }) {
    const title = options?.title ?? validRecipeDraft.title;
    const created = await saveRecipe(
      supabase,
      input({
        title,
      }),
    );
    createdRecipeIds.push(created.recipeId);

    const baseVersion = options?.baseVersion ?? created.headVersion;
    const operations = options?.operations ?? [
      { kind: 'setTitle', title: AI_RESULT_TITLE },
    ];

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
        content: 'Persisted proposal for history lifecycle coverage.',
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

    return {
      recipeId: created.recipeId,
      conversationId: conversation.id as string,
      messageId: message.id as string,
      proposalId: proposal.id as string,
      baseVersion,
    };
  }

  async function readHistory(recipeId: string) {
    const { data, error } = await supabase
      .from('recipe_history')
      .select('id, version, change_kind, snapshot')
      .eq('recipe_id', recipeId)
      .order('version');
    if (error) throw error;
    return data ?? [];
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

  it('records manual_edit, serving_adjustment, and restore history entries in order', async (ctx) => {
    requireSchema(ctx);
    const created = await saveRecipe(supabase, input());
    createdRecipeIds.push(created.recipeId);

    const manual = await saveRecipe(
      supabase,
      input({
        recipeId: created.recipeId,
        title: 'Manual title',
        changeKind: 'manual_edit',
      }),
    );
    expect(manual.headVersion).toBe(2);

    const serving = await saveRecipe(
      supabase,
      input({
        recipeId: created.recipeId,
        title: 'Manual title',
        servings: 4,
        changeKind: 'serving_adjustment',
      }),
    );
    expect(serving.headVersion).toBe(3);

    const historyBeforeRestore = await readHistory(created.recipeId);
    const originalHistoryId = historyBeforeRestore[0]?.id as string;

    const restored = await restoreRecipeVersion(
      supabase,
      created.recipeId,
      originalHistoryId,
    );
    expect(restored.headVersion).toBe(4);

    expect(await readRecipe(created.recipeId)).toMatchObject({
      id: created.recipeId,
      title: validRecipeDraft.title,
      servings: validRecipeDraft.servings,
      head_version: 4,
    });
    expect(await readHistory(created.recipeId)).toEqual([
      {
        id: historyBeforeRestore[0].id,
        version: 1,
        change_kind: 'manual_edit',
        snapshot: expect.objectContaining({
          title: validRecipeDraft.title,
          servings: validRecipeDraft.servings,
        }),
      },
      {
        id: historyBeforeRestore[1].id,
        version: 2,
        change_kind: 'serving_adjustment',
        snapshot: expect.objectContaining({
          title: 'Manual title',
          servings: validRecipeDraft.servings,
        }),
      },
      {
        id: expect.any(String),
        version: 3,
        change_kind: 'restore',
        snapshot: expect.objectContaining({
          title: 'Manual title',
          servings: 4,
        }),
      },
    ]);
  });

  it('records ai_applied history through proposal application', async (ctx) => {
    requireSchema(ctx);
    const resultingRecipe: RecipeDraft = {
      ...validRecipeDraft,
      title: AI_RESULT_TITLE,
    };
    const { recipeId, proposalId } = await seedPendingProposal();

    const applied = await applyProposal(supabase, {
      proposalId,
      resultingRecipe,
    });
    expect(applied).toEqual({ recipeId, headVersion: 2 });

    expect(await readRecipe(recipeId)).toMatchObject({
      id: recipeId,
      title: AI_RESULT_TITLE,
      head_version: 2,
    });
    expect(await readHistory(recipeId)).toEqual([
      {
        id: expect.any(String),
        version: 1,
        change_kind: 'ai_applied',
        snapshot: expect.objectContaining({
          title: validRecipeDraft.title,
          servings: validRecipeDraft.servings,
        }),
      },
    ]);
  });

  it('records variant_created history, supports independent edits, and detaches on source deletion while cascading source records', async (ctx) => {
    requireSchema(ctx);
    const resultingRecipe: RecipeDraft = {
      ...validRecipeDraft,
      title: VARIANT_TITLE,
    };
    const { recipeId: sourceRecipeId } = await seedPendingProposal({
      title: 'Source recipe',
      operations: [{ kind: 'setTitle', title: VARIANT_TITLE }],
    });

    const sourceEdited = await saveRecipe(
      supabase,
      input({
        recipeId: sourceRecipeId,
        title: 'Source recipe v2',
        changeKind: 'manual_edit',
      }),
    );
    expect(sourceEdited.headVersion).toBe(2);

    const { data: sourceConversation, error: sourceConversationError } =
      await supabase
        .from('conversations')
        .select('id')
        .eq('recipe_id', sourceRecipeId)
        .single();
    if (sourceConversationError) throw sourceConversationError;

    const { data: sourceMessage, error: sourceMessageError } = await supabase
      .from('conversation_messages')
      .select('id')
      .eq('conversation_id', sourceConversation.id)
      .single();
    if (sourceMessageError) throw sourceMessageError;

    const { data: sourceProposal, error: sourceProposalError } = await supabase
      .from('modification_proposals')
      .select('id')
      .eq('recipe_id', sourceRecipeId)
      .single();
    if (sourceProposalError) throw sourceProposalError;

    await supabase
      .from('modification_proposals')
      .update({ base_version: sourceEdited.headVersion })
      .eq('id', sourceProposal.id);

    const variant = await saveProposalAsVariant(supabase, {
      proposalId: sourceProposal.id as string,
      resultingRecipe,
    });
    createdRecipeIds.push(variant.recipeId);

    expect(variant.headVersion).toBe(2);
    expect(await readRecipe(variant.recipeId)).toMatchObject({
      id: variant.recipeId,
      title: VARIANT_TITLE,
      head_version: 2,
      source_recipe_id: sourceRecipeId,
    });
    expect(await readHistory(variant.recipeId)).toEqual([
      {
        id: expect.any(String),
        version: 1,
        change_kind: 'variant_created',
        snapshot: expect.objectContaining({
          title: VARIANT_TITLE,
          servings: validRecipeDraft.servings,
        }),
      },
    ]);

    const editedVariant = await saveRecipe(
      supabase,
      input({
        recipeId: variant.recipeId,
        title: VARIANT_EDITED_TITLE,
        changeKind: 'manual_edit',
        sourceRecipeId: null,
      }),
    );
    expect(editedVariant.headVersion).toBe(3);
    expect(await readHistory(variant.recipeId)).toEqual([
      {
        id: expect.any(String),
        version: 1,
        change_kind: 'variant_created',
        snapshot: expect.objectContaining({ title: VARIANT_TITLE }),
      },
      {
        id: expect.any(String),
        version: 2,
        change_kind: 'manual_edit',
        snapshot: expect.objectContaining({ title: VARIANT_TITLE }),
      },
    ]);

    const { error: deleteError } = await supabase
      .from('recipes')
      .delete()
      .eq('id', sourceRecipeId);
    expect(deleteError).toBeNull();

    expect(await readRecipe(variant.recipeId)).toEqual({
      id: variant.recipeId,
      title: VARIANT_EDITED_TITLE,
      servings: validRecipeDraft.servings,
      head_version: 3,
      source_recipe_id: null,
    });

    const { count: sourceHistoryCount } = await supabase
      .from('recipe_history')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', sourceRecipeId);
    expect(sourceHistoryCount).toBe(0);

    const { count: conversationCount } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('id', sourceConversation.id);
    expect(conversationCount).toBe(0);

    const { count: messageCount } = await supabase
      .from('conversation_messages')
      .select('id', { count: 'exact', head: true })
      .eq('id', sourceMessage.id);
    expect(messageCount).toBe(0);

    const { count: proposalCount } = await supabase
      .from('modification_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('id', sourceProposal.id);
    expect(proposalCount).toBe(0);
  });
});
