import {
  applyModificationOperations,
  chatOutcomeSchema,
  modificationOpSchema,
  type ModificationProposal,
  type RecipeDraft,
} from '@opendish/contracts';
import {
  ArrowUpIcon,
  MessageCircleIcon,
  SparklesIcon,
  UserIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import mascotImage from '@/assets/mascot.jpg';
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

const STARTER_PROMPTS: Array<{
  label: string;
  intent: ConversationIntent;
}> = [
  { label: 'What can I substitute?', intent: 'answer' },
  { label: 'Explain a difficult step', intent: 'answer' },
  { label: 'Make it vegetarian', intent: 'modification' },
];

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
  const [open, setOpen] = useState(false);
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
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (open) {
      conversationEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [isSending, messages, open, proposal]);

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
    <Drawer open={open} onOpenChange={setOpen} fixed handleOnly>
      <div className="pointer-events-none fixed inset-x-0 bottom-12 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:bottom-0">
        <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border bg-background/95 p-2 shadow-[0_12px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl">
          <img
            src={mascotImage}
            alt=""
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-black/10"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Ask OpenDish AI</p>
            <p className="truncate text-xs text-muted-foreground">
              Chat about {recipe.title}
            </p>
          </div>
          {messages.length > 0 ? (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {messages.length} message{messages.length === 1 ? '' : 's'}
            </Badge>
          ) : null}
          <DrawerTrigger asChild>
            <Button className="h-10 rounded-xl px-4">
              <MessageCircleIcon className="size-4" aria-hidden />
              Open chat
            </Button>
          </DrawerTrigger>
        </div>
      </div>

      <DrawerContent className="h-[min(90dvh,54rem)]">
        <DrawerHeader className="border-b py-3">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
            <img
              src={mascotImage}
              alt=""
              width={44}
              height={44}
              className="size-11 rounded-xl object-cover ring-1 ring-black/10"
            />
            <div className="min-w-0 flex-1">
              <DrawerTitle id="recipe-assistant-title">OpenDish AI</DrawerTitle>
              <DrawerDescription className="truncate">
                Talking about {recipe.title}
              </DrawerDescription>
            </div>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
              Recipe context active
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close chat">
                <XIcon className="size-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
            {showAiAvailabilityBanner ? (
              <div className="mb-5">
                <AiAvailabilityBanner
                  capability="recipe assistance"
                  configuration={configuration}
                  isLoading={isAiConfigurationLoading}
                  error={aiConfigurationError}
                />
              </div>
            ) : null}

            {isLoading ? (
              <div
                className="m-auto flex items-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <span className="size-2 animate-pulse rounded-full bg-foreground/40" />
                Loading conversation…
              </div>
            ) : messages.length === 0 && !proposal ? (
              <div className="m-auto flex max-w-md flex-col items-center px-3 py-10 text-center">
                <img
                  src={mascotImage}
                  alt=""
                  width={72}
                  height={72}
                  className="size-18 rounded-2xl object-cover shadow-sm ring-1 ring-black/10"
                />
                <h3 className="mt-5 text-lg font-semibold">
                  Ask me about this recipe
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  I can explain a step, suggest substitutions, or prepare a
                  change for you to review before anything is saved.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt.label}
                      type="button"
                      variant="outline"
                      className="h-9 rounded-full bg-background px-3 text-xs"
                      onClick={() => {
                        setIntent(prompt.intent);
                        setMessage(prompt.label);
                      }}
                    >
                      {prompt.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <ol aria-label="Conversation history" className="grid gap-6">
                {messages.map((item) => (
                  <li
                    key={item.id}
                    className={
                      item.role === 'assistant'
                        ? 'flex max-w-[92%] items-start gap-3 sm:max-w-[82%]'
                        : 'ml-auto flex max-w-[88%] flex-row-reverse items-start gap-3 sm:max-w-[76%]'
                    }
                  >
                    {item.role === 'assistant' ? (
                      <img
                        src={mascotImage}
                        alt=""
                        width={32}
                        height={32}
                        className="size-8 shrink-0 rounded-lg object-cover ring-1 ring-black/10"
                      />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <UserIcon className="size-4" aria-hidden />
                      </span>
                    )}
                    <div>
                      <p
                        className={
                          item.role === 'assistant'
                            ? 'mb-1.5 text-xs font-medium text-muted-foreground'
                            : 'mb-1.5 text-right text-xs font-medium text-muted-foreground'
                        }
                      >
                        {item.role === 'assistant' ? 'OpenDish AI' : 'You'}
                      </p>
                      <p
                        className={
                          item.role === 'assistant'
                            ? 'whitespace-pre-wrap rounded-2xl rounded-tl-md border bg-background px-4 py-3 text-sm leading-6 shadow-sm'
                            : 'whitespace-pre-wrap rounded-2xl rounded-tr-md bg-foreground px-4 py-3 text-sm leading-6 text-background'
                        }
                      >
                        {item.content}
                      </p>
                    </div>
                  </li>
                ))}

                {proposal ? (
                  <li
                    aria-label="AI suggestion"
                    className="flex items-start gap-3"
                  >
                    <img
                      src={mascotImage}
                      alt=""
                      width={32}
                      height={32}
                      className="size-8 shrink-0 rounded-lg object-cover ring-1 ring-black/10"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <SparklesIcon className="size-3.5" /> OpenDish AI
                      </p>
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
                    </div>
                  </li>
                ) : null}
              </ol>
            )}

            {isSending ? (
              <div className="mt-6 flex items-start gap-3" role="status">
                <img
                  src={mascotImage}
                  alt=""
                  width={32}
                  height={32}
                  className="size-8 rounded-lg object-cover ring-1 ring-black/10"
                />
                <div className="flex h-10 items-center gap-1 rounded-2xl rounded-tl-md border bg-background px-4 shadow-sm">
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.2s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.1s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                  <span className="sr-only">Waiting for AI…</span>
                </div>
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"
              >
                <p>{error}</p>
                {shouldOfferSettings(error) ? (
                  <Button asChild variant="outline" size="sm" className="mt-2">
                    <Link to="/settings">Open Settings</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div ref={conversationEndRef} />
          </div>
        </div>

        <form
          className="shrink-0 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            void invokeConversation();
          }}
        >
          <div className="mx-auto w-full max-w-3xl">
            <fieldset
              className="mb-2 flex gap-1"
              disabled={
                interactionPending || !canUseAi || isAiConfigurationLoading
              }
            >
              <legend className="sr-only">What should AI do?</legend>
              <label className="cursor-pointer">
                <input
                  className="peer sr-only"
                  type="radio"
                  name="conversation-intent"
                  value="answer"
                  checked={intent === 'answer'}
                  onChange={() => setIntent('answer')}
                />
                <span className="inline-flex h-7 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors peer-checked:bg-foreground peer-checked:text-background">
                  Answer a question
                </span>
              </label>
              <label className="cursor-pointer">
                <input
                  className="peer sr-only"
                  type="radio"
                  name="conversation-intent"
                  value="modification"
                  checked={intent === 'modification'}
                  onChange={() => setIntent('modification')}
                />
                <span className="inline-flex h-7 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors peer-checked:bg-foreground peer-checked:text-background">
                  Suggest a modification
                </span>
              </label>
            </fieldset>

            <div className="relative rounded-2xl border bg-muted/35 p-2 pr-12 shadow-sm focus-within:border-foreground/35 focus-within:ring-2 focus-within:ring-foreground/5">
              <label htmlFor="recipe-assistant-message" className="sr-only">
                Message
              </label>
              <Textarea
                id="recipe-assistant-message"
                value={message}
                rows={2}
                maxLength={4000}
                disabled={
                  interactionPending || !canUseAi || isAiConfigurationLoading
                }
                placeholder={
                  intent === 'answer'
                    ? 'Ask anything about this recipe…'
                    : 'Describe the change you want to review…'
                }
                className="max-h-32 min-h-12 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void invokeConversation();
                  }
                }}
              />
              <Button
                type="submit"
                size="icon"
                aria-label={
                  intent === 'answer' ? 'Ask AI' : 'Request suggestion'
                }
                className="absolute right-2 bottom-2 size-9 rounded-full"
                disabled={
                  interactionPending ||
                  !canUseAi ||
                  isAiConfigurationLoading ||
                  message.trim().length === 0
                }
              >
                <ArrowUpIcon className="size-4" />
              </Button>
            </div>

            <div className="mt-2 flex min-h-6 items-center justify-between gap-3 text-[0.68rem] text-muted-foreground">
              <p>OpenDish AI uses this recipe as context.</p>
              {isSending ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={cancelRequest}
                >
                  <XIcon className="size-3" aria-hidden /> Cancel request
                </Button>
              ) : (
                <p className="hidden sm:block">
                  Enter to send · Shift+Enter for a new line
                </p>
              )}
            </div>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
