import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeQuantity, type RecipeDraft } from '@opendish/contracts';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaveRecipeResult } from '@/domain/recipe-save.ts';
import type { RecipeMutationVariables } from '@/features/recipe-editor/use-recipe-mutation.ts';
import { GenerateRecipePage } from '@/features/recipe-generation/generate-recipe-page.tsx';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    storage: { from: vi.fn() },
    functions: { invoke: mocks.invoke },
  },
}));

const mockMutateAsync =
  vi.fn<(variables: RecipeMutationVariables) => Promise<SaveRecipeResult>>();

vi.mock('@/features/recipe-editor/use-recipe-mutation.ts', () => ({
  useRecipeMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const GENERATED_DRAFT: RecipeDraft = {
  title: 'AI Pasta',
  description: 'A generated pasta recipe.',
  servings: 4,
  prepTimeMinutes: 10,
  cookTimeMinutes: 20,
  sourceName: null,
  sourceUrl: null,
  ingredients: [
    { name: 'Spaghetti', quantity: makeQuantity(1, 2), unit: 'lb' },
    { name: 'Tomato sauce', quantity: makeQuantity(2, 1), unit: 'cups' },
  ],
  steps: [{ text: 'Boil the pasta.' }, { text: 'Heat the sauce and combine.' }],
  tags: ['pasta'],
};

function renderPage() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <GenerateRecipePage />
    </MemoryRouter>,
  );
  return { user };
}

describe('GenerateRecipePage', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ recipeId: 'r1', headVersion: 1 });
  });

  it('renders conversation turns after a clarify outcome', async () => {
    const { user } = renderPage();
    mocks.invoke.mockResolvedValue({
      data: {
        conversationId: 'conv-1',
        outcome: {
          kind: 'clarify',
          question: 'What protein would you like?',
        },
      },
      error: null,
    });

    await user.type(screen.getByLabelText(/Message/i), 'I want a quick dinner');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    expect(await screen.findByText('I want a quick dinner')).toBeVisible();
    expect(
      screen.getByText('What protein would you like?'),
    ).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith(
      'ai-generate-recipe',
      expect.objectContaining({
        body: { message: 'I want a quick dinner' },
      }),
    );
  });

  it('hands off a draft outcome to the review screen with draft data', async () => {
    const { user } = renderPage();
    mocks.invoke.mockResolvedValue({
      data: {
        conversationId: 'conv-2',
        outcome: { kind: 'draft', draft: GENERATED_DRAFT },
      },
      error: null,
    });

    await user.type(screen.getByLabelText(/Message/i), 'Make a pasta dish');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    expect(
      await screen.findByText(/Review AI-generated recipe/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/i)).toHaveValue('AI Pasta');
    expect(
      screen.getByText(/AI-generated values are estimates, please review/i),
    ).toBeInTheDocument();
  });

  it('saves edited values with origin ai_generated', async () => {
    const { user } = renderPage();
    mocks.invoke.mockResolvedValue({
      data: {
        conversationId: 'conv-3',
        outcome: { kind: 'draft', draft: GENERATED_DRAFT },
      },
      error: null,
    });

    await user.type(screen.getByLabelText(/Message/i), 'Make a pasta dish');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    await screen.findByText(/Review AI-generated recipe/i);

    const titleInput = screen.getByLabelText(/Title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Edited AI Pasta');

    const firstQuantityInput = screen.getByLabelText(/Ingredient 1 quantity/i);
    await user.clear(firstQuantityInput);
    await user.type(firstQuantityInput, '1');

    await user.click(
      screen.getByRole('button', { name: /Save generated recipe/i }),
    );

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const call = mockMutateAsync.mock.calls[0];
    expect(call).toBeDefined();
    const [variables] = call!;
    expect(variables.draft.title).toBe('Edited AI Pasta');
    expect(variables.draft.origin).toBe('ai_generated');
    expect(variables.draft.recipeId).toBeNull();
    expect(variables.draft.changeKind).toBe('manual_edit');
    expect(variables.draft.ingredients[0]).toMatchObject({
      name: 'Spaghetti',
      quantity: { num: 1, den: 1 },
      unit: 'lb',
    });
  });

  it('discards the draft without saving and returns to the conversation', async () => {
    const { user } = renderPage();
    mocks.invoke.mockResolvedValue({
      data: {
        conversationId: 'conv-4',
        outcome: { kind: 'draft', draft: GENERATED_DRAFT },
      },
      error: null,
    });

    await user.type(screen.getByLabelText(/Message/i), 'Make a pasta dish');
    await user.click(screen.getByRole('button', { name: /Send/i }));

    await screen.findByText(/Review AI-generated recipe/i);

    await user.click(
      screen.getByRole('button', {
        name: /Discard and return to conversation/i,
      }),
    );

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Message/i)).toBeInTheDocument();
  });
});
