import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { RecipeEditorForm } from '@/features/recipe-editor/recipe-editor-form.tsx';
import type { RecipeDraft } from '@opendish/contracts';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    storage: { from: vi.fn() },
  },
}));

function renderForm(
  props: Partial<React.ComponentProps<typeof RecipeEditorForm>> = {},
) {
  const onSubmit =
    vi.fn<(draft: RecipeDraft, imageFile: File | null) => Promise<void>>();
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <RecipeEditorForm onSubmit={onSubmit} isSubmitting={false} {...props} />
    </MemoryRouter>,
  );
  return { onSubmit, user };
}

describe('RecipeEditorForm (T031)', () => {
  it('blocks submit and shows an error when the title is empty', async () => {
    const { onSubmit, user } = renderForm();

    const titleInput = screen.getByLabelText(/Title/i);
    await user.clear(titleInput);

    await user.click(screen.getByRole('button', { name: /Save recipe/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Title is required/i,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submit when no ingredients remain', async () => {
    const { onSubmit, user } = renderForm();

    await user.type(screen.getByLabelText(/Title/i), 'Test Recipe');
    await user.type(
      screen.getByRole('textbox', { name: /Step 1/i }),
      'Do something.',
    );
    await user.click(
      screen.getByRole('button', { name: /Remove ingredient 1/i }),
    );
    await user.click(screen.getByRole('button', { name: /Save recipe/i }));

    expect(
      await screen.findByText(/At least one ingredient is required/i),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submit when a quantity cannot be parsed', async () => {
    const { onSubmit, user } = renderForm();

    await user.type(screen.getByLabelText(/Title/i), 'Test Recipe');
    await user.type(screen.getByLabelText(/Ingredient 1 name/i), 'Salt');
    await user.type(
      screen.getByRole('textbox', { name: /Step 1/i }),
      'Do something.',
    );

    const quantityInput = screen.getByLabelText(/Ingredient 1 quantity/i);
    await user.type(quantityInput, 'not-a-quantity');

    await user.click(screen.getByRole('button', { name: /Save recipe/i }));

    expect(
      await screen.findByText(
        /Enter a quantity like 2, 1\.5, 1\/2, 1 ½, or leave blank/i,
      ),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with a parsed draft and no image when the form is valid', async () => {
    const { onSubmit, user } = renderForm();

    await user.type(screen.getByLabelText(/Title/i), 'Tomato Pasta');
    await user.type(
      screen.getByLabelText(/Description/i),
      'A simple weeknight pasta.',
    );
    await user.clear(screen.getByLabelText(/Servings/i));
    await user.type(screen.getByLabelText(/Servings/i), '4');

    await user.type(screen.getByLabelText(/Ingredient 1 name/i), 'Spaghetti');
    await user.type(screen.getByLabelText(/Ingredient 1 quantity/i), '1 ½');
    await user.type(screen.getByLabelText(/Ingredient 1 unit/i), 'lb');

    await user.type(
      screen.getByRole('textbox', { name: /Step 1/i }),
      'Boil water.',
    );

    await user.click(screen.getByRole('button', { name: /Save recipe/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const [draft, imageFile] = onSubmit.mock.calls[0]!;
    expect(draft.title).toBe('Tomato Pasta');
    expect(draft.description).toBe('A simple weeknight pasta.');
    expect(draft.servings).toBe(4);
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.ingredients[0]).toMatchObject({
      name: 'Spaghetti',
      quantity: { num: 3, den: 2 },
      unit: 'lb',
    });
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0]).toMatchObject({ text: 'Boil water.' });
    expect(imageFile).toBeNull();
  });

  it('treats a blank ingredient quantity as quantity-less', async () => {
    const { onSubmit, user } = renderForm();

    await user.type(screen.getByLabelText(/Title/i), 'Salted Water');
    await user.type(screen.getByLabelText(/Ingredient 1 name/i), 'Salt');

    await user.type(
      screen.getByRole('textbox', { name: /Step 1/i }),
      'Add salt.',
    );

    await user.click(screen.getByRole('button', { name: /Save recipe/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const [draft] = onSubmit.mock.calls[0]!;
    expect(draft.ingredients[0].quantity).toBeNull();
  });
});
