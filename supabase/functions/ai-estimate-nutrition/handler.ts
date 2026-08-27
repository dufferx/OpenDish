import { z } from 'zod';
import {
  type AiCredentials,
  type AiError,
  type AiProvider,
  nutritionEstimateIngredientSchema,
} from '../../../packages/contracts/src/index.ts';
import { errorResponse, handleRequest, jsonResponse, type AuthVerifier } from '../_shared/http.ts';

const bodySchema = z.object({
  ingredients: z.array(nutritionEstimateIngredientSchema).min(1).max(100),
});

export interface AiConfigReader {
  getConfig(userId: string): Promise<{ configured: true; credentials: AiCredentials } | { configured: false }>;
}

function safeAiError(error: AiError): Response {
  if (error.code === 'invalid_ai_output') return errorResponse(422, 'invalid_ai_output', 'The AI returned an unusable nutrition estimate.');
  if (error.code === 'timeout') return errorResponse(504, 'provider_error', 'The AI provider request timed out.');
  return errorResponse(502, 'provider_error', 'The AI provider request failed.');
}

export function createNutritionEstimateHandler(options: { verifyAuth: AuthVerifier; provider: AiProvider; aiConfigReader: AiConfigReader }) {
  return handleRequest({
    schema: bodySchema,
    verifyAuth: options.verifyAuth,
    handler: async (body, ctx) => {
      const config = await options.aiConfigReader.getConfig(ctx.userId);
      if (!config.configured) return errorResponse(409, 'ai_not_configured', 'AI is not configured. Configure it in settings to estimate nutrition.');
      const result = await options.provider.estimateNutrition(body.ingredients, config.credentials);
      if (!result.ok) return safeAiError(result.error);
      return jsonResponse({ items: result.value, status: 'estimated' });
    },
  });
}
