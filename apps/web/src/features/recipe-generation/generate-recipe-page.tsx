import { BotIcon, SparklesIcon, UserIcon, XIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ReviewScreen } from '@/features/recipe-import/review-screen.tsx';
import type { RecipeDraft } from '@opendish/contracts';

import {
  generateRecipeTurn,
  GenerateRecipeError,
} from './generate-recipe-api.ts';

interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

function readableError(error: unknown): string {
  if (error instanceof GenerateRecipeError) {
    if (error.code === 'ai_not_configured') {
      return 'AI is not configured. Add your provider credentials in Settings.';
    }
    if (error.code === 'invalid_ai_output') {
      return 'The AI returned an invalid recipe draft. Please try again.';
    }
    return error.message;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'The request was cancelled.';
  }
  return 'AI is unavailable right now. Please try again.';
}

export function GenerateRecipePage() {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);

  const submit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || isSending) return;

    const controller = new AbortController();
    requestController.current = controller;
    setIsSending(true);
    setError(null);

    try {
      const { conversationId: returnedId, outcome } = await generateRecipeTurn(
        {
          conversationId: conversationId ?? undefined,
          message: trimmed,
        },
        controller.signal,
      );
      setConversationId(returnedId);

      const userEntry: StoredMessage = {
        id: `user-${returnedId}-${messages.length}`,
        role: 'user',
        content: trimmed,
      };

      if (outcome.kind === 'clarify') {
        setMessages((previous) => [
          ...previous,
          userEntry,
          {
            id: `assistant-${returnedId}-${messages.length + 1}`,
            role: 'assistant',
            content: outcome.question,
          },
        ]);
        setMessage('');
      } else {
        setMessages((previous) => [...previous, userEntry]);
        setDraft(outcome.draft);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(readableError(cause));
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setIsSending(false);
      }
    }
  }, [message, isSending, conversationId, messages.length]);

  function cancelRequest() {
    requestController.current?.abort();
    requestController.current = null;
    setIsSending(false);
  }

  function handleDiscard() {
    setDraft(null);
  }

  if (draft) {
    return (
      <ReviewScreen
        draft={draft}
        origin="ai_generated"
        onDiscard={handleDiscard}
      />
    );
  }

  return (
    <Card aria-labelledby="generate-recipe-title">
      <CardHeader>
        <CardTitle
          id="generate-recipe-title"
          className="flex items-center gap-2"
        >
          <SparklesIcon className="size-5" aria-hidden />
          Create with AI
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Describe what you want to cook. The AI may ask a clarifying question
          before producing a recipe draft.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Describe the recipe you have in mind.
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
                      <span>AI response</span>
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

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <p>{error}</p>
            {/not configured/i.test(error) ? (
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
            void submit();
          }}
        >
          <label htmlFor="generate-message" className="text-sm font-medium">
            Message
          </label>
          <Textarea
            id="generate-message"
            value={message}
            maxLength={4000}
            disabled={isSending}
            placeholder="e.g. A high-protein chicken dinner for two"
            onChange={(event) => setMessage(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={isSending || message.trim().length === 0}
            >
              {isSending ? 'Waiting for AI…' : 'Send'}
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
