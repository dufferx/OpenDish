import type { RecipeDraft } from '@opendish/contracts';

import { supabase } from '@/lib/supabase';

export type ExtractionMethod = 'structured_markup' | 'ai';

export interface ImportResult {
  draft: RecipeDraft;
  extractionMethod: ExtractionMethod;
}

export type ImportErrorCode =
  | 'no_recipe_found'
  | 'unsupported_url'
  | 'fetch_failed'
  | 'ai_not_configured'
  | 'invalid_ai_output'
  | 'provider_error';

export class ImportRecipeError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = 'ImportRecipeError';
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

/**
 * Invokes the import-recipe Edge Function. The returned draft is presented in
 * the review screen; nothing is persisted until the user explicitly saves.
 */
export async function importRecipe(
  body: { mode: 'url'; url: string } | { mode: 'text'; text: string },
): Promise<ImportResult> {
  const { data, error } = await supabase.functions.invoke('import-recipe', {
    body,
  });

  if (error) {
    const httpError = isFunctionsHttpError(error) ? error : null;
    const payload = httpError?.context
      ? await httpError.context.json().catch(() => null)
      : null;
    const errorBody = (
      payload as { error?: { code?: string; message?: string } } | null
    )?.error;
    const code =
      (errorBody?.code as ImportErrorCode | undefined) ?? 'fetch_failed';
    const message =
      errorBody?.message ??
      (httpError?.message || 'Import failed. Please try again.');
    throw new ImportRecipeError(code, message);
  }

  return data as ImportResult;
}
