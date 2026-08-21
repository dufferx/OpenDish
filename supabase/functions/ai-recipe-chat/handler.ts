import { z } from 'zod';
import { type AiProvider } from '../../../packages/contracts/src/index.ts';
import {
  errorResponse,
  handleRequest,
  jsonResponse,
  type AuthVerifier,
} from '../_shared/http.ts';
import {
  runProposalTurn,
  type AiConfigReader,
  type RecipeConversationStore,
} from '../ai-propose-modification/handler.ts';

const bodySchema = z.object({
  recipeId: z.string().uuid(),
  message: z.string().trim().min(1).max(4_000),
  intent: z.enum(['answer', 'modification']).default('answer'),
});

export interface RecipeChatOptions {
  verifyAuth: AuthVerifier;
  provider: AiProvider;
  aiConfigReader: AiConfigReader;
  store: RecipeConversationStore;
}

export function createRecipeChatHandler(options: RecipeChatOptions) {
  return handleRequest({
    schema: bodySchema,
    verifyAuth: options.verifyAuth,
    handler: async (body, ctx) => {
      const recipe = await options.store.getRecipeSnapshot(
        body.recipeId,
        ctx.userId,
      );
      if (!recipe) {
        return errorResponse(404, 'recipe_not_found', 'Recipe not found.');
      }

      const config = await options.aiConfigReader.getConfig(ctx.userId);
      if (!config.configured) {
        return errorResponse(
          422,
          'ai_not_configured',
          'AI is not configured. Configure it in settings to use recipe chat.',
        );
      }

      const conversation = await options.store.getOrCreateConversation(
        body.recipeId,
        ctx.userId,
      );
      // Provider context deliberately excludes the current message because it
      // is passed as its own argument. Read before append to prevent duplication.
      const recentMessages = await options.store.getRecentMessages(
        conversation.id,
        20,
      );
      await options.store.appendMessage({
        conversationId: conversation.id,
        role: 'user',
        content: body.message,
      });

      if (body.intent === 'modification') {
        return runProposalTurn(options, {
          recipeId: body.recipeId,
          request: body.message,
          userId: ctx.userId,
          recipe,
          conversation,
          credentials: config.credentials,
          userMessageAlreadyPersisted: true,
        });
      }

      const providerResult = await options.provider.answerRecipeQuestion(
        recipe.snapshot,
        recentMessages,
        body.message,
        config.credentials,
      );
      if (!providerResult.ok) {
        if (providerResult.error.code === 'timeout') {
          return errorResponse(
            504,
            'provider_error',
            'The AI provider request timed out.',
          );
        }
        if (providerResult.error.code === 'invalid_ai_output') {
          return errorResponse(
            422,
            'invalid_ai_output',
            'The AI provider returned an invalid answer.',
          );
        }
        return errorResponse(
          502,
          'provider_error',
          providerResult.error.code === 'invalid_credentials'
            ? 'The configured AI provider rejected the API key.'
            : 'The AI provider request failed.',
        );
      }

      if (
        typeof providerResult.value !== 'string' ||
        providerResult.value.trim() === ''
      ) {
        return errorResponse(
          422,
          'invalid_ai_output',
          'The AI provider returned an invalid answer.',
        );
      }

      const content = providerResult.value.trim();
      await options.store.appendMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content,
      });
      return jsonResponse({
        conversationId: conversation.id,
        outcome: { kind: 'answer', content },
      });
    },
  });
}
