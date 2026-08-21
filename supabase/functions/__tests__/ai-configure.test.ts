import { describe, expect, it } from 'vitest';
import {
  createAiConfigureHandler,
  type AiConfigRecord,
  type AiConfigStore,
} from '../ai-configure/handler.ts';
import { createAiConfigReader } from '../ai-propose-modification/dependencies.ts';
import { ok, err } from '../../../packages/contracts/src/index.ts';
import type { AuthVerifier } from '../_shared/http.ts';
import type { AiCredentials, Result } from '../../../packages/contracts/src/index.ts';

const TEST_USER = '00000000-0000-0000-0000-000000000001';
const OTHER_USER = '00000000-0000-0000-0000-000000000002';
const SECRET_SENTINEL = 'sk-test-secret-sentinel';
const SECRET_REFERENCE_SENTINEL = 'vault-secret-ref-sentinel';
const PROVIDER_ERROR_SENTINEL = 'provider-error-sentinel';

function authVerifier(userId: string = TEST_USER): AuthVerifier {
  return async () => ({ ok: true, userId });
}

function failingAuth(): AuthVerifier {
  return async () => ({ ok: false });
}

function fakeStore(initial: AiConfigRecord | null = null): {
  store: AiConfigStore;
  records: Map<string, AiConfigRecord>;
  vault: Map<string, string>;
  calls: unknown[];
} {
  const records = new Map<string, AiConfigRecord>();
  const vault = new Map<string, { name: string; secret: string }>();
  const calls: unknown[] = [];
  if (initial) {
    records.set(TEST_USER, initial);
  }
  const store: AiConfigStore = {
    async createVaultSecret(secret, name) {
      const secretId = `vault-${name}`;
      calls.push({ method: 'createVaultSecret', name, secretId });
      vault.set(secretId, { name, secret });
      return secretId;
    },
    async updateVaultSecret(secretId, secret, name) {
      calls.push({ method: 'updateVaultSecret', name, secretId });
      if (!vault.has(secretId)) {
        throw new Error('missing vault secret');
      }
      vault.set(secretId, { name, secret });
      return secretId;
    },
    async deleteVaultSecret(secretName) {
      calls.push({ method: 'deleteVaultSecret', secretName });
      vault.delete(secretName);
    },
    async upsert(params) {
      calls.push({ method: 'upsert', params });
      records.set(params.userId, {
        provider: params.provider,
        model: params.model,
        baseUrl: params.baseUrl,
        vaultSecretName: params.vaultSecretName,
        status: params.status,
        lastVerifiedAt: params.lastVerifiedAt,
      });
    },
    async remove(userId) {
      calls.push({ method: 'remove', userId });
      records.delete(userId);
    },
    async get(userId) {
      calls.push({ method: 'get', userId });
      return records.get(userId) ?? null;
    },
  };
  return { store, records, vault, calls };
}

function createReaderClient(
  records: Map<string, AiConfigRecord>,
  vault: Map<string, { name: string; secret: string }>,
) {
  return {
    from(table: string) {
      expect(table).toBe('ai_configurations');
      return {
        select() {
          return {
            eq(column: string, userId: string) {
              expect(column).toBe('user_id');
              return {
                async maybeSingle() {
                  const record = records.get(userId);
                  if (!record) {
                    return { data: null, error: null };
                  }
                  return {
                    data: {
                      model: record.model,
                      base_url: record.baseUrl,
                      vault_secret_name: record.vaultSecretName,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
    async rpc(fn: string, params: { secret_id: string }) {
      expect(fn).toBe('read_vault_secret');
      return {
        data: vault.get(params.secret_id)?.secret ?? null,
        error: null,
      };
    },
  };
}

function fakeValidator(
  result: Result<null> = ok(null),
): (credentials: AiCredentials) => Promise<Result<null>> {
  return async (credentials) => {
    return result;
  };
}

function makeRequest(body: unknown, token = 'valid-token'): Request {
  return new Request('http://localhost/ai-configure', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string, token = 'valid-token'): Request {
  return new Request('http://localhost/ai-configure', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body,
  });
}

async function expectNoLeak(
  response: Response,
  forbiddenValues: string[],
): Promise<unknown> {
  const rawBody = await response.text();
  for (const forbiddenValue of forbiddenValues) {
    expect(rawBody).not.toContain(forbiddenValue);
  }
  return rawBody.length > 0 ? JSON.parse(rawBody) : null;
}

describe('ai-configure handler', () => {
  it('requires POST and rejects other methods', async () => {
    const { store } = fakeStore();
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(),
    });
    const response = await handler(
      new Request('http://localhost/ai-configure', { method: 'GET' }),
    );
    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.error.code).toBe('method_not_allowed');
  });

  it('rejects unauthenticated requests', async () => {
    const { store } = fakeStore();
    const handler = createAiConfigureHandler({
      verifyAuth: failingAuth(),
      store,
      validateCredentials: fakeValidator(),
    });
    const response = await handler(makeRequest({ action: 'status' }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns unconfigured status when no row exists', async () => {
    const { store } = fakeStore();
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(),
    });
    const response = await handler(makeRequest({ action: 'status' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ configured: false });
  });

  it('upsert stores the key in Vault and writes metadata', async () => {
    const { store, records, vault, calls } = fakeStore();
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(ok(null)),
    });
    const response = await handler(
      makeRequest({
        action: 'upsert',
        provider: 'openai',
        apiKey: SECRET_SENTINEL,
        model: 'gpt-4o',
      }),
    );
    expect(response.status).toBe(200);
    const body = await expectNoLeak(response, [SECRET_SENTINEL]);
    expect(body.status).toBe('valid');

    expect(vault.get(`vault-ai-config-${TEST_USER}`)?.secret).toBe(
      SECRET_SENTINEL,
    );
    const record = records.get(TEST_USER);
    expect(record).toBeDefined();
    expect(record?.provider).toBe('openai');
    expect(record?.model).toBe('gpt-4o');
    expect(record?.baseUrl).toBe('https://api.openai.com/v1');
    expect(record?.status).toBe('valid');
    expect(record?.vaultSecretName).toBe(`vault-ai-config-${TEST_USER}`);

    const upsertCall = calls.find((c) => (c as { method: string }).method === 'upsert');
    expect(upsertCall).toBeDefined();
  });

  it('upsert replaces an existing Vault secret and metadata', async () => {
    const existing: AiConfigRecord = {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      baseUrl: 'https://api.openai.com/v1',
      vaultSecretName: 'vault-old',
      status: 'valid',
      lastVerifiedAt: '2024-01-01T00:00:00.000Z',
    };
    const { store, records, vault, calls } = fakeStore(existing);
    vault.set('vault-old', { name: 'ai-config-old-ref', secret: 'old-secret' });

    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(ok(null)),
    });
    const response = await handler(
      makeRequest({
        action: 'upsert',
        provider: 'openai',
        apiKey: 'sk-new-secret',
      }),
    );
    expect(response.status).toBe(200);

    const record = records.get(TEST_USER);
    expect(record?.model).toBe('gpt-4o-mini');
    expect(record?.vaultSecretName).toBe('vault-old');
    expect(vault.get('vault-old')?.secret).toBe('sk-new-secret');
    const updateCall = calls.find(
      (c) => (c as { method: string }).method === 'updateVaultSecret',
    );
    expect(updateCall).toEqual({
      method: 'updateVaultSecret',
      name: `ai-config-${TEST_USER}`,
      secretId: 'vault-old',
    });
  });

  it('upsert returns 422 invalid_credentials on provider rejection', async () => {
    const { store, records } = fakeStore();
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: async (credentials) =>
        err({
          code: 'invalid_credentials',
          message: `${PROVIDER_ERROR_SENTINEL}:${credentials.apiKey}`,
        }),
    });
    const response = await handler(
      makeRequest({
        action: 'upsert',
        provider: 'openai',
        apiKey: SECRET_SENTINEL,
      }),
    );
    expect(response.status).toBe(422);
    const body = await expectNoLeak(response, [
      SECRET_SENTINEL,
      PROVIDER_ERROR_SENTINEL,
    ]);
    expect(body.error.code).toBe('invalid_credentials');
    expect(records.get(TEST_USER)).toBeUndefined();
  });

  it('upsert marks an existing row invalid on provider rejection', async () => {
    const existing: AiConfigRecord = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      vaultSecretName: 'vault-existing',
      status: 'valid',
      lastVerifiedAt: '2024-01-01T00:00:00.000Z',
    };
    const { store, records } = fakeStore(existing);
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(
        err({ code: 'invalid_credentials', message: 'bad key' }),
      ),
    });
    const response = await handler(
      makeRequest({
        action: 'upsert',
        provider: 'openai',
        apiKey: 'sk-bad',
      }),
    );
    expect(response.status).toBe(422);
    const record = records.get(TEST_USER);
    expect(record?.status).toBe('invalid');
    expect(record?.vaultSecretName).toBe('vault-existing');
  });

  it('remove deletes the Vault secret and metadata row', async () => {
    const existing: AiConfigRecord = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      vaultSecretName: SECRET_REFERENCE_SENTINEL,
      status: 'valid',
      lastVerifiedAt: '2024-01-01T00:00:00.000Z',
    };
    const { store, records, calls } = fakeStore(existing);
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(),
    });
    const response = await handler(makeRequest({ action: 'remove' }));
    expect(response.status).toBe(200);
    const body = await expectNoLeak(response, [SECRET_REFERENCE_SENTINEL]);
    expect(body.status).toBe('unconfigured');
    expect(records.get(TEST_USER)).toBeUndefined();
    const deleteCall = calls.find(
      (c) => (c as { method: string }).method === 'deleteVaultSecret',
    );
    expect(deleteCall).toEqual({
      method: 'deleteVaultSecret',
      secretName: SECRET_REFERENCE_SENTINEL,
    });
  });

  it('remove is idempotent when no row exists', async () => {
    const { store, records, calls } = fakeStore();
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(),
    });
    const response = await handler(makeRequest({ action: 'remove' }));
    expect(response.status).toBe(200);
    expect(records.get(TEST_USER)).toBeUndefined();
    const deleteCall = calls.find(
      (c) => (c as { method: string }).method === 'deleteVaultSecret',
    );
    expect(deleteCall).toBeUndefined();
  });

  it('status returns safe metadata without the key or vault secret name', async () => {
    const existing: AiConfigRecord = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      vaultSecretName: SECRET_REFERENCE_SENTINEL,
      status: 'valid',
      lastVerifiedAt: '2024-06-01T12:00:00.000Z',
    };
    const { store } = fakeStore(existing);
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(),
    });
    const response = await handler(makeRequest({ action: 'status' }));
    expect(response.status).toBe(200);
    const body = await expectNoLeak(response, [SECRET_REFERENCE_SENTINEL]);
    expect(body).toEqual({
      configured: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      status: 'valid',
      lastVerifiedAt: '2024-06-01T12:00:00.000Z',
    });
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('vaultSecretName');
  });

  it('status only returns the users own configuration', async () => {
    const existing: AiConfigRecord = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      vaultSecretName: 'vault-other',
      status: 'valid',
      lastVerifiedAt: '2024-06-01T12:00:00.000Z',
    };
    const { store, records } = fakeStore();
    records.set(OTHER_USER, existing);

    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(TEST_USER),
      store,
      validateCredentials: fakeValidator(),
    });
    const response = await handler(makeRequest({ action: 'status' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.configured).toBe(false);
  });

  it('supports create, read, replace, and remove without exposing secret references', async () => {
    const { store, records, vault } = fakeStore();
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(),
    });
    const reader = createAiConfigReader(
      createReaderClient(records, vault) as never,
    );

    const createResponse = await handler(
      makeRequest({
        action: 'upsert',
        provider: 'openai',
        apiKey: 'sk-first',
        model: 'gpt-4o-mini',
      }),
    );
    expect(createResponse.status).toBe(200);

    const firstRead = await reader.getConfig(TEST_USER);
    expect(firstRead).toEqual({
      configured: true,
      credentials: {
        apiKey: 'sk-first',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
      },
    });

    const firstSecretId = records.get(TEST_USER)?.vaultSecretName;
    expect(firstSecretId).toBeDefined();

    const replaceResponse = await handler(
      makeRequest({
        action: 'upsert',
        provider: 'openai',
        apiKey: 'sk-second',
        model: 'gpt-4.1-mini',
      }),
    );
    expect(replaceResponse.status).toBe(200);

    const secondRead = await reader.getConfig(TEST_USER);
    expect(secondRead).toEqual({
      configured: true,
      credentials: {
        apiKey: 'sk-second',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://api.openai.com/v1',
      },
    });
    expect(records.get(TEST_USER)?.vaultSecretName).toBe(firstSecretId);

    const removeResponse = await handler(makeRequest({ action: 'remove' }));
    expect(removeResponse.status).toBe(200);

    const thirdRead = await reader.getConfig(TEST_USER);
    expect(thirdRead).toEqual({ configured: false });
    expect(Array.from(vault.values())).toEqual([]);
  });

  it('validates the request body', async () => {
    const { store } = fakeStore();
    const handler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store,
      validateCredentials: fakeValidator(),
    });
    const response = await handler(makeRequest({ action: 'unknown' }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('validation_failed');
  });

  it('does not leak secrets in validation, provider error, or internal error responses', async () => {
    const validationStore = fakeStore().store;
    const validationHandler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store: validationStore,
      validateCredentials: fakeValidator(),
    });
    const validationResponse = await validationHandler(
      makeRequest({
        action: 'upsert',
        provider: 'openai',
        apiKey: '',
        model: SECRET_SENTINEL,
      }),
    );
    expect(validationResponse.status).toBe(400);
    const validationBody = await expectNoLeak(validationResponse, [
      SECRET_SENTINEL,
    ]);
    expect(validationBody.error.code).toBe('validation_failed');

    const invalidJsonStore = fakeStore().store;
    const invalidJsonHandler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store: invalidJsonStore,
      validateCredentials: fakeValidator(),
    });
    const invalidJsonResponse = await invalidJsonHandler(
      makeRawRequest(`{"action":"upsert","apiKey":"${SECRET_SENTINEL}"`),
    );
    expect(invalidJsonResponse.status).toBe(400);
    const invalidJsonBody = await expectNoLeak(invalidJsonResponse, [
      SECRET_SENTINEL,
    ]);
    expect(invalidJsonBody.error.code).toBe('invalid_json');

    const providerErrorStore = fakeStore().store;
    const providerErrorHandler = createAiConfigureHandler({
      verifyAuth: authVerifier(),
      store: providerErrorStore,
      validateCredentials: async (credentials) => {
        throw new Error(`${PROVIDER_ERROR_SENTINEL}:${credentials.apiKey}`);
      },
    });
    const providerErrorResponse = await providerErrorHandler(
      makeRequest({
        action: 'upsert',
        provider: 'openai',
        apiKey: SECRET_SENTINEL,
      }),
    );
    expect(providerErrorResponse.status).toBe(500);
    const providerErrorBody = await expectNoLeak(providerErrorResponse, [
      SECRET_SENTINEL,
      PROVIDER_ERROR_SENTINEL,
    ]);
    expect(providerErrorBody.error.code).toBe('internal_error');
  });
});
