import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeQuantity } from '@opendish/contracts';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecipeConversation } from '@/features/recipe-conversation';
import type { RecipeDetail } from '@/features/recipes/recipe-queries.ts';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  conversation: { data: { id: 'conversation-1' }, error: null },
  messages: {
    data: [
      { id: 'm1', role: 'user', content: 'Can I freeze this?', position: 0 },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Yes, freeze it after cooling.',
        position: 1,
      },
    ],
    error: null,
  },
  proposals: { data: [] as unknown[], error: null },
}));

function queryBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    abortSignal: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'conversations') return queryBuilder(mocks.conversation);
      if (table === 'conversation_messages')
        return queryBuilder(mocks.messages);
      return queryBuilder(mocks.proposals);
    }),
    functions: { invoke: mocks.invoke },
  },
}));

const recipe: RecipeDetail = {
  id: 'recipe-1',
  title: 'Tomato pasta',
  description: null,
  servings: 2,
  prepTimeMinutes: null,
  cookTimeMinutes: 20,
  sourceName: null,
  sourceUrl: null,
  sourceRecipeId: null,
  sourceRecipe: null,
  variantRecipes: [],
  isFavorite: false,
  imagePath: null,
  ingredients: [{ name: 'Pasta', quantity: makeQuantity(1, 2), unit: 'lb' }],
  steps: [{ text: 'Cook the pasta.' }],
  tags: [],
  origin: 'manual',
  headVersion: 1,
};

function renderConversation() {
  render(
    <MemoryRouter>
      <RecipeConversation recipe={recipe} />
    </MemoryRouter>,
  );
}

describe('RecipeConversation', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.proposals.data = [];
    mocks.invoke.mockResolvedValue({
      data: { kind: 'answer', content: 'Done.' },
      error: null,
    });
  });

  it('renders persistent history with saved user and AI content distinguished', async () => {
    renderConversation();

    expect(await screen.findByText('Can I freeze this?')).toBeVisible();
    expect(screen.getByText('Yes, freeze it after cooling.')).toBeVisible();
    expect(screen.getByText('AI response')).toBeVisible();
    expect(
      screen.getByRole('radio', { name: /Answer a question/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /Suggest a modification/i }),
    ).not.toBeChecked();
  });

  it('sends the user-selected modification intent explicitly', async () => {
    const user = userEvent.setup();
    renderConversation();
    await screen.findByText('Can I freeze this?');

    await user.click(
      screen.getByRole('radio', { name: /Suggest a modification/i }),
    );
    await user.type(screen.getByLabelText('Message'), 'Make it vegetarian');
    await user.click(
      screen.getByRole('button', { name: /Request suggestion/i }),
    );

    expect(mocks.invoke).toHaveBeenCalledWith('ai-recipe-chat', {
      body: {
        recipeId: recipe.id,
        message: 'Make it vegetarian',
        intent: 'modification',
      },
      signal: expect.any(AbortSignal),
    });
  });

  it('keeps stale proposals reviewable without applying old positional operations', async () => {
    mocks.proposals.data = [
      {
        id: 'proposal-stale',
        message_id: 'm2',
        base_version: 0,
        operations: [{ kind: 'removeIngredient', position: 99 }],
        status: 'pending',
        created_at: '2026-08-20T00:00:00Z',
      },
    ];
    renderConversation();

    expect(await screen.findByText('Can I freeze this?')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /recipe has changed.*regenerate/i,
    );
    expect(screen.getByRole('button', { name: /^Apply$/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Regenerate suggestion/i }),
    ).toBeEnabled();
  });

  it('disables submission and exposes cancellation while AI is in flight', async () => {
    let finishRequest!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(
      new Promise((resolve) => {
        finishRequest = resolve;
      }),
    );
    const user = userEvent.setup();
    renderConversation();
    await screen.findByText('Can I freeze this?');

    await user.type(screen.getByLabelText('Message'), 'Explain the sauce');
    await user.click(screen.getByRole('button', { name: /Ask AI/i }));

    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Waiting for AI/i }),
    ).toBeDisabled();
    const cancel = screen.getByRole('button', { name: /Cancel request/i });
    expect(cancel).toBeEnabled();
    await user.click(cancel);
    expect(screen.getByLabelText('Message')).toBeEnabled();

    finishRequest({ data: null, error: new Error('aborted') });
  });
});
