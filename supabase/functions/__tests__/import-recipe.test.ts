import { describe, expect, it, vi } from 'vitest';
import {
  createImportRecipeHandler,
  sanitizeHtmlForAi,
  type AiConfigReader,
  type ImportRecipeOptions,
  type SafeFetchFailure,
  type SafeFetchResult,
  type VideoImportFailure,
  type VideoImportSuccess,
} from '../import-recipe/handler.ts';
import {
  err,
  FakeAiProvider,
  makeQuantity,
  ok,
  type RecipeDraft,
} from '../../../packages/contracts/src/index.ts';
import type { AuthVerifier } from '../_shared/http.ts';
import type { AiCredentials } from '../../../packages/contracts/src/index.ts';

const TEST_USER = '00000000-0000-0000-0000-000000000001';

function authVerifier(userId: string = TEST_USER): AuthVerifier {
  return async () => ({ ok: true, userId });
}

function failingAuth(): AuthVerifier {
  return async () => ({ ok: false });
}

function makeRequest(body: unknown, token = 'valid-token'): Request {
  return new Request('http://localhost/import-recipe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function staticFetch(
  result: SafeFetchResult | SafeFetchFailure,
): ImportRecipeOptions['safeFetch'] {
  return async () => result;
}

function staticVideoImport(
  result: VideoImportSuccess | VideoImportFailure,
): ImportRecipeOptions['videoImport'] {
  return {
    fetchMetadata: vi.fn().mockResolvedValue(result),
  };
}

function fakeAiConfigReader(
  credentials: AiCredentials | null,
): AiConfigReader {
  return {
    async getConfig(_userId) {
      return credentials
        ? { configured: true, credentials }
        : { configured: false };
    },
  };
}

const VALID_AI_DRAFT: RecipeDraft = {
  title: 'AI Pasta',
  description: 'A generated pasta recipe.',
  servings: 4,
  prepTimeMinutes: 10,
  cookTimeMinutes: 20,
  sourceName: null,
  sourceUrl: null,
  ingredients: [
    { name: 'Spaghetti', quantity: makeQuantity(1, 2), unit: 'lb' },
    { name: 'Tomato sauce', quantity: makeQuantity(2, 1), unit: 'cups' },
  ],
  steps: [
    { text: 'Boil the pasta.' },
    { text: 'Heat the sauce and combine.' },
  ],
  tags: ['pasta'],
};

const JSON_LD_HTML = `<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Markup Pancakes",
        "recipeYield": "4",
        "recipeIngredient": ["1 1/2 cups flour", "1 cup milk"],
        "recipeInstructions": [{"@type": "HowToStep", "text": "Mix and cook."}]
      }
    </script>
  </head>
</html>`;

const NO_MARKUP_HTML = `<!doctype html>
<html><head><title>No recipe</title></head><body>About us.</body></html>`;

describe('import-recipe handler', () => {
  it('requires POST and rejects other methods', async () => {
    const handler = createImportRecipeHandler({
      verifyAuth: authVerifier(),
      provider: new FakeAiProvider(),
      safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
      aiConfigReader: fakeAiConfigReader(null),
      videoImport: staticVideoImport({
        ok: false,
        errorCode: 'fetch_failed',
        message: '',
      }),
    });
    const response = await handler(
      new Request('http://localhost/import-recipe', { method: 'GET' }),
    );
    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.error.code).toBe('method_not_allowed');
  });

  it('rejects unauthenticated requests', async () => {
    const handler = createImportRecipeHandler({
      verifyAuth: failingAuth(),
      provider: new FakeAiProvider(),
      safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
      aiConfigReader: fakeAiConfigReader(null),
      videoImport: staticVideoImport({
        ok: false,
        errorCode: 'fetch_failed',
        message: '',
      }),
    });
    const response = await handler(makeRequest({ mode: 'text', text: 'recipe' }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('unauthorized');
  });

  it('validates the request body', async () => {
    const handler = createImportRecipeHandler({
      verifyAuth: authVerifier(),
      provider: new FakeAiProvider(),
      safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
      aiConfigReader: fakeAiConfigReader(null),
      videoImport: staticVideoImport({
        ok: false,
        errorCode: 'fetch_failed',
        message: '',
      }),
    });
    const response = await handler(makeRequest({ mode: 'unknown' }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('validation_failed');
  });

  describe('URL mode', () => {
    it('returns structured_markup draft from JSON-LD without calling AI', async () => {
      const provider = new FakeAiProvider();
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({
          ok: true,
          html: JSON_LD_HTML,
          finalUrl: 'https://example.com/pancakes',
        }),
        aiConfigReader: fakeAiConfigReader(null),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://example.com/pancakes' }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.extractionMethod).toBe('structured_markup');
      expect(body.draft.title).toBe('Markup Pancakes');
      expect(body.draft.sourceUrl).toBe('https://example.com/pancakes');
      expect(provider.calls).toHaveLength(0);
    });

    it('falls back to AI when JSON-LD is absent and AI is configured', async () => {
      const provider = new FakeAiProvider({ extractRecipe: ok(VALID_AI_DRAFT) });
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({
          ok: true,
          html: NO_MARKUP_HTML,
          finalUrl: 'https://example.com/about',
        }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://example.com/about' }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.extractionMethod).toBe('ai');
      expect(body.draft.title).toBe('AI Pasta');
      expect(provider.calls).toHaveLength(1);
      const call = provider.calls[0];
      expect(call?.method).toBe('extractRecipe');
      expect(call?.rawContent).toContain('No recipe');
    });

    it('returns ai_not_configured when JSON-LD is absent and AI is unconfigured', async () => {
      const provider = new FakeAiProvider();
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({
          ok: true,
          html: NO_MARKUP_HTML,
          finalUrl: 'https://example.com/about',
        }),
        aiConfigReader: fakeAiConfigReader(null),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://example.com/about' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('ai_not_configured');
      expect(provider.calls).toHaveLength(0);
    });

    it('returns no_recipe_found when AI extraction produces nothing usable', async () => {
      const provider = new FakeAiProvider({
        extractRecipe: err({ code: 'invalid_ai_output', message: 'No recipe found.' }),
      });
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({
          ok: true,
          html: NO_MARKUP_HTML,
          finalUrl: 'https://example.com/about',
        }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://example.com/about' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('invalid_ai_output');
    });

    it('returns unsupported_url for non-https URLs', async () => {
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider: new FakeAiProvider(),
        safeFetch: staticFetch({
          ok: false,
          errorCode: 'unsupported_url',
          message: 'Only https:// URLs can be imported.',
        }),
        aiConfigReader: fakeAiConfigReader(null),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'http://example.com/recipe' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('unsupported_url');
    });

    it('returns fetch_failed when the page cannot be fetched', async () => {
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider: new FakeAiProvider(),
        safeFetch: staticFetch({
          ok: false,
          errorCode: 'fetch_failed',
          message: 'The page could not be fetched.',
        }),
        aiConfigReader: fakeAiConfigReader(null),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://example.com/recipe' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('fetch_failed');
    });

    it('routes Instagram Reels to the video metadata service and returns extractionMethod video_metadata', async () => {
      const provider = new FakeAiProvider({ extractRecipe: ok(VALID_AI_DRAFT) });
      const safeFetch = vi.fn().mockResolvedValue({
        ok: false,
        errorCode: 'fetch_failed',
        message: '',
      } satisfies SafeFetchFailure);
      const videoImport = {
        fetchMetadata: vi.fn().mockResolvedValue({
          ok: true,
          title: 'Weeknight Pasta',
          description: '1 lb pasta, tomato sauce, basil.',
        } satisfies VideoImportSuccess),
      };
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch,
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport,
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://www.instagram.com/reel/Da5N3vyovxI/' }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.extractionMethod).toBe('video_metadata');
      expect(videoImport.fetchMetadata).toHaveBeenCalledWith(
        'https://www.instagram.com/reel/Da5N3vyovxI/',
      );
      expect(safeFetch).not.toHaveBeenCalled();
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]?.rawContent).toContain('1 lb pasta');
    });

    it('routes TikTok videos to the video metadata service', async () => {
      const provider = new FakeAiProvider({ extractRecipe: ok(VALID_AI_DRAFT) });
      const videoImport = {
        fetchMetadata: vi.fn().mockResolvedValue({
          ok: true,
          title: 'TikTok Lentils',
          description: '2 cups lentils, simmer 20 minutes.',
        } satisfies VideoImportSuccess),
      };
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport,
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://www.tiktok.com/@cook/video/12345' }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.extractionMethod).toBe('video_metadata');
      expect(videoImport.fetchMetadata).toHaveBeenCalledWith(
        'https://www.tiktok.com/@cook/video/12345',
      );
    });

    it('routes YouTube Shorts to the video metadata service', async () => {
      const provider = new FakeAiProvider({ extractRecipe: ok(VALID_AI_DRAFT) });
      const videoImport = {
        fetchMetadata: vi.fn().mockResolvedValue({
          ok: true,
          title: 'Shorts Chili',
          description: 'Beans, tomatoes, chili powder.',
        } satisfies VideoImportSuccess),
      };
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport,
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://www.youtube.com/shorts/abc123' }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.extractionMethod).toBe('video_metadata');
      expect(videoImport.fetchMetadata).toHaveBeenCalledWith(
        'https://www.youtube.com/shorts/abc123',
      );
    });

    it('keeps unsupported-platform handling for Facebook video links', async () => {
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider: new FakeAiProvider(),
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader(null),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://www.facebook.com/watch/?v=123' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('unsupported_url');
    });

    it('returns a clear recoverable failure when video metadata extraction is blocked upstream', async () => {
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider: new FakeAiProvider(),
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message:
            'Instagram Reel metadata is currently blocked upstream. Copy the caption or description and use paste text instead.',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://www.instagram.com/reel/C9abc123/' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('fetch_failed');
      expect(body.error.message).toContain('Copy the caption or description');
    });

    it('returns no_recipe_found when a supported video has no usable description metadata', async () => {
      const provider = new FakeAiProvider({ extractRecipe: ok(VALID_AI_DRAFT) });
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport: staticVideoImport({
          ok: true,
          title: 'No Caption',
          description: '   ',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://www.youtube.com/shorts/abc123' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('no_recipe_found');
      expect(provider.calls).toHaveLength(0);
    });

    it('maps invalid AI output from video metadata extraction to no_recipe_found', async () => {
      const provider = new FakeAiProvider({
        extractRecipe: err({
          code: 'invalid_ai_output',
          message: 'No recipe found.',
        }),
      });
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport: staticVideoImport({
          ok: true,
          title: 'Sparse Caption',
          description: 'Follow for more recipes.',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://www.tiktok.com/@cook/video/12345' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('no_recipe_found');
      expect(body.error.message).toContain('Paste text');
    });

    it('propagates SSRF blocked_address as unsupported_url', async () => {
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider: new FakeAiProvider(),
        safeFetch: staticFetch({
          ok: false,
          errorCode: 'unsupported_url',
          message: 'The URL points to a non-public network address.',
        }),
        aiConfigReader: fakeAiConfigReader(null),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'url', url: 'https://192.168.1.1/recipe' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('unsupported_url');
    });
  });

  describe('text mode', () => {
    it('extracts a draft via AI and returns extractionMethod ai', async () => {
      const provider = new FakeAiProvider({ extractRecipe: ok(VALID_AI_DRAFT) });
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'text', text: 'Pasta with tomato sauce.' }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.extractionMethod).toBe('ai');
      expect(body.draft.title).toBe('AI Pasta');
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]?.rawContent).toBe('Pasta with tomato sauce.');
    });

    it('returns ai_not_configured when AI is unconfigured', async () => {
      const provider = new FakeAiProvider();
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader(null),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'text', text: 'Some recipe text.' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('ai_not_configured');
      expect(provider.calls).toHaveLength(0);
    });

    it('rejects invalid AI output that fails schema validation', async () => {
      const provider = new FakeAiProvider({
        extractRecipe: ok({
          ...VALID_AI_DRAFT,
          ingredients: [],
        } as unknown as RecipeDraft),
      });
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'text', text: 'Bad recipe.' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('invalid_ai_output');
    });

    it('returns provider_error when the AI provider fails', async () => {
      const provider = new FakeAiProvider({
        extractRecipe: err({
          code: 'provider_error',
          message: 'Provider unreachable.',
        }),
      });
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
        videoImport: staticVideoImport({
          ok: false,
          errorCode: 'fetch_failed',
          message: '',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'text', text: 'Recipe text.' }),
      );
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error.code).toBe('provider_error');
    });
  });

  describe('sanitizeHtmlForAi', () => {
    it('removes scripts, styles, and tags and collapses whitespace', () => {
      const html = `<!doctype html>
<html>
  <head>
    <style>.red { color: red; }</style>
  </head>
  <body>
    <script>alert('xss')</script>
    <h1>Recipe</h1>
    <p>Step 1</p>
  </body>
</html>`;
      const sanitized = sanitizeHtmlForAi(html);
      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('<style');
      expect(sanitized).not.toContain('<h1>');
      expect(sanitized).toContain('Recipe');
      expect(sanitized).toContain('Step 1');
    });
  });

  describe('schema validation', () => {
    it('validates the returned draft against recipeDraftSchema', async () => {
      const badDraft = {
        ...VALID_AI_DRAFT,
        title: '',
      } as RecipeDraft;
      const provider = new FakeAiProvider({ extractRecipe: ok(badDraft) });
      const handler = createImportRecipeHandler({
        verifyAuth: authVerifier(),
        provider,
        safeFetch: staticFetch({ ok: false, errorCode: 'fetch_failed', message: '' }),
        aiConfigReader: fakeAiConfigReader({
          apiKey: 'sk-test',
          model: 'gpt-4o-mini',
        }),
      });
      const response = await handler(
        makeRequest({ mode: 'text', text: 'Recipe.' }),
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe('invalid_ai_output');
    });
  });
});
