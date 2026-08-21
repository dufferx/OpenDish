import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AiConfigReader } from './handler.ts';

export function createAiConfigReader(client: SupabaseClient): AiConfigReader {
  return {
    async getConfig(userId) {
      const { data: record, error } = await client
        .from('ai_configurations')
        .select('model, base_url, vault_secret_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error('AI configuration could not be read.');
      if (!record) return { configured: false };

      const { data: secret, error: secretError } = await client.rpc(
        'read_vault_secret',
        {
          secret_id: record.vault_secret_name as string,
        },
      );
      if (secretError) throw new Error('AI credentials could not be read.');
      if (!secret) return { configured: false };

      return {
        configured: true,
        credentials: {
          apiKey: secret as string,
          model: record.model as string,
          baseUrl: (record.base_url as string | null) ?? undefined,
        },
      };
    },
  };
}
