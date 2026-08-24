import { describe, expect, it } from 'vitest';
import {
  err,
  FakeAiProvider,
  ok,
  validProposal,
  validRecipeSnapshot,
  type AiCredentials,
  type ConversationMessage,
  type MessageRole,
  type ModificationProposal,
  type RecipeSnapshot,
} from '../../../packages/contracts/src/index.ts';
import type { AuthVerifier } from '../_shared/http.ts';
import { createRecipeChatHandler } from '../ai-recipe-chat/handler.ts';
import { createProposeModificationHandler } from '../ai-propose-modification/handler.ts';

const TEST_USER = '00000000-0000-0000-0000-000000000001';
const RECIPE_A = '10000000-0000-0000-0000-000000000001';
const RECIPE_B = '10000000-0000-0000-0000-000000000002';
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

function makeRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-token',
    },
    body: JSON.stringify(body),
  });
}

interface StoredMessage extends ConversationMessage {
  id: string;
  conversationId: string;
  position: number;
}

interface StoredProposal {
  id: string;
  conversationId: string;
  messageId: string;
  recipeId: string;
  baseVersion: number;
  proposal: ModificationProposal;
  status: 'pending';
}

/** In-memory contract double for the persistence boundary used by both handlers. */
class FakeRecipeConversationStore {
  readonly recipes = new Map<
    string,
    { ownerId: string; snapshot: RecipeSnapshot; headVersion: number }
  >([
    [
      RECIPE_A,
      { ownerId: TEST_USER, snapshot: validRecipeSnapshot, headVersion: 7 },
    ],
    [
      RECIPE_B,
      { ownerId: TEST_USER, snapshot: validRecipeSnapshot, headVersion: 3 },
    ],
  ]);
  readonly conversations = new Map<
    string,
    { id: string; recipeId: string; userId: string }
  >();
  readonly messages: StoredMessage[] = [];
  readonly proposals: StoredProposal[] = [];
  readonly recentMessageLimits: number[] = [];

  async getRecipeSnapshot(recipeId: string, userId: string) {
    const recipe = this.recipes.get(recipeId);
    if (!recipe || recipe.ownerId !== userId) return null;
    return { snapshot: recipe.snapshot, headVersion: recipe.headVersion };
  }

  async getOrCreateConversation(recipeId: string, userId: string) {
    const existing = this.conversations.get(recipeId);
    if (existing) return existing;
    const conversation = {
      id: `20000000-0000-0000-0000-${String(this.conversations.size + 1).padStart(12, '0')}`,
      recipeId,
      userId,
    };
    this.conversations.set(recipeId, conversation);
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
  }): Promise<StoredMessage> {
    const position = this.messages.filter(
      (message) => message.conversationId === input.conversationId,
    ).length;
    const message = {
      id: `30000000-0000-0000-0000-${String(this.messages.length + 1).padStart(12, '0')}`,
      position,
      ...input,
    };
    this.messages.push(message);
    return message;
  }

  async createPendingProposal(input: {
    conversationId: string;
    messageId: string;
    recipeId: string;
    baseVersion: number;
    proposal: ModificationProposal;
  }): Promise<StoredProposal> {
    const proposal = {
      id: `40000000-0000-0000-0000-${String(this.proposals.length + 1).padStart(12, '0')}`,
      status: 'pending' as const,
      ...input,
    };
    this.proposals.push(proposal);
    return proposal;
  }
}

function chatOptions(
  store: FakeRecipeConversationStore,
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

function proposeOptions(
  store: FakeRecipeConversationStore,
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

describe('ai-recipe-chat handler contract', () => {
  it('rejects unauthenticated and schema-invalid requests', async () => {
    const store = new FakeRecipeConversationStore();
    const unauthorized = createRecipeChatHandler(
      chatOptions(store, new FakeAiProvider(), {
        verifyAuth: failingAuth(),
      }),
    );
    const unauthorizedResponse = await unauthorized(
      makeRequest('ai-recipe-chat', {
        recipeId: RECIPE_A,
        message: 'Explain step one.',
        intent: 'answer',
      }),
    );
    expect(unauthorizedResponse.status).toBe(401);
    expect(await unauthorizedResponse.json()).toMatchObject({
      error: { code: 'unauthorized' },
    });

    const handler = createRecipeChatHandler(chatOptions(store));
    const invalidResponse = await handler(
      makeRequest('ai-recipe-chat', {
        recipeId: 'not-a-uuid',
        message: '',
        intent: 'unknown',
      }),
    );
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({
      error: { code: 'validation_failed' },
    });
    expect(store.messages).toHaveLength(0);
  });

  it('accepts 4,000 message characters and rejects 4,001', async () => {
    const store = new FakeRecipeConversationStore();
    const handler = createRecipeChatHandler(chatOptions(store));

    const accepted = await handler(
      makeRequest('ai-recipe-chat', {
        recipeId: RECIPE_A,
        message: 'a'.repeat(4_000),
        intent: 'answer',
      }),
    );
    const rejected = await handler(
      makeRequest('ai-recipe-chat', {
        recipeId: RECIPE_A,
        message: 'a'.repeat(4_001),
        intent: 'answer',
      }),
    );

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: { code: 'validation_failed' },
    });
  });

  it('persists a user question and assistant answer without creating a proposal or changing the recipe', async () => {
    const store = new FakeRecipeConversationStore();
    const before = structuredClone(store.recipes.get(RECIPE_A));
    const provider = new FakeAiProvider({
      answerRecipeQuestion: ok('Use medium heat so the sauce does not split.'),
    });
    const handler = createRecipeChatHandler(chatOptions(store, provider));

    const response = await handler(
      makeRequest('ai-recipe-chat', {
        recipeId: RECIPE_A,
        message: 'Why should I use medium heat?',
        intent: 'answer',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: {
        kind: 'answer',
        content: 'Use medium heat so the sauce does not split.',
      },
    });
    expect(
      store.messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: 'user', content: 'Why should I use medium heat?' },
      {
        role: 'assistant',
        content: 'Use medium heat so the sauce does not split.',
      },
    ]);
    expect(store.proposals).toHaveLength(0);
    expect(store.recipes.get(RECIPE_A)).toEqual(before);
    expect(provider.calls[0]).toMatchObject({
      method: 'answerRecipeQuestion',
      recipe: validRecipeSnapshot,
      question: 'Why should I use medium heat?',
      credentials: CREDENTIALS,
    });
  });

  it('routes modification intent to a validated pending proposal at the current base version', async () => {
    const store = new FakeRecipeConversationStore();
    const provider = new FakeAiProvider({
      proposeRecipeModification: ok(validProposal),
    });
    const handler = createRecipeChatHandler(chatOptions(store, provider));

    const response = await handler(
      makeRequest('ai-recipe-chat', {
        recipeId: RECIPE_A,
        message: 'Make four servings.',
        intent: 'modification',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: { kind: 'proposal', proposal: validProposal },
      baseVersion: 7,
    });
    expect(store.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(store.proposals).toHaveLength(1);
    expect(store.proposals[0]).toMatchObject({
      recipeId: RECIPE_A,
      baseVersion: 7,
      proposal: validProposal,
      status: 'pending',
      messageId: store.messages[1]?.id,
    });
    expect(provider.calls[0]).toMatchObject({
      method: 'proposeRecipeModification',
      recipe: validRecipeSnapshot,
      request: 'Make four servings.',
    });
  });

  it('uses exactly one conversation per recipe and passes only the most recent 20 messages', async () => {
    const store = new FakeRecipeConversationStore();
    const conversationA = await store.getOrCreateConversation(
      RECIPE_A,
      TEST_USER,
    );
    for (let index = 0; index < 25; index += 1) {
      await store.appendMessage({
        conversationId: conversationA.id,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `older-${index}`,
      });
    }
    const provider = new FakeAiProvider({
      answerRecipeQuestion: ok('Current answer.'),
    });
    const handler = createRecipeChatHandler(chatOptions(store, provider));

    const first = await handler(
      makeRequest('ai-recipe-chat', {
        recipeId: RECIPE_A,
        message: 'Current question?',
        intent: 'answer',
      }),
    );
    const second = await handler(
      makeRequest('ai-recipe-chat', {
        recipeId: RECIPE_B,
        message: 'Other recipe question?',
        intent: 'answer',
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(store.conversations).toHaveLength(2);
    expect(store.conversations.get(RECIPE_A)?.id).toBe(conversationA.id);
    expect(store.conversations.get(RECIPE_B)?.id).not.toBe(conversationA.id);
    expect(store.recentMessageLimits).toEqual([20, 20]);

    const answerCall = provider.calls.find(
      (call) =>
        call.method === 'answerRecipeQuestion' &&
        call.question === 'Current question?',
    );
    expect(answerCall).toMatchObject({ method: 'answerRecipeQuestion' });
    if (answerCall?.method !== 'answerRecipeQuestion') {
      throw new Error('expected answerRecipeQuestion call');
    }
    expect(answerCall.recentMessages).toHaveLength(20);
    expect(answerCall.recentMessages[0]?.content).toBe('older-5');
    expect(answerCall.recentMessages[19]?.content).toBe('older-24');
  });
});

describe('ai-propose-modification handler contract', () => {
  it('rejects unauthenticated and schema-invalid requests', async () => {
    const store = new FakeRecipeConversationStore();
    const unauthorized = createProposeModificationHandler(
      proposeOptions(store, new FakeAiProvider(), {
        verifyAuth: failingAuth(),
      }),
    );
    const unauthorizedResponse = await unauthorized(
      makeRequest('ai-propose-modification', {
        recipeId: RECIPE_A,
        request: 'Make it vegetarian.',
      }),
    );
    expect(unauthorizedResponse.status).toBe(401);

    const handler = createProposeModificationHandler(proposeOptions(store));
    const invalidResponse = await handler(
      makeRequest('ai-propose-modification', {
        recipeId: 'not-a-uuid',
        request: '',
      }),
    );
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({
      error: { code: 'validation_failed' },
    });
    expect(store.messages).toHaveLength(0);
    expect(store.proposals).toHaveLength(0);
  });

  it('accepts 4,000 request characters and rejects 4,001', async () => {
    const store = new FakeRecipeConversationStore();
    const handler = createProposeModificationHandler(proposeOptions(store));

    const accepted = await handler(
      makeRequest('ai-propose-modification', {
        recipeId: RECIPE_A,
        request: 'a'.repeat(4_000),
      }),
    );
    const rejected = await handler(
      makeRequest('ai-propose-modification', {
        recipeId: RECIPE_A,
        request: 'a'.repeat(4_001),
      }),
    );

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: { code: 'validation_failed' },
    });
  });

  it('persists a valid proposal as pending against the recipe head version', async () => {
    const store = new FakeRecipeConversationStore();
    const provider = new FakeAiProvider({
      proposeRecipeModification: ok(validProposal),
    });
    const handler = createProposeModificationHandler(
      proposeOptions(store, provider),
    );

    const response = await handler(
      makeRequest('ai-propose-modification', {
        recipeId: RECIPE_A,
        request: 'Make four servings.',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: { kind: 'proposal', proposal: validProposal },
      baseVersion: 7,
      proposalId: expect.any(String),
    });
    expect(store.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(store.proposals).toHaveLength(1);
    expect(store.proposals[0]).toMatchObject({
      recipeId: RECIPE_A,
      baseVersion: 7,
      proposal: validProposal,
      status: 'pending',
      messageId: store.messages[1]?.id,
    });
  });

  it('rejects provider output that fails the modification proposal schema', async () => {
    const invalidProposal = {
      summary: '',
      operations: [],
      resultingRecipe: { ...validProposal.resultingRecipe, servings: 0 },
    };
    const provider = new FakeAiProvider({
      proposeRecipeModification: ok(invalidProposal as never),
    });
    const store = new FakeRecipeConversationStore();
    const handler = createProposeModificationHandler(
      proposeOptions(store, provider),
    );

    const response = await handler(
      makeRequest('ai-propose-modification', {
        recipeId: RECIPE_A,
        request: 'Change everything.',
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_ai_output' },
    });
    expect(store.proposals).toHaveLength(0);
    expect(
      store.messages.filter((message) => message.role === 'assistant'),
    ).toHaveLength(0);
  });

  it('overwrites a schema-valid resultingRecipe that diverges from deterministic operation re-application instead of rejecting it', async () => {
    // Regression test: the AI's own `resultingRecipe` text can legitimately
    // drift from what its `operations` actually produce (the two are
    // independently generated). The server must derive the true result from
    // `operations` and accept the proposal, rather than reject a perfectly
    // valid edit just because the AI's freestanding copy disagreed.
    const divergentResult: ModificationProposal = {
      ...validProposal,
      resultingRecipe: {
        ...validProposal.resultingRecipe,
        title: 'A title no operation produced',
      },
    };
    const provider = new FakeAiProvider({
      proposeRecipeModification: ok(divergentResult),
    });
    const store = new FakeRecipeConversationStore();
    const handler = createProposeModificationHandler(
      proposeOptions(store, provider),
    );

    const response = await handler(
      makeRequest('ai-propose-modification', {
        recipeId: RECIPE_A,
        request: 'Make four servings.',
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome.proposal.resultingRecipe.title).toBe(
      validProposal.resultingRecipe.title,
    );
    expect(store.proposals).toHaveLength(1);
    expect(store.proposals[0]?.proposal.resultingRecipe.title).toBe(
      validProposal.resultingRecipe.title,
    );
  });

  it('rejects operations that reference a position outside the recipe', async () => {
    const outOfRange: ModificationProposal = {
      ...validProposal,
      operations: [{ kind: 'removeIngredient', position: 99 }],
    };
    const provider = new FakeAiProvider({
      proposeRecipeModification: ok(outOfRange),
    });
    const store = new FakeRecipeConversationStore();
    const handler = createProposeModificationHandler(
      proposeOptions(store, provider),
    );

    const response = await handler(
      makeRequest('ai-propose-modification', {
        recipeId: RECIPE_A,
        request: 'Remove an ingredient that does not exist.',
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_ai_output' },
    });
    expect(store.proposals).toHaveLength(0);
    expect(
      store.messages.filter((message) => message.role === 'assistant'),
    ).toHaveLength(0);
  });

  it('returns safe envelopes for missing configuration and provider failures', async () => {
    const missingConfigStore = new FakeRecipeConversationStore();
    const missingConfigHandler = createProposeModificationHandler(
      proposeOptions(missingConfigStore, new FakeAiProvider(), {
        aiConfigReader: aiConfigReader(null),
      }),
    );
    const missingConfigResponse = await missingConfigHandler(
      makeRequest('ai-propose-modification', {
        recipeId: RECIPE_A,
        request: 'Make four servings.',
      }),
    );
    expect(missingConfigResponse.status).toBe(422);
    expect(await missingConfigResponse.json()).toEqual({
      error: {
        code: 'ai_not_configured',
        message: expect.any(String),
      },
    });

    const leakedSecret = 'sk-never-return-this-secret';
    const leakedStack = 'at ProviderClient.request (/private/provider.ts:42:7)';
    const provider = new FakeAiProvider({
      proposeRecipeModification: err({
        code: 'provider_error',
        message: `Provider failed with ${leakedSecret}\n${leakedStack}`,
      }),
    });
    const providerStore = new FakeRecipeConversationStore();
    const providerHandler = createProposeModificationHandler(
      proposeOptions(providerStore, provider),
    );
    const providerResponse = await providerHandler(
      makeRequest('ai-propose-modification', {
        recipeId: RECIPE_A,
        request: 'Make four servings.',
      }),
    );
    const providerBody = await providerResponse.json();

    expect(providerResponse.status).toBe(502);
    expect(providerBody).toEqual({
      error: {
        code: 'provider_error',
        message: 'The AI provider request failed.',
      },
    });
    expect(JSON.stringify(providerBody)).not.toContain(leakedSecret);
    expect(JSON.stringify(providerBody)).not.toContain(leakedStack);
    expect(providerStore.proposals).toHaveLength(0);
  });
});
