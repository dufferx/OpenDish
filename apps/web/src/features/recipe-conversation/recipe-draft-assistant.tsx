import { ArrowUpIcon, MessageCircleIcon, UserIcon, XIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ModificationProposal, RecipeDraft } from '@opendish/contracts';

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
import { Badge } from '@/components/ui/badge';
import { ModificationReview } from '@/features/modification-review';
import { previewRecipeModification } from './recipe-draft-assistant-api.ts';
import mascotImage from '@/assets/mascot.jpg';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface RecipeDraftAssistantProps {
  draft: RecipeDraft | null;
  onApply: (draft: RecipeDraft) => void;
}

export function RecipeDraftAssistant({
  draft,
  onApply,
}: RecipeDraftAssistantProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposal, setProposal] = useState<ModificationProposal | null>(null);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState('');
  const requestController = useRef<AbortController | null>(null);

  async function send() {
    const request = message.trim();
    if (!request || !draft || isSending) return;
    const controller = new AbortController();
    requestController.current = controller;
    setIsSending(true);
    setError(null);
    setLastRequest(request);
    setMessages((previous) => [
      ...previous,
      { id: `user-${previous.length}`, role: 'user', content: request },
    ]);
    setMessage('');
    try {
      const nextProposal = await previewRecipeModification(
        draft,
        request,
        controller.signal,
      );
      setProposal(nextProposal);
      setMessages((previous) => [
        ...previous,
        {
          id: `assistant-${previous.length}`,
          role: 'assistant',
          content: nextProposal.summary,
        },
      ]);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'AI is unavailable right now.',
        );
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setIsSending(false);
      }
    }
  }

  function apply() {
    if (!proposal) return;
    onApply(proposal.resultingRecipe);
    setProposal(null);
  }

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
            <p className="text-sm font-semibold">Ask Dishy</p>
            <p className="truncate text-xs text-muted-foreground">
              Adjust this recipe with AI
            </p>
          </div>
          <DrawerTrigger asChild>
            <Button type="button" className="h-10 rounded-xl px-4">
              <MessageCircleIcon className="size-4" aria-hidden /> Open chat
            </Button>
          </DrawerTrigger>
        </div>
      </div>
      <DrawerContent className="h-[min(90dvh,54rem)]">
        <DrawerHeader className="border-b py-3">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <img
              src={mascotImage}
              alt=""
              width={44}
              height={44}
              className="size-11 rounded-xl object-cover"
            />
            <div className="min-w-0 flex-1">
              <DrawerTitle>Dishy</DrawerTitle>
              <DrawerDescription>
                Changes stay local until you save the recipe.
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close assistant">
                <XIcon className="size-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid w-full max-w-3xl gap-5 px-4 py-5">
            {messages.length > 0 ? (
              <ol
                aria-label="Local assistant conversation"
                className="grid gap-3"
              >
                {messages.map((item) => (
                  <li
                    key={item.id}
                    className={
                      item.role === 'user'
                        ? 'ml-auto max-w-[85%] rounded-2xl bg-foreground px-4 py-3 text-sm text-background'
                        : 'max-w-[90%] rounded-2xl border px-4 py-3 text-sm'
                    }
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs font-medium opacity-70">
                      {item.role === 'assistant' ? (
                        <img
                          src={mascotImage}
                          alt=""
                          width={20}
                          height={20}
                          className="size-5 rounded-md object-cover"
                        />
                      ) : (
                        <UserIcon className="size-3" />
                      )}{' '}
                      {item.role === 'assistant' ? 'Dishy' : 'You'}
                    </div>
                    {item.content}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Ask for a change and review it before applying.
              </p>
            )}
            {proposal && draft ? (
              <div className="grid gap-3">
                <Badge className="w-fit">AI suggestion · not applied</Badge>
                <ModificationReview
                  currentRecipe={draft}
                  proposal={proposal}
                  isStale={false}
                  pendingAction={null}
                  showVariant={false}
                  onApply={apply}
                  onSaveAsVariant={() => undefined}
                  onDiscard={() => setProposal(null)}
                  onRegenerate={() => {
                    setMessage(lastRequest);
                    setProposal(null);
                  }}
                />
              </div>
            ) : null}
            {isSending ? (
              <div role="status" className="text-sm text-muted-foreground">
                Dishy is preparing a suggestion…
              </div>
            ) : null}
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
              >
                {error}
              </div>
            ) : null}
          </div>
        </div>
        <form
          className="border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="mx-auto flex w-full max-w-3xl gap-2">
            <Textarea
              value={message}
              rows={2}
              maxLength={4000}
              disabled={isSending || !draft}
              placeholder="Describe the change you want to review…"
              onChange={(event) => setMessage(event.target.value)}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Request suggestion"
              disabled={isSending || !draft || message.trim().length === 0}
            >
              <ArrowUpIcon className="size-4" />
            </Button>
          </div>
          {isSending ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => requestController.current?.abort()}
            >
              <XIcon className="size-3" /> Cancel request
            </Button>
          ) : null}
        </form>
      </DrawerContent>
    </Drawer>
  );
}
