import { z } from 'zod';
import {
  recipeDraftSchema,
  type AiCredentials,
  type AiError,
  type AiProvider,
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
  draft: recipeDraftSchema,
  request: z.string().trim().min(1).max(4_000),
});

export interface AiConfigReader {
  getConfig(userId: string): Promise<
    | { configured: true; credentials: AiCredentials }
    | { configured: false }
  >;
}

function safeAiError(error: AiError): Response {
  if (error.code === 'invalid_ai_output') {
    return errorResponse(
      422,
      'invalid_ai_output',
      'The AI provider returned an invalid recipe change.',
    );
  }
  if (error.code === 'timeout') {
    return errorResponse(504, 'provider_error', 'The AI provider request timed out.');
  }
  return errorResponse(502, 'provider_error', 'The AI provider request failed.');
}

export function createPreviewModificationHandler(options: {
  verifyAuth: AuthVerifier;
  provider: AiProvider;
  aiConfigReader: AiConfigReader;
}) {
  return handleRequest({
    schema: bodySchema,
    verifyAuth: options.verifyAuth,
    handler: async (body, ctx) => {
      const config = await options.aiConfigReader.getConfig(ctx.userId);
      if (!config.configured) {
        return errorResponse(
          409,
          'ai_not_configured',
          'AI is not configured. Configure it in settings to modify recipes.',
        );
      }

      const snapshot: RecipeSnapshot = { ...body.draft, imagePath: null };
      const result = await options.provider.proposeRecipeModification(
        snapshot,
        body.request,
        config.credentials,
      );
      if (!result.ok) return safeAiError(result.error);

      const validated = validateModificationProposal(snapshot, result.value);
      if (!validated.ok) {
        return errorResponse(
          422,
          'invalid_ai_output',
          'The AI provider returned an incoherent modification.',
        );
      }

      return jsonResponse({ outcome: { kind: 'proposal', proposal: validated.proposal } });
    },
  });
}
