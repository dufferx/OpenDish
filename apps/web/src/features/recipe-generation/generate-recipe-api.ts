import type { GenerateRecipeOutcome } from '@opendish/contracts';

import { supabase } from '@/lib/supabase';

export type GenerateRecipeErrorCode =
  | 'ai_not_configured'
  | 'provider_error'
  | 'invalid_ai_output'
  | 'conversation_not_found'
  | 'validation_failed';

export class GenerateRecipeError extends Error {
  readonly code: GenerateRecipeErrorCode;

  constructor(code: GenerateRecipeErrorCode, message: string) {
    super(message);
    this.name = 'GenerateRecipeError';
    this.code = code;
  }
}

interface FunctionsHttpErrorContext {
  json(): Promise<unknown>;
}

interface FunctionsHttpError {
  context?: FunctionsHttpErrorContext;
  message: string;
}

function isFunctionsHttpError(error: unknown): error is FunctionsHttpError {
  return typeof error === 'object' && error !== null && 'message' in error;
}

export interface GenerateRecipeTurnResult {
  conversationId: string;
  outcome: GenerateRecipeOutcome;
}

/**
 * Invokes the ai-generate-recipe Edge Function. The returned draft is
 * presented in the review screen; nothing is persisted until the user
 * explicitly saves.
 */
export async function generateRecipeTurn(
  body: {
    conversationId?: string;
    message: string;
  },
  signal?: AbortSignal,
): Promise<GenerateRecipeTurnResult> {
  const { data, error } = await supabase.functions.invoke(
    'ai-generate-recipe',
    {
      body,
      signal,
    },
  );

  if (error) {
    const httpError = isFunctionsHttpError(error) ? error : null;
    const payload = httpError?.context
      ? await httpError.context.json().catch(() => null)
      : null;
    const errorBody = (
      payload as { error?: { code?: string; message?: string } } | null
    )?.error;
    const code =
      (errorBody?.code as GenerateRecipeErrorCode | undefined) ??
      'provider_error';
    const message =
      errorBody?.message ??
      (httpError?.message || 'Recipe generation failed. Please try again.');
    throw new GenerateRecipeError(code, message);
  }

  return data as GenerateRecipeTurnResult;
}
