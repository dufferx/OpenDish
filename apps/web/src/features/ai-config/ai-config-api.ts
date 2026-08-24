import { z } from 'zod';

import { supabase } from '@/lib/supabase';

export const DEFAULT_AI_PROVIDER = 'openai';
export const DEFAULT_AI_MODEL = 'gpt-4o-mini';
export const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';

export interface SupportedAiModelOption {
  readonly value: string;
  readonly label: string;
}

/** T101: the model field is a controlled dropdown of supported OpenAI
 * models rather than free text. Keep this list small and reviewed — it is
 * not meant to track every upstream model release automatically. */
export const SUPPORTED_AI_MODELS: readonly SupportedAiModelOption[] = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (default)' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4.1-nano', label: 'GPT-4.1 nano' },
];

const configuredAiConfigurationSchema = z.object({
  configured: z.literal(true),
  provider: z.string().min(1),
  model: z.string().min(1),
  // Older/rolling ai-configure deployments do not include baseUrl in the
  // status response. Normalize that safe metadata omission instead of
  // treating an otherwise valid configuration as unusable.
  baseUrl: z
    .string()
    .url()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  status: z.enum(['unverified', 'valid', 'invalid']),
  // Postgres timestamptz values can be serialized with an explicit UTC offset
  // (for example, +00:00) instead of a trailing Z.
  lastVerifiedAt: z.string().datetime({ offset: true }).nullable(),
});

const aiConfigurationSchema = z.discriminatedUnion('configured', [
  z.object({ configured: z.literal(false) }),
  configuredAiConfigurationSchema,
]);

const upsertAiConfigurationResponseSchema = z.object({
  status: z.literal('valid'),
});

const removeAiConfigurationResponseSchema = z.object({
  status: z.literal('unconfigured'),
});

const functionErrorBodySchema = z.object({
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export type AiConfiguration = z.infer<typeof aiConfigurationSchema>;

interface FunctionsHttpErrorContext {
  json(): Promise<unknown>;
}

interface FunctionsHttpError {
  context?: FunctionsHttpErrorContext;
  message: string;
}

export interface UpsertAiConfigurationInput {
  provider: typeof DEFAULT_AI_PROVIDER;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

function isFunctionsHttpError(error: unknown): error is FunctionsHttpError {
  return typeof error === 'object' && error !== null && 'message' in error;
}

async function readFunctionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  const httpError = isFunctionsHttpError(error) ? error : null;
  const payload = httpError?.context
    ? await httpError.context.json().catch(() => null)
    : null;
  const parsed = functionErrorBodySchema.safeParse(payload);
  const safeMessage = parsed.success ? parsed.data.error?.message : null;

  if (safeMessage && safeMessage.trim() !== '') {
    return safeMessage;
  }

  if (
    httpError?.message &&
    httpError.message.trim() !== '' &&
    !/failed to fetch|non-2xx/i.test(httpError.message)
  ) {
    return httpError.message;
  }

  return fallback;
}

export async function fetchAiConfigurationStatus(
  signal?: AbortSignal,
): Promise<AiConfiguration> {
  const { data, error } = await supabase.functions.invoke('ai-configure', {
    body: { action: 'status' },
    signal,
  });

  if (error) {
    throw new Error(
      await readFunctionErrorMessage(
        error,
        'Could not load AI settings. Please try again.',
      ),
    );
  }

  const parsed = aiConfigurationSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('The AI settings response was invalid. Please try again.');
  }

  return parsed.data;
}

export async function upsertAiConfiguration(
  input: UpsertAiConfigurationInput,
  signal?: AbortSignal,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('ai-configure', {
    body: {
      action: 'upsert',
      provider: input.provider,
      apiKey: input.apiKey,
      model: input.model,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    },
    signal,
  });

  if (error) {
    throw new Error(
      await readFunctionErrorMessage(
        error,
        'Could not save AI settings. Please try again.',
      ),
    );
  }

  const parsed = upsertAiConfigurationResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('The AI settings response was invalid. Please try again.');
  }
}

export async function removeAiConfiguration(
  signal?: AbortSignal,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('ai-configure', {
    body: { action: 'remove' },
    signal,
  });

  if (error) {
    throw new Error(
      await readFunctionErrorMessage(
        error,
        'Could not remove AI settings. Please try again.',
      ),
    );
  }

  const parsed = removeAiConfigurationResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('The AI settings response was invalid. Please try again.');
  }
}
