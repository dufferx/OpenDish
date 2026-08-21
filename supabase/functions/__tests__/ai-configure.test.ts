import { describe, expect, it } from 'vitest';
import {
  createAiConfigureHandler,
  type AiConfigRecord,
  type AiConfigStore,
} from '../ai-configure/handler.ts';
import { ok, err } from '../../../packages/contracts/src/index.ts';
import type { AuthResult, AuthVerifier } from '../_shared/http.ts';
import type { AiCredentials, Result } from '../../../packages/contracts/src/index.ts';

const TEST_USER = '00000000-0000-0000-0000-000000000001';
const OTHER_USER = '00000000-0000-0000-0000-000000000002';

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
  const vault = new Map<string, string>();
  const calls: unknown[] = [];
  if (initial) {
    records.set(TEST_USER, initial);
  }
  const store: AiConfigStore = {
    async createVaultSecret(secret, name) {
      calls.push({ method: 'createVaultSecret', name });
      vault.set(name, secret);
      return `vault-${name}`;
    },
    async deleteVaultSecret(secretName) {
      calls.push({ method: 'deleteVaultSecret', secretName });
      for (const [name, ref] of vault.entries()) {
        if (ref === secretName) {
          vault.delete(name);
        }
      }
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
        apiKey: 'sk-secret',
        model: 'gpt-4o',
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('valid');

    expect(vault.get(`ai-config-${TEST_USER}`)).toBe('sk-secret');
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
    vault.set('ai-config-old-ref', 'old-secret');

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
    expect(record?.vaultSecretName).toBe(`vault-ai-config-${TEST_USER}`);
    expect(vault.get(`ai-config-${TEST_USER}`)).toBe('sk-new-secret');
    const deleteCall = calls.find(
      (c) => (c as { method: string }).method === 'deleteVaultSecret',
    );
    expect(deleteCall).toEqual({ method: 'deleteVaultSecret', secretName: 'vault-old' });
  });

  it('upsert returns 422 invalid_credentials on provider rejection', async () => {
    const { store, records } = fakeStore();
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
    const body = await response.json();
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
      vaultSecretName: 'vault-existing',
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
    const body = await response.json();
    expect(body.status).toBe('unconfigured');
    expect(records.get(TEST_USER)).toBeUndefined();
    const deleteCall = calls.find(
      (c) => (c as { method: string }).method === 'deleteVaultSecret',
    );
    expect(deleteCall).toEqual({
      method: 'deleteVaultSecret',
      secretName: 'vault-existing',
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
      vaultSecretName: 'vault-secret-name',
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
    const body = await response.json();
    expect(body).toEqual({
      configured: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'valid',
      lastVerifiedAt: '2024-06-01T12:00:00.000Z',
    });
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('vaultSecretName');
    expect(JSON.stringify(body)).not.toContain('vault-secret-name');
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
});
