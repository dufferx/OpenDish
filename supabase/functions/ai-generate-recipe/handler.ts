import { z } from 'zod';
import {
  recipeDraftSchema,
  type AiError,
  type AiProvider,
  type ConversationMessage,
  type GenerateRecipeOutcome,
  type MessageRole,
} from '../../../packages/contracts/src/index.ts';
import {
  errorResponse,
  handleRequest,
  jsonResponse,
  type AuthVerifier,
} from '../_shared/http.ts';

const bodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4_000),
});

export interface GenerationConversation {
  id: string;
  userId: string;
  kind: 'generation';
}

export interface StoredConversationMessage extends ConversationMessage {
  id: string;
  conversationId: string;
  position: number;
}

export interface AiConfigReader {
  getConfig(
    userId: string,
  ): Promise<
    | { configured: true; credentials: { apiKey: string; model: string; baseUrl?: string } }
    | { configured: false }
  >;
}

export interface GenerationConversationStore {
  createConversation(userId: string): Promise<GenerationConversation>;
  getConversation(
    conversationId: string,
    userId: string,
  ): Promise<GenerationConversation | null>;
  getRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<ConversationMessage[]>;
  appendMessage(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
  }): Promise<StoredConversationMessage>;
}

export interface GenerateRecipeOptions {
  verifyAuth: AuthVerifier;
  provider: AiProvider;
  aiConfigReader: AiConfigReader;
  store: GenerationConversationStore;
}

function safeAiError(error: AiError): Response {
  if (error.code === 'invalid_ai_output') {
    return errorResponse(
      422,
      'invalid_ai_output',
      'The AI provider returned an invalid recipe draft.',
    );
  }
  if (error.code === 'timeout') {
    return errorResponse(
      504,
      'provider_error',
      'The AI provider request timed out.',
    );
  }
  if (error.code === 'invalid_credentials') {
    return errorResponse(
      502,
      'provider_error',
      'The configured AI provider rejected the API key.',
    );
  }
  return errorResponse(502, 'provider_error', 'The AI provider request failed.');
}

export function createGenerateRecipeHandler(options: GenerateRecipeOptions) {
  return handleRequest({
    schema: bodySchema,
    verifyAuth: options.verifyAuth,
    handler: async (body, ctx) => {
      const conversation = body.conversationId
        ? await options.store.getConversation(body.conversationId, ctx.userId)
        : await options.store.createConversation(ctx.userId);

      if (!conversation || conversation.kind !== 'generation') {
        return errorResponse(
          404,
          'conversation_not_found',
          'Conversation not found.',
        );
      }

      const config = await options.aiConfigReader.getConfig(ctx.userId);
      if (!config.configured) {
        return errorResponse(
          409,
          'ai_not_configured',
          'AI is not configured. Configure it in settings to generate recipes.',
        );
      }

      await options.store.appendMessage({
        conversationId: conversation.id,
        role: 'user',
        content: body.message,
      });

      const recentMessages = await options.store.getRecentMessages(
        conversation.id,
        20,
      );
      const providerResult = await options.provider.generateRecipe(
        recentMessages,
        config.credentials,
      );
      if (!providerResult.ok) {
        return safeAiError(providerResult.error);
      }

      const outcome = providerResult.value;
      if (outcome.kind === 'clarify') {
        await options.store.appendMessage({
          conversationId: conversation.id,
          role: 'assistant',
          content: outcome.question,
        });
        return jsonResponse({
          conversationId: conversation.id,
          outcome: { kind: 'clarify', question: outcome.question },
        });
      }

      const draftValidation = recipeDraftSchema.safeParse(outcome.draft);
      if (!draftValidation.success) {
        return errorResponse(
          422,
          'invalid_ai_output',
          'The AI provider returned an invalid recipe draft.',
        );
      }

      const summary = `Here's a draft recipe for ${draftValidation.data.title}.`;
      await options.store.appendMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: summary,
      });

      const responseOutcome: GenerateRecipeOutcome = {
        kind: 'draft',
        draft: draftValidation.data,
      };
      return jsonResponse({
        conversationId: conversation.id,
        outcome: responseOutcome,
      });
    },
  });
}
