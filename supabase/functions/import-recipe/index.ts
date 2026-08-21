// Deno entrypoint for the import-recipe Edge Function (T041).
// This file is intentionally thin: all logic lives in ./handler.ts and is
// injected with a real Supabase service client, the OpenAI provider, and the
// SSRF-safe fetch wrapper.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createAuthVerifier } from '../_shared/http.ts';
import { createOpenAiProvider } from '../_shared/openai-provider.ts';
import {
  createImportRecipeHandler,
  createSafeFetch,
  type AiConfigReader,
} from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
};

const authClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
const serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);

const verifyAuth = createAuthVerifier(authClient);
const provider = createOpenAiProvider();
const safeFetch = createSafeFetch();

const aiConfigReader: AiConfigReader = {
  async getConfig(userId) {
    const { data: record, error } = await serviceClient
      .from('ai_configurations')
      .select('provider, model, base_url, vault_secret_name, status')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      throw new Error(`ai_configurations select failed: ${error.message}`);
    }
    if (!record) {
      return { configured: false };
    }

    const { data: secretValue, error: secretError } = await serviceClient.rpc(
      'read_vault_secret',
      { secret_id: record.vault_secret_name as string },
    );
    if (secretError) {
      throw new Error(`vault read failed: ${secretError.message}`);
    }
    if (!secretValue) {
      return { configured: false };
    }

    return {
      configured: true,
      credentials: {
        apiKey: secretValue as string,
        model: record.model as string,
        baseUrl: (record.base_url as string | null) ?? undefined,
      },
    };
  },
};

Deno.serve(
  createImportRecipeHandler({
    verifyAuth,
    provider,
    safeFetch,
    aiConfigReader,
  }),
);
