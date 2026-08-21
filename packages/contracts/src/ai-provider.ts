import type { ConversationMessage } from './conversation.ts';
import type { ModificationProposal } from './modification.ts';
import type { RecipeDraft, RecipeSnapshot } from './recipe.ts';

/** BYOK credentials for the configured provider (R1/R4). */
export interface AiCredentials {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type AiErrorCode =
  | 'not_configured'
  | 'invalid_credentials'
  | 'provider_error'
  | 'invalid_ai_output'
  | 'timeout';

/** Safe-to-surface error: a stable code plus a message with no secrets. */
export interface AiError {
  code: AiErrorCode;
  message: string;
}

/**
 * Expected failures (bad key, provider down, invalid AI output, timeout)
 * are returned, never thrown. Implementations may still throw only for
 * programmer errors.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AiError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: AiError): Result<T> {
  return { ok: false, error };
}

/** Conversational generation outcome: ask a follow-up or produce a draft. */
export type GenerateRecipeOutcome =
  { kind: 'clarify'; question: string } | { kind: 'draft'; draft: RecipeDraft };

/**
 * The only surface the application sees of any AI provider (R1).
 * All AI-produced payloads must be validated against the domain schemas
 * by the implementation before being returned as `ok`.
 */
export interface AiProvider {
  validateCredentials(credentials: AiCredentials): Promise<Result<null>>;
  generateRecipe(
    conversation: ConversationMessage[],
    credentials: AiCredentials,
  ): Promise<Result<GenerateRecipeOutcome>>;
  answerRecipeQuestion(
    recipe: RecipeSnapshot,
    recentMessages: ConversationMessage[],
    question: string,
    credentials: AiCredentials,
  ): Promise<Result<string>>;
  proposeRecipeModification(
    recipe: RecipeSnapshot,
    request: string,
    credentials: AiCredentials,
  ): Promise<Result<ModificationProposal>>;
  extractRecipe(
    rawContent: string,
    credentials: AiCredentials,
  ): Promise<Result<RecipeDraft>>;
}
