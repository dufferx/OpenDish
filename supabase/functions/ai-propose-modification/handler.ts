import { z } from 'zod';
import {
  type AiCredentials,
  type AiError,
  type AiProvider,
  type ConversationMessage,
  type MessageRole,
  type ModificationProposal,
  type RecipeSnapshot,
} from '../../../packages/contracts/src/index.ts';
import {
  errorResponse,
  handleRequest,
  jsonResponse,
  type AuthVerifier,
} from '../_shared/http.ts';
import { validateModificationProposal } from '../_shared/recipe-modification.ts';

const bodySchema = z.object({
  recipeId: z.string().uuid(),
  request: z.string().trim().min(1).max(4_000),
});

export interface AiConfigReader {
  getConfig(
    userId: string,
  ): Promise<
    { configured: true; credentials: AiCredentials } | { configured: false }
  >;
}

export interface RecipeConversation {
  id: string;
  recipeId: string;
  userId: string;
}

export interface StoredConversationMessage extends ConversationMessage {
  id: string;
  conversationId: string;
  position: number;
}

export interface PendingProposalRecord {
  id: string;
  conversationId: string;
  messageId: string;
  recipeId: string;
  baseVersion: number;
  proposal: ModificationProposal;
  status: 'pending';
}

export interface RecipeConversationStore {
  getRecipeSnapshot(
    recipeId: string,
    userId: string,
  ): Promise<{ snapshot: RecipeSnapshot; headVersion: number } | null>;
  getOrCreateConversation(
    recipeId: string,
    userId: string,
  ): Promise<RecipeConversation>;
  getRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<ConversationMessage[]>;
  appendMessage(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
  }): Promise<StoredConversationMessage>;
  createPendingProposal(input: {
    conversationId: string;
    messageId: string;
    recipeId: string;
    baseVersion: number;
    proposal: ModificationProposal;
  }): Promise<PendingProposalRecord>;
}

export interface ProposeModificationOptions {
  verifyAuth: AuthVerifier;
  provider: AiProvider;
  aiConfigReader: AiConfigReader;
  store: RecipeConversationStore;
}

function statusForAiError(error: AiError): number {
  if (error.code === 'invalid_ai_output') return 422;
  if (error.code === 'timeout') return 504;
  return 502;
}

function safeAiError(error: AiError): Response {
  if (error.code === 'invalid_ai_output') {
    return errorResponse(
      422,
      'invalid_ai_output',
      'The AI provider returned an invalid modification.',
    );
  }
  if (error.code === 'timeout') {
    return errorResponse(
      statusForAiError(error),
      'provider_error',
      'The AI provider request timed out.',
    );
  }
  if (error.code === 'invalid_credentials') {
    return errorResponse(
      statusForAiError(error),
      'provider_error',
      'The configured AI provider rejected the API key.',
    );
  }
  return errorResponse(
    statusForAiError(error),
    'provider_error',
    'The AI provider request failed.',
  );
}

export interface ProposalTurnInput {
  recipeId: string;
  request: string;
  userId: string;
  recipe: { snapshot: RecipeSnapshot; headVersion: number };
  conversation: RecipeConversation;
  credentials: AiCredentials;
  /** Chat already persisted the user message before delegating here. */
  userMessageAlreadyPersisted?: boolean;
}

/** Shared proposal turn used by both public handlers. */
export async function runProposalTurn(
  options: Pick<ProposeModificationOptions, 'provider' | 'store'>,
  input: ProposalTurnInput,
): Promise<Response> {
  if (!input.userMessageAlreadyPersisted) {
    await options.store.appendMessage({
      conversationId: input.conversation.id,
      role: 'user',
      content: input.request,
    });
  }

  const providerResult = await options.provider.proposeRecipeModification(
    input.recipe.snapshot,
    input.request,
    input.credentials,
  );
  if (!providerResult.ok) return safeAiError(providerResult.error);

  const validated = validateModificationProposal(
    input.recipe.snapshot,
    providerResult.value,
  );
  if (!validated.ok) {
    return errorResponse(
      422,
      'invalid_ai_output',
      'The AI provider returned an incoherent modification.',
    );
  }

  const assistantMessage = await options.store.appendMessage({
    conversationId: input.conversation.id,
    role: 'assistant',
    content: validated.proposal.summary,
  });
  const record = await options.store.createPendingProposal({
    conversationId: input.conversation.id,
    messageId: assistantMessage.id,
    recipeId: input.recipeId,
    baseVersion: input.recipe.headVersion,
    proposal: validated.proposal,
  });

  return jsonResponse({
    conversationId: input.conversation.id,
    proposalId: record.id,
    baseVersion: input.recipe.headVersion,
    outcome: { kind: 'proposal', proposal: validated.proposal },
  });
}

export function createProposeModificationHandler(
  options: ProposeModificationOptions,
) {
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
          'AI is not configured. Configure it in settings to modify recipes.',
        );
      }

      const conversation = await options.store.getOrCreateConversation(
        body.recipeId,
        ctx.userId,
      );
      return runProposalTurn(options, {
        recipeId: body.recipeId,
        request: body.request,
        userId: ctx.userId,
        recipe,
        conversation,
        credentials: config.credentials,
      });
    },
  });
}
