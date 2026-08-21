import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  makeQuantity,
  recipeSnapshotSchema,
  type ConversationMessage,
  type RecipeSnapshot,
} from '../../../packages/contracts/src/index.ts';
import type {
  RecipeConversationStore,
  StoredConversationMessage,
} from './handler.ts';

function fail(operation: string): never {
  throw new Error(`recipe conversation store failed: ${operation}`);
}

export function createSupabaseRecipeConversationStore(
  client: SupabaseClient,
): RecipeConversationStore {
  async function readLatestPosition(conversationId: string): Promise<number> {
    const { data, error } = await client
      .from('conversation_messages')
      .select('position')
      .eq('conversation_id', conversationId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail('latest message read');
    return data ? Number(data.position) : -1;
  }

  return {
    async getRecipeSnapshot(recipeId, userId) {
      const { data: recipe, error } = await client
        .from('recipes')
        .select(
          'id, title, description, servings, prep_time_minutes, cook_time_minutes, image_path, source_name, source_url, head_version',
        )
        .eq('id', recipeId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) fail('recipe read');
      if (!recipe) return null;

      const [ingredientsResult, stepsResult, tagLinksResult] =
        await Promise.all([
          client
            .from('recipe_ingredients')
            .select('name, quantity_num, quantity_den, unit, position')
            .eq('recipe_id', recipeId)
            .order('position'),
          client
            .from('recipe_steps')
            .select('text, position')
            .eq('recipe_id', recipeId)
            .order('position'),
          client.from('recipe_tags').select('tag_id').eq('recipe_id', recipeId),
        ]);
      if (ingredientsResult.error) fail('ingredients read');
      if (stepsResult.error) fail('steps read');
      if (tagLinksResult.error) fail('recipe tags read');

      const tagIds = (tagLinksResult.data ?? []).map(
        (row) => row.tag_id as string,
      );
      let tags: string[] = [];
      if (tagIds.length > 0) {
        const { data: tagRows, error: tagsError } = await client
          .from('tags')
          .select('name')
          .in('id', tagIds)
          .order('name');
        if (tagsError) fail('tags read');
        tags = (tagRows ?? []).map((row) => row.name as string);
      }

      const snapshot: RecipeSnapshot = recipeSnapshotSchema.parse({
        title: recipe.title,
        description: recipe.description,
        servings: Number(recipe.servings),
        prepTimeMinutes:
          recipe.prep_time_minutes === null
            ? null
            : Number(recipe.prep_time_minutes),
        cookTimeMinutes:
          recipe.cook_time_minutes === null
            ? null
            : Number(recipe.cook_time_minutes),
        imagePath: recipe.image_path,
        sourceName: recipe.source_name,
        sourceUrl: recipe.source_url,
        ingredients: (ingredientsResult.data ?? []).map((row) => ({
          name: row.name as string,
          quantity:
            row.quantity_num === null
              ? null
              : makeQuantity(
                  Number(row.quantity_num),
                  Number(row.quantity_den ?? 1),
                ),
          unit: row.unit as string | null,
        })),
        steps: (stepsResult.data ?? []).map((row) => ({
          text: row.text as string,
        })),
        tags,
      });
      return { snapshot, headVersion: Number(recipe.head_version) };
    },

    async getOrCreateConversation(recipeId, userId) {
      const read = async () => {
        const { data, error } = await client
          .from('conversations')
          .select('id, recipe_id, user_id')
          .eq('recipe_id', recipeId)
          .eq('user_id', userId)
          .maybeSingle();
        if (error) fail('conversation read');
        return data;
      };

      const existing = await read();
      if (existing) {
        return {
          id: existing.id as string,
          recipeId: existing.recipe_id as string,
          userId: existing.user_id as string,
        };
      }

      const { data, error } = await client
        .from('conversations')
        .insert({ user_id: userId, recipe_id: recipeId, kind: 'recipe' })
        .select('id, recipe_id, user_id')
        .maybeSingle();
      if (!error && data) {
        return {
          id: data.id as string,
          recipeId: data.recipe_id as string,
          userId: data.user_id as string,
        };
      }

      // A concurrent first message may have won the UNIQUE(recipe_id) insert.
      const raced = await read();
      if (!raced) fail('conversation create');
      return {
        id: raced.id as string,
        recipeId: raced.recipe_id as string,
        userId: raced.user_id as string,
      };
    },

    async getRecentMessages(conversationId, limit) {
      const { data, error } = await client
        .from('conversation_messages')
        .select('role, content, position')
        .eq('conversation_id', conversationId)
        .order('position', { ascending: false })
        .limit(limit);
      if (error) fail('recent messages read');
      return (data ?? []).reverse().map(
        (row) =>
          ({
            role: row.role,
            content: row.content,
          }) as ConversationMessage,
      );
    },

    async appendMessage(input) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const position = (await readLatestPosition(input.conversationId)) + 1;
        const { data, error } = await client
          .from('conversation_messages')
          .insert({
            conversation_id: input.conversationId,
            position,
            role: input.role,
            content: input.content,
          })
          .select('id, conversation_id, position, role, content')
          .maybeSingle();
        if (!error && data) {
          return {
            id: data.id as string,
            conversationId: data.conversation_id as string,
            position: Number(data.position),
            role: data.role,
            content: data.content as string,
          } as StoredConversationMessage;
        }
        if (error?.code !== '23505') fail('message append');
      }
      return fail('message append retries exhausted');
    },

    async createPendingProposal(input) {
      const { data, error } = await client
        .from('modification_proposals')
        .insert({
          conversation_id: input.conversationId,
          message_id: input.messageId,
          recipe_id: input.recipeId,
          base_version: input.baseVersion,
          operations: input.proposal.operations,
          status: 'pending',
        })
        .select('id')
        .single();
      if (error || !data) fail('proposal create');
      return { id: data.id as string, status: 'pending', ...input };
    },
  };
}
