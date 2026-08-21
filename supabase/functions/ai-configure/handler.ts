// Pure, testable handler for the ai-configure Edge Function (T028).
// All side effects (auth, DB, Vault, provider validation) are injected so the
// suite runs under Vitest/Node without touching Deno APIs or real network.
import { z } from 'zod';
import { handleRequest, jsonResponse } from '../_shared/http.ts';
import type { AuthVerifier } from '../_shared/http.ts';
import type { AiCredentials } from '../../../packages/contracts/src/index.ts';
import type { Result } from '../../../packages/contracts/src/index.ts';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

const upsertSchema = z.object({
  action: z.literal('upsert'),
  provider: z.literal('openai'),
  apiKey: z.string().min(1),
  model: z.string().min(1).default(DEFAULT_MODEL),
  baseUrl: z.string().url().optional(),
});

const removeSchema = z.object({
  action: z.literal('remove'),
});

const statusSchema = z.object({
  action: z.literal('status'),
});

const bodySchema = z.union([upsertSchema, removeSchema, statusSchema]);

export type AiConfigurationStatus = 'unverified' | 'valid' | 'invalid';

export interface AiConfigRecord {
  provider: string;
  model: string;
  baseUrl: string | null;
  status: AiConfigurationStatus;
  lastVerifiedAt: string | null;
  vaultSecretName: string;
}

export interface AiConfigStore {
  /** Creates a new Vault secret and returns its opaque reference/name. */
  createVaultSecret(secret: string, name: string): Promise<string>;
  /** Replaces an existing Vault secret in place and returns its reference. */
  updateVaultSecret(
    secretId: string,
    secret: string,
    name: string,
  ): Promise<string>;
  /** Deletes the Vault secret identified by the opaque reference. */
  deleteVaultSecret(secretName: string): Promise<void>;
  /** Upserts the metadata row for the user. */
  upsert(params: {
    userId: string;
    provider: string;
    model: string;
    baseUrl: string | null;
    vaultSecretName: string;
    status: 'valid' | 'invalid';
    lastVerifiedAt: string;
  }): Promise<void>;
  /** Deletes the user's metadata row. */
  remove(userId: string): Promise<void>;
  /** Returns the user's metadata row, or null if unconfigured. */
  get(userId: string): Promise<AiConfigRecord | null>;
}

export interface AiConfigureOptions {
  verifyAuth: AuthVerifier;
  store: AiConfigStore;
  validateCredentials: (credentials: AiCredentials) => Promise<Result<null>>;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Creates the ai-configure request handler. All dependencies are injected to
 * keep the function testable and runtime-neutral.
 */
export function createAiConfigureHandler(options: AiConfigureOptions) {
  return handleRequest({
    schema: bodySchema,
    verifyAuth: options.verifyAuth,
    handler: async (body, ctx) => {
      if (body.action === 'upsert') {
        return handleUpsert(body, ctx.userId, options);
      }
      if (body.action === 'remove') {
        return handleRemove(ctx.userId, options.store);
      }
      return handleStatus(ctx.userId, options.store);
    },
  });
}

async function handleUpsert(
  body: z.infer<typeof upsertSchema>,
  userId: string,
  options: AiConfigureOptions,
): Promise<Response> {
  const baseUrl = body.baseUrl ?? DEFAULT_BASE_URL;
  const validation = await options.validateCredentials({
    apiKey: body.apiKey,
    model: body.model,
    baseUrl,
  });
  const verifiedAt = nowIso();

  if (!validation.ok) {
    const existing = await options.store.get(userId);
    if (existing) {
      await options.store.upsert({
        userId,
        provider: existing.provider,
        model: existing.model,
        baseUrl: existing.baseUrl,
        vaultSecretName: existing.vaultSecretName,
        status: 'invalid',
        lastVerifiedAt: verifiedAt,
      });
    }
    return jsonResponse(
      {
        error: {
          code: 'invalid_credentials',
          message: 'The provider rejected the API key.',
        },
      },
      422,
    );
  }

  const existing = await options.store.get(userId);
  let secretName: string;

  if (existing) {
    try {
      secretName = await options.store.updateVaultSecret(
        existing.vaultSecretName,
        body.apiKey,
        `ai-config-${userId}`,
      );
    } catch {
      secretName = await options.store.createVaultSecret(
        body.apiKey,
        `ai-config-${userId}`,
      );
    }
  } else {
    secretName = await options.store.createVaultSecret(
      body.apiKey,
      `ai-config-${userId}`,
    );
  }

  await options.store.upsert({
    userId,
    provider: body.provider,
    model: body.model,
    baseUrl,
    vaultSecretName: secretName,
    status: 'valid',
    lastVerifiedAt: verifiedAt,
  });
  return jsonResponse({ status: 'valid' });
}

async function handleRemove(
  userId: string,
  store: AiConfigStore,
): Promise<Response> {
  const existing = await store.get(userId);
  if (existing) {
    await store.deleteVaultSecret(existing.vaultSecretName).catch(() => {
      // Continue so the metadata row is still removed even if Vault is stale.
    });
    await store.remove(userId);
  }
  return jsonResponse({ status: 'unconfigured' });
}

async function handleStatus(
  userId: string,
  store: AiConfigStore,
): Promise<Response> {
  const existing = await store.get(userId);
  if (!existing) {
    return jsonResponse({ configured: false });
  }
  return jsonResponse({
    configured: true,
    provider: existing.provider,
    model: existing.model,
    baseUrl: existing.baseUrl,
    status: existing.status,
    lastVerifiedAt: existing.lastVerifiedAt,
  });
}
