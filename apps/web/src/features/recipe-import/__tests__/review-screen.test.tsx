import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQuantity, type RecipeDraft } from '@opendish/contracts';

import { ReviewScreen } from '@/features/recipe-import/review-screen.tsx';
import type { SaveRecipeResult } from '@/domain/recipe-save.ts';
import type { RecipeMutationVariables } from '@/features/recipe-editor/use-recipe-mutation.ts';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    storage: { from: vi.fn() },
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

const TEST_DRAFT: RecipeDraft = {
  title: 'Imported Stew',
  description: 'A hearty stew.',
  servings: 6,
  prepTimeMinutes: 15,
  cookTimeMinutes: 90,
  sourceName: 'Recipe Blog',
  sourceUrl: 'https://example.com/stew',
  ingredients: [
    { name: 'Beef', quantity: makeQuantity(2, 1), unit: 'lbs' },
    { name: 'Carrots', quantity: makeQuantity(3, 1), unit: '' },
  ],
  steps: [{ text: 'Brown the beef.' }, { text: 'Simmer with vegetables.' }],
  tags: ['dinner'],
};

function renderReviewScreen(
  props: Partial<React.ComponentProps<typeof ReviewScreen>> = {},
) {
  const onDiscard = vi.fn();
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ReviewScreen
        draft={TEST_DRAFT}
        origin="imported"
        extractionMethod="ai"
        onDiscard={onDiscard}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onDiscard, user };
}

describe('ReviewScreen (T040)', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ recipeId: 'r1', headVersion: 1 });
  });

  it('renders the draft pre-filled in the editor', () => {
    renderReviewScreen();

    expect(screen.getByLabelText(/Title/i)).toHaveValue('Imported Stew');
    expect(screen.getByLabelText(/Description/i)).toHaveValue('A hearty stew.');
    expect(screen.getByLabelText(/Servings/i)).toHaveValue(6);
    expect(screen.getByLabelText(/Prep \(min\)/i)).toHaveValue(15);
    expect(screen.getByLabelText(/Cook \(min\)/i)).toHaveValue(90);
    expect(screen.getByLabelText(/Source name/i)).toHaveValue('Recipe Blog');
    expect(screen.getByLabelText(/Source URL/i)).toHaveValue(
      'https://example.com/stew',
    );
    expect(screen.getByLabelText(/Ingredient 1 name/i)).toHaveValue('Beef');
    expect(screen.getByLabelText(/Ingredient 1 quantity/i)).toHaveValue('2');
    expect(screen.getByLabelText(/Ingredient 1 unit/i)).toHaveValue('lbs');
    expect(screen.getByRole('textbox', { name: /Step 1/i })).toHaveValue(
      'Brown the beef.',
    );
  });

  it('shows the AI extraction warning when extractionMethod is ai', () => {
    renderReviewScreen();
    expect(
      screen.getByText(/Extracted by AI — please review carefully/i),
    ).toBeInTheDocument();
  });

  it('shows the structured markup indicator when extractionMethod is structured_markup', () => {
    renderReviewScreen({ extractionMethod: 'structured_markup' });
    expect(
      screen.getByText(/Extracted from structured page data/i),
    ).toBeInTheDocument();
  });

  it('shows the video metadata indicator when extractionMethod is video_metadata', () => {
    renderReviewScreen({ extractionMethod: 'video_metadata' });
    expect(
      screen.getByText(/Extracted from a video caption or description/i),
    ).toBeInTheDocument();
  });

  it('applies user edits and saves the edited draft with origin imported', async () => {
    const { user } = renderReviewScreen();

    const titleInput = screen.getByLabelText(/Title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Edited Stew');

    const firstQuantityInput = screen.getByLabelText(/Ingredient 1 quantity/i);
    await user.clear(firstQuantityInput);
    await user.type(firstQuantityInput, '3');

    const firstStepInput = screen.getByRole('textbox', { name: /Step 1/i });
    await user.clear(firstStepInput);
    await user.type(firstStepInput, 'Sear the beef well.');

    await user.click(
      screen.getByRole('button', { name: /Save imported recipe/i }),
    );

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const call = mockMutateAsync.mock.calls[0];
    expect(call).toBeDefined();
    const [variables] = call!;
    expect(variables.draft.title).toBe('Edited Stew');
    expect(variables.draft.origin).toBe('imported');
    expect(variables.draft.recipeId).toBeNull();
    expect(variables.draft.changeKind).toBe('manual_edit');
    expect(variables.draft.ingredients[0]).toMatchObject({
      name: 'Beef',
      quantity: { num: 3, den: 1 },
      unit: 'lbs',
    });
    expect(variables.draft.steps[0]).toMatchObject({
      text: 'Sear the beef well.',
    });
  });

  it('discards the review without calling save', async () => {
    const { onDiscard, user } = renderReviewScreen();

    await user.click(
      screen.getByRole('button', { name: /Discard and start over/i }),
    );

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows the AI estimate note for AI-extracted drafts', () => {
    renderReviewScreen({ origin: 'imported', extractionMethod: 'ai' });
    expect(
      screen.getByText(/AI-generated values are estimates, please review/i),
    ).toBeInTheDocument();
  });

  it('shows the AI estimate note for video metadata drafts', () => {
    renderReviewScreen({ origin: 'imported', extractionMethod: 'video_metadata' });
    expect(
      screen.getByText(/AI-generated values are estimates, please review/i),
    ).toBeInTheDocument();
  });

  it('renders an AI-generated draft with the generation banner and estimate note', () => {
    renderReviewScreen({ origin: 'ai_generated' });
    expect(screen.getByText(/Review AI-generated recipe/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Generated by AI — please review carefully/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/AI-generated values are estimates, please review/i),
    ).toBeInTheDocument();
  });

  it('saves an AI-generated draft with origin ai_generated', async () => {
    const { user } = renderReviewScreen({ origin: 'ai_generated' });

    const titleInput = screen.getByLabelText(/Title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Edited Generated Stew');

    await user.click(
      screen.getByRole('button', { name: /Save generated recipe/i }),
    );

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const call = mockMutateAsync.mock.calls[0];
    expect(call).toBeDefined();
    const [variables] = call!;
    expect(variables.draft.title).toBe('Edited Generated Stew');
    expect(variables.draft.origin).toBe('ai_generated');
  });

  it('calls onSaved and ignores repeated submissions after saving', async () => {
    const onSaved = vi.fn();
    const { user } = renderReviewScreen({
      origin: 'ai_generated',
      onSaved,
    });
    const saveButton = screen.getByRole('button', {
      name: /Save generated recipe/i,
    });

    await user.click(saveButton);
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('r1');
    });
    await user.click(saveButton);

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(saveButton).toBeDisabled();
  });
});
