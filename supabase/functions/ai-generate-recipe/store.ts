import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  type ConversationMessage,
  type MessageRole,
} from '../../../packages/contracts/src/index.ts';
import type {
  GenerationConversation,
  GenerationConversationStore,
  StoredConversationMessage,
} from './handler.ts';

function fail(operation: string): never {
  throw new Error(`generation conversation store failed: ${operation}`);
}

export function createSupabaseGenerationConversationStore(
  client: SupabaseClient,
): GenerationConversationStore {
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
    async createConversation(userId) {
      const { data, error } = await client
        .from('conversations')
        .insert({ user_id: userId, recipe_id: null, kind: 'generation' })
        .select('id, user_id, kind')
        .single();
      if (error || !data) fail('conversation create');
      return {
        id: data.id as string,
        userId: data.user_id as string,
        kind: data.kind as 'generation',
      };
    },

    async getConversation(conversationId, userId) {
      const { data, error } = await client
        .from('conversations')
        .select('id, user_id, kind')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) fail('conversation read');
      if (!data) return null;
      return {
        id: data.id as string,
        userId: data.user_id as string,
        kind: data.kind as 'generation',
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
  };
}
