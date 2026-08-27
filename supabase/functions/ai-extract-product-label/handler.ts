import { z } from 'zod';
import {
  type AiCredentials,
  type AiError,
  type AiProvider,
  type ProductLabelDraft,
} from '../../../packages/contracts/src/index.ts';
import {
  errorResponse,
  handleRequest,
  jsonResponse,
  type AuthVerifier,
} from '../_shared/http.ts';

const imageDataUrlSchema = z
  .string()
  .max(10_000_000)
  .refine(
    (value) => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value),
    'Only base64 JPEG, PNG, or WebP images are supported.',
  );

const bodySchema = z.object({ imageDataUrl: imageDataUrlSchema });

export interface AiConfigReader {
  getConfig(
    userId: string,
  ): Promise<{ configured: true; credentials: AiCredentials } | { configured: false }>;
}

export interface ProductLabelOptions {
  verifyAuth: AuthVerifier;
  provider: AiProvider;
  aiConfigReader: AiConfigReader;
}

function safeAiError(error: AiError): Response {
  if (error.code === 'invalid_ai_output') {
    return errorResponse(422, 'invalid_ai_output', 'The label could not be read into valid fields.');
  }
  if (error.code === 'timeout') {
    return errorResponse(504, 'provider_error', 'The AI provider request timed out.');
  }
  if (error.code === 'invalid_credentials') {
    return errorResponse(502, 'provider_error', 'The configured AI provider rejected the API key.');
  }
  return errorResponse(502, 'provider_error', 'The AI provider request failed.');
}

export function createProductLabelHandler(options: ProductLabelOptions) {
  return handleRequest({
    schema: bodySchema,
    verifyAuth: options.verifyAuth,
    handler: async (body, ctx) => {
      const config = await options.aiConfigReader.getConfig(ctx.userId);
      if (!config.configured) {
        return errorResponse(409, 'ai_not_configured', 'AI is not configured. Configure it in settings to read labels.');
      }
      const result = await options.provider.extractProductLabel(
        body.imageDataUrl,
        config.credentials,
      );
      if (!result.ok) return safeAiError(result.error);
      return jsonResponse({ draft: result.value, requiresConfirmation: true });
    },
  });
}

export type { ProductLabelDraft };
