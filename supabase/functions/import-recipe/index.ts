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
  type ImportErrorCode,
  type VideoImportClient,
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
const videoImportServiceUrl = Deno.env.get('VIDEO_IMPORT_SERVICE_URL') ?? '';
const videoImportServiceSecret = Deno.env.get('VIDEO_IMPORT_SERVICE_SECRET') ?? '';

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

// Keep enough margin for a cold container plus bounded yt-dlp retries.
const VIDEO_IMPORT_TIMEOUT_MS = 30_000;
const VIDEO_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

const videoImport: VideoImportClient = {
  async fetchMetadata(url) {
    if (!videoImportServiceUrl || !videoImportServiceSecret) {
      return {
        ok: false,
        errorCode: 'fetch_failed' as ImportErrorCode,
        message:
          'Video import is not configured on this server. Copy the caption or description and use "Paste text" instead.',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VIDEO_IMPORT_TIMEOUT_MS);

    try {
      const response = await fetch(
        new URL('/metadata', videoImportServiceUrl).toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${videoImportServiceSecret}`,
          },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        },
      );

      const rawBody = await response.text();
      if (rawBody.length > VIDEO_IMPORT_MAX_BYTES) {
        return {
          ok: false,
          errorCode: 'fetch_failed' as ImportErrorCode,
          message:
            'The video metadata response was too large to import safely. Copy the caption or description and use "Paste text" instead.',
        };
      }

      let parsed: unknown = null;
      if (rawBody.length > 0) {
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          parsed = null;
        }
      }

      if (!response.ok) {
        const errorBody = parsed as
          | { error?: { code?: string; message?: string } }
          | null;
        const errorCode = errorBody?.error?.code;
        if (errorCode === 'unsupported_platform') {
          return {
            ok: false,
            errorCode: 'unsupported_url' as ImportErrorCode,
            message:
              errorBody?.error?.message ??
              'Only public Instagram Reels, TikTok videos, and YouTube Shorts links are supported.',
          };
        }
        return {
          ok: false,
          errorCode: 'fetch_failed' as ImportErrorCode,
          message:
            errorBody?.error?.message ??
            'Video metadata could not be imported. Copy the caption or description and use "Paste text" instead.',
        };
      }

      const body = parsed as { title?: unknown; description?: unknown } | null;
      if (
        !body ||
        typeof body.title !== 'string' ||
        typeof body.description !== 'string'
      ) {
        return {
          ok: false,
          errorCode: 'fetch_failed' as ImportErrorCode,
          message:
            'Video metadata could not be imported. Copy the caption or description and use "Paste text" instead.',
        };
      }

      return {
        ok: true,
        title: body.title,
        description: body.description,
      };
    } catch {
      return {
        ok: false,
        errorCode: 'fetch_failed' as ImportErrorCode,
        message:
          'Video metadata could not be imported. Copy the caption or description and use "Paste text" instead.',
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

Deno.serve(
  createImportRecipeHandler({
    verifyAuth,
    provider,
    safeFetch,
    aiConfigReader,
    videoImport,
  }),
);
