import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  makeQuantity,
  validRecipeDraft,
  type ModificationProposal,
} from '@opendish/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModificationReview } from '@/features/modification-review/modification-review.tsx';

const proposal: ModificationProposal = {
  summary: 'Make the sauce richer and serve four people.',
  operations: [
    {
      kind: 'updateIngredient',
      position: 0,
      patch: { quantity: makeQuantity(3, 4) },
    },
    { kind: 'setServings', servings: 4 },
    {
      kind: 'updateStep',
      position: 1,
      text: 'Simmer the tomatoes slowly into a rich sauce.',
    },
  ],
  resultingRecipe: {
    ...validRecipeDraft,
    servings: 4,
    ingredients: [
      {
        ...validRecipeDraft.ingredients[0],
        quantity: makeQuantity(3, 4),
      },
      ...validRecipeDraft.ingredients.slice(1),
    ],
    steps: [
      validRecipeDraft.steps[0],
      { text: 'Simmer the tomatoes slowly into a rich sauce.' },
      validRecipeDraft.steps[2],
    ],
  },
};

const onApply = vi.fn();
const onSaveAsVariant = vi.fn();
const onDiscard = vi.fn();
const onRegenerate = vi.fn();

function renderReview({
  isStale = false,
  pendingAction = null,
}: {
  isStale?: boolean;
  pendingAction?: 'apply' | 'variant' | 'discard' | null;
} = {}) {
  render(
    <ModificationReview
      currentRecipe={validRecipeDraft}
      proposal={proposal}
      isStale={isStale}
      pendingAction={pendingAction}
      onApply={onApply}
      onSaveAsVariant={onSaveAsVariant}
      onDiscard={onDiscard}
      onRegenerate={onRegenerate}
    />,
  );
}

describe('ModificationReview (T051)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks AI content as an unapplied suggestion and summarizes its operations', () => {
    renderReview();

    expect(screen.getByRole('status')).toHaveTextContent(
      /AI suggestion.*not applied/i,
    );
    expect(
      screen.getByText('Make the sauce richer and serve four people.'),
    ).toBeVisible();
    expect(screen.getByText(/Ingredient 1.*Spaghetti/i)).toBeVisible();
    expect(screen.getByText(/Servings.*2.*4/i)).toBeVisible();
    expect(screen.getByText(/Step 2/i)).toBeVisible();
  });

  it('compares the current saved recipe with the AI result using readable fractions', () => {
    renderReview();

    const saved = screen.getByRole('region', {
      name: /current saved recipe/i,
    });
    const suggested = screen.getByRole('region', {
      name: /AI suggested recipe/i,
    });

    expect(saved).not.toBe(suggested);
    expect(saved).toHaveTextContent(/2 servings/i);
    expect(saved).toHaveTextContent(/½ lb Spaghetti/i);
    expect(saved).toHaveTextContent('Simmer the tomatoes into a sauce.');

    expect(suggested).toHaveTextContent(/4 servings/i);
    expect(suggested).toHaveTextContent(/¾ lb Spaghetti/i);
    expect(suggested).toHaveTextContent(
      'Simmer the tomatoes slowly into a rich sauce.',
    );
  });

  it('offers explicit apply, variant, and discard actions', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole('button', { name: /^Apply$/i }));
    await user.click(screen.getByRole('button', { name: /Save as variant/i }));
    await user.click(screen.getByRole('button', { name: /^Discard$/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onSaveAsVariant).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate decisions while an action is in flight', () => {
    renderReview({ pendingAction: 'apply' });

    for (const button of within(
      screen.getByRole('group', { name: /proposal actions/i }),
    ).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('blocks stale apply and variant actions and offers regeneration', async () => {
    const user = userEvent.setup();
    renderReview({ isStale: true });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /recipe has changed.*regenerate/i,
    );
    expect(screen.getByRole('button', { name: /^Apply$/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Save as variant/i }),
    ).toBeDisabled();

    const regenerate = screen.getByRole('button', { name: /Regenerate/i });
    expect(regenerate).toBeEnabled();
    await user.click(regenerate);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
