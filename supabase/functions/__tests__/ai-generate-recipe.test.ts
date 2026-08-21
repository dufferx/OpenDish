import { describe, expect, it } from 'vitest';
import {
  err,
  FakeAiProvider,
  makeQuantity,
  ok,
  type AiCredentials,
  type ConversationMessage,
  type MessageRole,
  type RecipeDraft,
} from '../../../packages/contracts/src/index.ts';
import type { AuthVerifier } from '../_shared/http.ts';
import {
  createGenerateRecipeHandler,
  type GenerationConversation,
  type GenerationConversationStore,
  type StoredConversationMessage,
} from '../ai-generate-recipe/handler.ts';

const TEST_USER = '00000000-0000-0000-0000-000000000001';
const OTHER_USER = '00000000-0000-0000-0000-000000000002';
const CREDENTIALS: AiCredentials = {
  apiKey: 'sk-contract-test-secret',
  model: 'test-model',
};

function authVerifier(userId: string = TEST_USER): AuthVerifier {
  return async () => ({ ok: true, userId });
}

function failingAuth(): AuthVerifier {
  return async () => ({ ok: false });
}

function aiConfigReader(credentials: AiCredentials | null = CREDENTIALS) {
  return {
    async getConfig(_userId: string) {
      return credentials
        ? ({ configured: true, credentials } as const)
        : ({ configured: false } as const);
    },
  };
}

function makeRequest(body: unknown, token = 'valid-token'): Request {
  return new Request('http://localhost/ai-generate-recipe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const VALID_DRAFT: RecipeDraft = {
  title: 'Generated Stir-Fry',
  description: 'A quick weeknight stir-fry.',
  servings: 4,
  prepTimeMinutes: 15,
  cookTimeMinutes: 10,
  sourceName: null,
  sourceUrl: null,
  ingredients: [
    { name: 'Rice', quantity: makeQuantity(2, 1), unit: 'cups' },
    { name: 'Soy sauce', quantity: makeQuantity(2, 1), unit: 'tbsp' },
  ],
  steps: [
    { text: 'Cook the rice.' },
    { text: 'Stir-fry vegetables and toss with soy sauce.' },
  ],
  tags: ['quick', 'dinner'],
};

/** In-memory contract double for the generation conversation persistence boundary. */
class FakeGenerationConversationStore implements GenerationConversationStore {
  readonly conversations = new Map<string, GenerationConversation>();
  readonly messages: StoredConversationMessage[] = [];
  readonly recentMessageLimits: number[] = [];

  async createConversation(userId: string): Promise<GenerationConversation> {
    const id = `20000000-0000-0000-0000-${String(this.conversations.size + 1).padStart(12, '0')}`;
    const conversation: GenerationConversation = {
      id,
      userId,
      kind: 'generation',
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  async getConversation(
    conversationId: string,
    userId: string,
  ): Promise<GenerationConversation | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.userId !== userId) return null;
    return conversation;
  }

  async getRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<ConversationMessage[]> {
    this.recentMessageLimits.push(limit);
    return this.messages
      .filter((message) => message.conversationId === conversationId)
      .sort((a, b) => a.position - b.position)
      .slice(-limit)
      .map(({ role, content }) => ({ role, content }));
  }

  async appendMessage(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
  }): Promise<StoredConversationMessage> {
    const position = this.messages.filter(
      (message) => message.conversationId === input.conversationId,
    ).length;
    const message: StoredConversationMessage = {
      id: `30000000-0000-0000-0000-${String(this.messages.length + 1).padStart(12, '0')}`,
      position,
      ...input,
    };
    this.messages.push(message);
    return message;
  }
}

function handlerOptions(
  store: FakeGenerationConversationStore,
  provider: FakeAiProvider = new FakeAiProvider(),
  overrides: Record<string, unknown> = {},
) {
  return {
    verifyAuth: authVerifier(),
    provider,
    aiConfigReader: aiConfigReader(),
    store,
    ...overrides,
  };
}

describe('ai-generate-recipe handler contract', () => {
  it('rejects unauthenticated and schema-invalid requests', async () => {
    const store = new FakeGenerationConversationStore();
    const unauthorized = createGenerateRecipeHandler(
      handlerOptions(store, new FakeAiProvider(), {
        verifyAuth: failingAuth(),
      }),
    );
    const unauthorizedResponse = await unauthorized(
      makeRequest({ message: 'Create a pasta dish.' }),
    );
    expect(unauthorizedResponse.status).toBe(401);
    expect(await unauthorizedResponse.json()).toMatchObject({
      error: { code: 'unauthorized' },
    });

    const handler = createGenerateRecipeHandler(handlerOptions(store));
    const invalidResponse = await handler(
      makeRequest({ conversationId: 'not-a-uuid', message: '' }),
    );
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({
      error: { code: 'validation_failed' },
    });
    expect(store.messages).toHaveLength(0);
  });

  it('accepts 4,000 message characters and rejects 4,001', async () => {
    const store = new FakeGenerationConversationStore();
    const handler = createGenerateRecipeHandler(handlerOptions(store));

    const accepted = await handler(makeRequest({ message: 'a'.repeat(4_000) }));
    const rejected = await handler(makeRequest({ message: 'a'.repeat(4_001) }));

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: { code: 'validation_failed' },
    });
  });

  it('creates a generation conversation and returns a clarify outcome with persisted messages', async () => {
    const store = new FakeGenerationConversationStore();
    const provider = new FakeAiProvider({
      generateRecipe: ok({ kind: 'clarify', question: 'What protein would you like?' }),
    });
    const handler = createGenerateRecipeHandler(handlerOptions(store, provider));

    const response = await handler(
      makeRequest({ message: 'I want a quick dinner.' }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      conversationId: string;
      outcome: { kind: 'clarify'; question: string };
    };
    expect(body.outcome).toEqual({
      kind: 'clarify',
      question: 'What protein would you like?',
    });
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations.get(body.conversationId)?.userId).toBe(TEST_USER);
    expect(store.conversations.get(body.conversationId)?.kind).toBe('generation');
    expect(
      store.messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: 'user', content: 'I want a quick dinner.' },
      { role: 'assistant', content: 'What protein would you like?' },
    ]);
    expect(provider.calls[0]).toMatchObject({
      method: 'generateRecipe',
      conversation: [
        { role: 'user', content: 'I want a quick dinner.' },
      ],
      credentials: CREDENTIALS,
    });
  });

  it('returns a draft outcome and persists an assistant summary', async () => {
    const store = new FakeGenerationConversationStore();
    const provider = new FakeAiProvider({
      generateRecipe: ok({ kind: 'draft', draft: VALID_DRAFT }),
    });
    const handler = createGenerateRecipeHandler(handlerOptions(store, provider));

    const response = await handler(
      makeRequest({ message: 'Make a stir-fry.' }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      conversationId: string;
      outcome: { kind: 'draft'; draft: RecipeDraft };
    };
    expect(body.outcome.kind).toBe('draft');
    expect(body.outcome.draft.title).toBe('Generated Stir-Fry');
    expect(store.messages.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(store.messages[1]?.content).toContain('Generated Stir-Fry');
  });

  it('rejects invalid AI output that fails the recipe draft schema', async () => {
    const store = new FakeGenerationConversationStore();
    const invalidDraft = { ...VALID_DRAFT, ingredients: [] };
    const provider = new FakeAiProvider({
      generateRecipe: ok({ kind: 'draft', draft: invalidDraft as RecipeDraft }),
    });
    const handler = createGenerateRecipeHandler(handlerOptions(store, provider));

    const response = await handler(
      makeRequest({ message: 'Generate something invalid.' }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_ai_output' },
    });
    expect(
      store.messages.filter((message) => message.role === 'assistant'),
    ).toHaveLength(0);
  });

  it('returns 409 ai_not_configured when AI is unconfigured', async () => {
    const store = new FakeGenerationConversationStore();
    const handler = createGenerateRecipeHandler(
      handlerOptions(store, new FakeAiProvider(), {
        aiConfigReader: aiConfigReader(null),
      }),
    );

    const response = await handler(
      makeRequest({ message: 'Create a recipe.' }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'ai_not_configured' },
    });
    expect(store.messages).toHaveLength(0);
  });

  it('returns safe envelopes for provider failures without leaking secrets', async () => {
    const leakedSecret = 'sk-never-return-this-secret';
    const leakedStack = 'at ProviderClient.request (/private/provider.ts:42:7)';
    const provider = new FakeAiProvider({
      generateRecipe: err({
        code: 'provider_error',
        message: `Provider failed with ${leakedSecret}\n${leakedStack}`,
      }),
    });
    const store = new FakeGenerationConversationStore();
    const handler = createGenerateRecipeHandler(handlerOptions(store, provider));

    const response = await handler(
      makeRequest({ message: 'Create a recipe.' }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: {
        code: 'provider_error',
        message: 'The AI provider request failed.',
      },
    });
    expect(JSON.stringify(body)).not.toContain(leakedSecret);
    expect(JSON.stringify(body)).not.toContain(leakedStack);
    // The user's message is persisted before the provider call, even on failure.
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]?.role).toBe('user');
  });

  it('rejects requests for conversations owned by another user', async () => {
    const store = new FakeGenerationConversationStore();
    const conversation = await store.createConversation(OTHER_USER);
    const handler = createGenerateRecipeHandler(handlerOptions(store));

    const response = await handler(
      makeRequest({ conversationId: conversation.id, message: 'Hello' }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'conversation_not_found' },
    });
  });

  it('keeps multiple turns idempotent within one conversation', async () => {
    const store = new FakeGenerationConversationStore();
    const provider = new FakeAiProvider({
      generateRecipe: ok({ kind: 'clarify', question: 'Tell me more.' }),
    });
    const handler = createGenerateRecipeHandler(handlerOptions(store, provider));

    const first = await handler(makeRequest({ message: 'First message.' }));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      conversationId: string;
    };

    const second = await handler(
      makeRequest({
        conversationId: firstBody.conversationId,
        message: 'Second message.',
      }),
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { conversationId: string };
    expect(secondBody.conversationId).toBe(firstBody.conversationId);

    expect(store.conversations).toHaveLength(1);
    expect(store.messages).toHaveLength(4);
    expect(store.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'First message.' },
      { role: 'assistant', content: 'Tell me more.' },
      { role: 'user', content: 'Second message.' },
      { role: 'assistant', content: 'Tell me more.' },
    ]);
    expect(store.recentMessageLimits).toEqual([20, 20]);

    const secondCall = provider.calls[1];
    expect(secondCall).toMatchObject({ method: 'generateRecipe' });
    if (secondCall?.method !== 'generateRecipe') {
      throw new Error('expected generateRecipe call');
    }
    expect(secondCall.conversation).toHaveLength(3);
    expect(secondCall.conversation[0]?.content).toBe('First message.');
    expect(secondCall.conversation[1]?.content).toBe('Tell me more.');
    expect(secondCall.conversation[2]?.content).toBe('Second message.');
  });
});
