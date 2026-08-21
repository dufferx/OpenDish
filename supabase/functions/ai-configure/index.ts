// Deno entrypoint for the ai-configure Edge Function (T028).
// This file is intentionally thin: all logic lives in ./handler.ts and is
// injected with a real Supabase service client and the OpenAI provider.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createAuthVerifier } from '../_shared/http.ts';
import { createOpenAiProvider } from '../_shared/openai-provider.ts';
import {
  createAiConfigureHandler,
  type AiConfigRecord,
  type AiConfigStore,
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

const store: AiConfigStore = {
  async createVaultSecret(secret, name) {
    const { data, error } = await serviceClient.rpc('create_vault_secret', {
      secret_value: secret,
      secret_name: name,
      secret_description: 'OpenDish AI provider API key',
    });
    if (error) {
      throw new Error(`create_vault_secret failed: ${error.message}`);
    }
    return data as string;
  },

  async updateVaultSecret(secretId, secret, name) {
    const { data, error } = await serviceClient.rpc('update_vault_secret', {
      secret_id: secretId,
      secret_value: secret,
      secret_name: name,
      secret_description: 'OpenDish AI provider API key',
    });
    if (error) {
      throw new Error(`update_vault_secret failed: ${error.message}`);
    }
    return data as string;
  },

  async deleteVaultSecret(secretName) {
    const { error } = await serviceClient.rpc('delete_vault_secret', {
      secret_id: secretName,
    });
    if (error) {
      throw new Error(`delete_vault_secret failed: ${error.message}`);
    }
  },

  async upsert(params) {
    const { error } = await serviceClient.from('ai_configurations').upsert({
      user_id: params.userId,
      provider: params.provider,
      base_url: params.baseUrl,
      model: params.model,
      vault_secret_name: params.vaultSecretName,
      status: params.status,
      last_verified_at: params.lastVerifiedAt,
    });
    if (error) {
      throw new Error(`ai_configurations upsert failed: ${error.message}`);
    }
  },

  async remove(userId) {
    const { error } = await serviceClient
      .from('ai_configurations')
      .delete()
      .eq('user_id', userId);
    if (error) {
      throw new Error(`ai_configurations delete failed: ${error.message}`);
    }
  },

  async get(userId) {
    const { data, error } = await serviceClient
      .from('ai_configurations')
      .select(
        'provider, model, base_url, status, last_verified_at, vault_secret_name',
      )
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      throw new Error(`ai_configurations select failed: ${error.message}`);
    }
    if (!data) {
      return null;
    }
    return {
      provider: data.provider as string,
      model: data.model as string,
      baseUrl: (data.base_url as string | null) ?? null,
      status: data.status as AiConfigRecord['status'],
      lastVerifiedAt: (data.last_verified_at as string | null) ?? null,
      vaultSecretName: data.vault_secret_name as string,
    };
  },
};

Deno.serve(
  createAiConfigureHandler({
    verifyAuth,
    store,
    validateCredentials: provider.validateCredentials,
  }),
);
