import { describe, expect, it } from 'vitest';
import { createOpenAiProvider } from '../_shared/openai-provider.ts';
import type { FetchLike } from '../_shared/openai-provider.ts';
import type { AiCredentials } from '../../../packages/contracts/src/index.ts';
import { validRecipeDraft } from '../../../packages/contracts/src/index.ts';

const credentials: AiCredentials = {
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
};

function makeResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function staticFetch(response: Response): FetchLike {
  return async () => response;
}

function chatCompletionPayload(content: string): unknown {
  return {
    choices: [{ message: { content } }],
  };
}

function validDraftJson(): unknown {
  return {
    title: validRecipeDraft.title,
    description: validRecipeDraft.description,
    servings: validRecipeDraft.servings,
    prepTimeMinutes: validRecipeDraft.prepTimeMinutes,
    cookTimeMinutes: validRecipeDraft.cookTimeMinutes,
    sourceName: validRecipeDraft.sourceName,
    sourceUrl: validRecipeDraft.sourceUrl,
    ingredients: validRecipeDraft.ingredients,
    steps: validRecipeDraft.steps,
    tags: validRecipeDraft.tags,
  };
}

describe('createOpenAiProvider', () => {
  describe('validateCredentials', () => {
    it('returns ok when /models succeeds', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(makeResponse({ data: [] })),
      });
      const result = await provider.validateCredentials(credentials);
      expect(result.ok).toBe(true);
    });

    it('maps 401 to invalid_credentials', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(makeResponse({ error: 'bad key' }, 401)),
      });
      const result = await provider.validateCredentials(credentials);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_credentials');
      }
    });

    it('maps 403 to invalid_credentials', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(makeResponse({ error: 'forbidden' }, 403)),
      });
      const result = await provider.validateCredentials(credentials);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_credentials');
      }
    });

    it('maps 429 to provider_error', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(makeResponse({ error: 'rate limited' }, 429)),
      });
      const result = await provider.validateCredentials(credentials);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider_error');
      }
    });

    it('maps 500 to provider_error', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(makeResponse({ error: 'server error' }, 500)),
      });
      const result = await provider.validateCredentials(credentials);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider_error');
      }
    });
  });

  describe('generateRecipe', () => {
    it('returns a draft when AI emits schema-valid JSON', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(
          makeResponse(
            chatCompletionPayload(
              JSON.stringify({ kind: 'draft', draft: validDraftJson() }),
            ),
          ),
        ),
      });
      const result = await provider.generateRecipe([], credentials);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('draft');
      if (result.value.kind !== 'draft') return;
      expect(result.value.draft.title).toBe(validRecipeDraft.title);
    });

    it('returns a clarify outcome when AI emits schema-valid JSON', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(
          makeResponse(
            chatCompletionPayload(
              JSON.stringify({ kind: 'clarify', question: 'What protein?' }),
            ),
          ),
        ),
      });
      const result = await provider.generateRecipe([], credentials);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('clarify');
      if (result.value.kind !== 'clarify') return;
      expect(result.value.question).toBe('What protein?');
    });

    it('returns invalid_ai_output for non-JSON content', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(
          makeResponse(chatCompletionPayload('not json')),
        ),
      });
      const result = await provider.generateRecipe([], credentials);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_ai_output');
      }
    });

    it('returns invalid_ai_output for JSON that fails schema validation', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(
          makeResponse(
            chatCompletionPayload(
              JSON.stringify({
                kind: 'draft',
                draft: { title: 'Bad', ingredients: [] },
              }),
            ),
          ),
        ),
      });
      const result = await provider.generateRecipe([], credentials);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_ai_output');
      }
    });

    it('propagates HTTP errors without surfacing provider payloads', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(makeResponse({ error: 'bad key' }, 401)),
      });
      const result = await provider.generateRecipe([], credentials);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_credentials');
        expect(result.error.message).not.toContain('bad key');
      }
    });
  });

  describe('extractRecipe', () => {
    it('returns a draft for schema-valid AI JSON', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(
          makeResponse(chatCompletionPayload(JSON.stringify(validDraftJson()))),
        ),
      });
      const result = await provider.extractRecipe('some raw text', credentials);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.title).toBe(validRecipeDraft.title);
    });

    it('returns invalid_ai_output when AI JSON misses required fields', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(
          makeResponse(
            chatCompletionPayload(
              JSON.stringify({ title: 'Only title' }),
            ),
          ),
        ),
      });
      const result = await provider.extractRecipe('raw', credentials);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_ai_output');
      }
    });
  });

  describe('answerRecipeQuestion', () => {
    it('returns trimmed answer text', async () => {
      const provider = createOpenAiProvider({
        fetchFn: staticFetch(
          makeResponse(
            chatCompletionPayload('  It takes about 10 minutes.  '),
          ),
        ),
      });
      const result = await provider.answerRecipeQuestion(
        { ...validRecipeDraft, imagePath: null },
        [],
        'How long?',
        credentials,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe('It takes about 10 minutes.');
    });
  });

  describe('timeout handling', () => {
    it('returns timeout when the fetch aborts', async () => {
      const fetchFn: FetchLike = async () => {
        const error = new Error('AbortError');
        error.name = 'AbortError';
        throw error;
      };
      const provider = createOpenAiProvider({ fetchFn });
      const result = await provider.validateCredentials(credentials);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('timeout');
      }
    });
  });
});
