import {
  applyModificationOperations,
  chatOutcomeSchema,
  modificationOpSchema,
  type ModificationProposal,
  type RecipeDraft,
} from '@opendish/contracts';
import { BotIcon, MessageCircleIcon, UserIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  AiAvailabilityBanner,
  type AiConfiguration,
  useAiConfigurationStatus,
} from '@/features/ai-config';
import {
  ModificationReview,
  type ProposalAction,
} from '@/features/modification-review';
import {
  applyProposal,
  discardProposal,
  saveProposalAsVariant,
  StaleProposalError,
} from '@/features/modification-review/proposal-actions.ts';
import type { RecipeDetail } from '@/features/recipes/recipe-queries.ts';
import { supabase } from '@/lib/supabase';

type ConversationIntent = 'answer' | 'modification';
type ProposalStatus = 'pending' | 'applied' | 'variant_created' | 'discarded';

interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  position: number;
}

interface ReviewableProposal {
  id: string;
  baseVersion: number;
  proposal: ModificationProposal;
}

interface FunctionPayload {
  outcome?: unknown;
  proposalId?: string;
  proposal?: unknown;
  kind?: unknown;
  content?: unknown;
}

function asRecipeDraft(recipe: RecipeDetail): RecipeDraft {
  return {
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    sourceName: recipe.sourceName,
    sourceUrl: recipe.sourceUrl,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    tags: recipe.tags,
  };
}

function hasValidAiConfiguration(
  configuration: AiConfiguration | null | undefined,
): boolean {
  return (
    typeof configuration === 'object' &&
    configuration !== null &&
    'configured' in configuration &&
    configuration.configured === true &&
    'status' in configuration &&
    configuration.status === 'valid'
  );
}

function unavailableAiMessage(
  configuration: AiConfiguration | null | undefined,
  isLoading: boolean,
  error: unknown,
): string {
  if (isLoading) {
    return 'Checking AI availability. Please wait a moment.';
  }
  if (error) {
    return 'AI availability could not be checked. Open Settings or try again.';
  }
  if (
    typeof configuration === 'object' &&
    configuration !== null &&
    'configured' in configuration &&
    configuration.configured === true
  ) {
    return 'AI provider settings need attention before AI can be used. Open Settings.';
  }
  return 'AI is not configured. Add your provider credentials in Settings.';
}

function shouldOfferSettings(message: string | null): boolean {
  return Boolean(
    message &&
    /(not configured|open settings|provider settings|rejected the api key|provider credentials)/i.test(
      message,
    ),
  );
}

async function readableFunctionError(error: unknown): Promise<string> {
  let code = '';
  let message = error instanceof Error ? error.message : 'AI request failed.';
  const context = (error as { context?: unknown } | null)?.context;

  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as {
        error?: { code?: string; message?: string };
      };
      code = body.error?.code ?? '';
      message = body.error?.message ?? message;
    } catch {
      // Keep the safe SDK message when the response is not JSON.
    }
  }

  if (code === 'ai_not_configured' || /not configured/i.test(message)) {
    return 'AI is not configured. Add your provider credentials in Settings.';
  }
  if (code === 'invalid_ai_output') {
    return 'The AI returned an invalid recipe change. Please try again.';
  }
  return message || 'AI is unavailable right now. Please try again.';
}

export interface RecipeConversationProps {
  recipe: RecipeDetail;
  onRecipeChanged?: () => void | Promise<void>;
}

export function RecipeConversation({
  recipe,
  onRecipeChanged,
}: RecipeConversationProps) {
  const {
    configuration,
    isLoading: isAiConfigurationLoading,
    error: aiConfigurationError,
  } = useAiConfigurationStatus();
  const navigate = useNavigate();
  const currentRecipe = useMemo(() => asRecipeDraft(recipe), [recipe]);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [proposal, setProposal] = useState<ReviewableProposal | null>(null);
  const [intent, setIntent] = useState<ConversationIntent>('answer');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [pendingAction, setPendingAction] = useState<ProposalAction | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const canUseAi =
    !aiConfigurationError && hasValidAiConfiguration(configuration);
  const showAiAvailabilityBanner =
    isAiConfigurationLoading || aiConfigurationError || !canUseAi;

  const loadConversation = useCallback(
    async (signal?: AbortSignal) => {
      const conversationResult = await supabase
        .from('conversations')
        .select('id')
        .eq('recipe_id', recipe.id)
        .abortSignal(signal ?? new AbortController().signal)
        .maybeSingle();
      if (conversationResult.error)
        throw new Error(conversationResult.error.message);
      if (!conversationResult.data) {
        setMessages([]);
        setProposal(null);
        return;
      }

      const conversationId = (conversationResult.data as { id: string }).id;
      const [messagesResult, proposalsResult] = await Promise.all([
        supabase
          .from('conversation_messages')
          .select('id, role, content, position')
          .eq('conversation_id', conversationId)
          .order('position')
          .abortSignal(signal ?? new AbortController().signal),
        supabase
          .from('modification_proposals')
          .select(
            'id, message_id, base_version, operations, status, created_at',
          )
          .eq('conversation_id', conversationId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .abortSignal(signal ?? new AbortController().signal),
      ]);
      if (messagesResult.error) throw new Error(messagesResult.error.message);
      if (proposalsResult.error) throw new Error(proposalsResult.error.message);

      const loadedMessages = (messagesResult.data ?? []) as StoredMessage[];
      setMessages(loadedMessages);

      const row = (proposalsResult.data?.[0] ?? null) as {
        id: string;
        message_id: string;
        base_version: number | string;
        operations: unknown;
        status: ProposalStatus;
      } | null;
      if (!row) {
        setProposal(null);
        return;
      }

      const parsedOperations = modificationOpSchema
        .array()
        .safeParse(row.operations);
      if (!parsedOperations.success) {
        throw new Error(
          'A saved AI suggestion is invalid and cannot be reviewed.',
        );
      }
      const summary =
        loadedMessages.find((item) => item.id === row.message_id)?.content ??
        'Review the proposed recipe changes.';
      const baseVersion = Number(row.base_version);
      setProposal({
        id: row.id,
        baseVersion,
        proposal: {
          summary,
          operations: parsedOperations.data,
          // A stale proposal was derived from an older snapshot. Re-applying
          // positional operations to today's recipe could fail or produce a
          // misleading comparison, so keep the current recipe as a safe
          // placeholder and require regeneration.
          resultingRecipe:
            baseVersion === recipe.headVersion
              ? applyModificationOperations(
                  currentRecipe,
                  parsedOperations.data,
                )
              : currentRecipe,
        },
      });
    },
    [currentRecipe, recipe.headVersion, recipe.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    void loadConversation(controller.signal)
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load the conversation.',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [loadConversation]);

  useEffect(
    () => () => {
      requestController.current?.abort();
    },
    [],
  );

  async function invokeConversation() {
    const trimmed = message.trim();
    if (
      !trimmed ||
      isSending ||
      pendingAction ||
      !canUseAi ||
      isAiConfigurationLoading
    ) {
      return;
    }

    const controller = new AbortController();
    requestController.current = controller;
    setIsSending(true);
    setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke(
        'ai-recipe-chat',
        {
          body: { recipeId: recipe.id, message: trimmed, intent },
          signal: controller.signal,
        },
      );
      if (functionError) throw functionError;

      const payload = (data ?? {}) as FunctionPayload;
      const outcome = payload.outcome ?? payload;
      const parsed = chatOutcomeSchema.safeParse(outcome);
      if (!parsed.success) {
        throw new Error(
          'The AI returned an invalid response. Please try again.',
        );
      }
      setMessage('');
      await loadConversation(controller.signal);
    } catch (invokeError) {
      if (!controller.signal.aborted) {
        setError(await readableFunctionError(invokeError));
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setIsSending(false);
      }
    }
  }

  function cancelRequest() {
    requestController.current?.abort();
    requestController.current = null;
    setIsSending(false);
  }

  async function runProposalAction(
    action: Exclude<ProposalAction, 'regenerate'>,
  ) {
    if (!proposal || pendingAction || isSending) return;
    setPendingAction(action);
    setError(null);
    try {
      if (action === 'apply') {
        await applyProposal(supabase, {
          proposalId: proposal.id,
          resultingRecipe: proposal.proposal.resultingRecipe,
        });
        await onRecipeChanged?.();
      } else if (action === 'variant') {
        const result = await saveProposalAsVariant(supabase, {
          proposalId: proposal.id,
          resultingRecipe: proposal.proposal.resultingRecipe,
        });
        navigate(`/recipes/${result.recipeId}`);
      } else {
        await discardProposal(supabase, { proposalId: proposal.id });
      }
      await loadConversation();
    } catch (actionError) {
      if (actionError instanceof StaleProposalError) {
        setError(
          'This suggestion is stale because the recipe changed. Regenerate it before applying.',
        );
      } else {
        setError(
          actionError instanceof Error
            ? actionError.message
            : 'Could not update the suggestion.',
        );
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function regenerateProposal() {
    if (!proposal || pendingAction) return;
    if (!canUseAi || isAiConfigurationLoading) {
      setError(
        unavailableAiMessage(
          configuration,
          isAiConfigurationLoading,
          aiConfigurationError,
        ),
      );
      return;
    }
    const request =
      [...messages].reverse().find((item) => item.role === 'user')?.content ??
      'Regenerate this modification for the current recipe.';
    const controller = new AbortController();
    requestController.current = controller;
    setIsSending(true);
    setError(null);
    try {
      const { error: functionError } = await supabase.functions.invoke(
        'ai-propose-modification',
        {
          body: { recipeId: recipe.id, request },
          signal: controller.signal,
        },
      );
      if (functionError) throw functionError;
      await loadConversation(controller.signal);
    } catch (invokeError) {
      if (!controller.signal.aborted) {
        setError(await readableFunctionError(invokeError));
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setIsSending(false);
      }
    }
  }

  const isStale = proposal?.baseVersion !== recipe.headVersion;
  const interactionPending = isSending || pendingAction !== null;

  return (
    <Card aria-labelledby="recipe-assistant-title">
      <CardHeader>
        <CardTitle
          id="recipe-assistant-title"
          className="flex items-center gap-2"
        >
          <MessageCircleIcon className="size-5" aria-hidden />
          Recipe assistant
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Ask about this recipe or request a reviewed suggestion. AI never
          changes your saved recipe until you explicitly apply it.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5">
        {showAiAvailabilityBanner ? (
          <AiAvailabilityBanner
            capability="recipe assistance"
            configuration={configuration}
            isLoading={isAiConfigurationLoading}
            error={aiConfigurationError}
          />
        ) : null}

        {isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading conversation…
          </p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Start with a question or a modification request.
          </p>
        ) : (
          <ol aria-label="Conversation history" className="grid gap-3">
            {messages.map((item) => (
              <li
                key={item.id}
                className={
                  item.role === 'assistant'
                    ? 'rounded-xl border border-primary/30 bg-primary/5 p-3'
                    : 'rounded-xl bg-muted p-3'
                }
              >
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  {item.role === 'assistant' ? (
                    <>
                      <BotIcon className="size-4" aria-hidden />
                      <Badge>AI response</Badge>
                    </>
                  ) : (
                    <>
                      <UserIcon className="size-4" aria-hidden /> You
                    </>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm">{item.content}</p>
              </li>
            ))}
          </ol>
        )}

        {proposal ? (
          <ModificationReview
            currentRecipe={currentRecipe}
            proposal={proposal.proposal}
            isStale={isStale}
            pendingAction={isSending ? 'regenerate' : pendingAction}
            onApply={() => runProposalAction('apply')}
            onSaveAsVariant={() => runProposalAction('variant')}
            onDiscard={() => runProposalAction('discard')}
            onRegenerate={regenerateProposal}
          />
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <p>{error}</p>
            {shouldOfferSettings(error) ? (
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link to="/settings">Open Settings</Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        <form
          className="grid gap-3 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void invokeConversation();
          }}
        >
          <fieldset
            className="flex flex-wrap gap-4"
            disabled={
              interactionPending || !canUseAi || isAiConfigurationLoading
            }
          >
            <legend className="mb-2 text-sm font-medium">
              What should AI do?
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="conversation-intent"
                value="answer"
                checked={intent === 'answer'}
                onChange={() => setIntent('answer')}
              />
              Answer a question
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="conversation-intent"
                value="modification"
                checked={intent === 'modification'}
                onChange={() => setIntent('modification')}
              />
              Suggest a modification
            </label>
          </fieldset>
          <label
            htmlFor="recipe-assistant-message"
            className="text-sm font-medium"
          >
            Message
          </label>
          <Textarea
            id="recipe-assistant-message"
            value={message}
            maxLength={4000}
            disabled={
              interactionPending || !canUseAi || isAiConfigurationLoading
            }
            placeholder={
              intent === 'answer'
                ? 'What can I substitute for the tomatoes?'
                : 'Make this vegetarian and update the steps.'
            }
            onChange={(event) => setMessage(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={
                interactionPending ||
                !canUseAi ||
                isAiConfigurationLoading ||
                message.trim().length === 0
              }
            >
              {isSending
                ? 'Waiting for AI…'
                : intent === 'answer'
                  ? 'Ask AI'
                  : 'Request suggestion'}
            </Button>
            {isSending ? (
              <Button type="button" variant="outline" onClick={cancelRequest}>
                <XIcon className="size-4" aria-hidden /> Cancel request
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
