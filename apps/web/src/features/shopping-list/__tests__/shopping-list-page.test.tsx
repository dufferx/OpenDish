import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeQuantity } from '@opendish/contracts';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShoppingListPage } from '@/features/shopping-list/shopping-list-page.tsx';
import type { ShoppingListItem } from '@/features/shopping-list/shopping-list-types.ts';

const togglePurchased = vi.fn();
const updateItem = vi.fn();
const deleteItem = vi.fn();
const addManualItem = vi.fn();

vi.mock('@/features/shopping-list/shopping-list-queries.ts', () => ({
  useShoppingListItems: vi.fn(),
  useShoppingListActions: () => ({
    togglePurchased,
    updateItem,
    deleteItem,
    addManualItem,
    addRecipe: vi.fn(),
    isToggling: false,
    isUpdating: false,
    isDeleting: false,
    isAddingManual: false,
    isAddingRecipe: false,
  }),
}));

import { useShoppingListItems } from '@/features/shopping-list/shopping-list-queries.ts';

function item(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: `item-${overrides.name ?? crypto.randomUUID()}`,
    name: 'Ingredient',
    quantity: makeQuantity(1, 1),
    unit: 'cup',
    isPurchased: false,
    sourceRecipeId: null,
    servingsUsed: null,
    position: 0,
    sourceRecipeTitle: null,
    ...overrides,
  };
}

function renderPage(items: ShoppingListItem[] = [], isLoading = false) {
  vi.mocked(useShoppingListItems).mockReturnValue({
    data: items,
    isLoading,
    error: null,
    refetch: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: true,
    status: 'success',
  } as unknown as ReturnType<typeof useShoppingListItems>);

  render(
    <MemoryRouter>
      <ShoppingListPage />
    </MemoryRouter>,
  );
}

describe('ShoppingListPage (T065)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    togglePurchased.mockResolvedValue(undefined);
    updateItem.mockResolvedValue(undefined);
    deleteItem.mockResolvedValue(undefined);
    addManualItem.mockResolvedValue(undefined);
  });

  it('renders a loading state', () => {
    renderPage([], true);
    expect(screen.getByText(/loading shopping list/i)).toBeInTheDocument();
  });

  it('shows an empty state when the list is empty', () => {
    renderPage([]);
    expect(
      screen.getByText(/your shopping list is empty/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/add ingredients from a recipe/i),
    ).toBeInTheDocument();
  });

  it('groups items by purchased status and visually distinguishes purchased items', () => {
    renderPage([
      item({ id: 'a', name: 'Milk', isPurchased: false, position: 0 }),
      item({ id: 'b', name: 'Eggs', isPurchased: true, position: 1 }),
    ]);

    expect(
      screen.getByRole('heading', { name: /to buy/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /purchased/i }),
    ).toBeInTheDocument();

    const milk = screen.getByText('Milk');
    const eggs = screen.getByText('Eggs');
    expect(milk).not.toHaveClass('line-through');
    expect(eggs).toHaveClass('line-through');
  });

  it('toggles the purchased state via the checkbox', async () => {
    const user = userEvent.setup();
    renderPage([item({ id: 'a', name: 'Milk' })]);

    const checkbox = screen.getByRole('checkbox', {
      name: /mark milk as purchased/i,
    });
    await user.click(checkbox);

    expect(togglePurchased).toHaveBeenCalledWith({
      id: 'a',
      isPurchased: true,
    });
  });

  it('opens a confirmation dialog before deleting an item', async () => {
    const user = userEvent.setup();
    renderPage([item({ id: 'a', name: 'Milk' })]);

    await user.click(screen.getByRole('button', { name: /delete milk/i }));
    expect(
      screen.getByRole('dialog', { name: /delete item/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(deleteItem).toHaveBeenCalledWith('a');
  });

  it('edits an item inline with quantity parsing', async () => {
    const user = userEvent.setup();
    renderPage([
      item({
        id: 'a',
        name: 'Milk',
        quantity: makeQuantity(1, 1),
        unit: 'cup',
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /edit milk/i }));

    const nameInput = screen.getByLabelText(/item name/i);
    const qtyInput = screen.getByLabelText(/quantity/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Whole milk');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1 1/2');

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(updateItem).toHaveBeenCalledTimes(1);
    const updated = updateItem.mock.calls[0][0] as ShoppingListItem;
    expect(updated.name).toBe('Whole milk');
    expect(updated.quantity).toEqual(makeQuantity(3, 2));
  });

  it('rejects invalid quantities and empty names when editing', async () => {
    const user = userEvent.setup();
    renderPage([item({ id: 'a', name: 'Milk' })]);

    await user.click(screen.getByRole('button', { name: /edit milk/i }));

    const nameInput = screen.getByLabelText(/item name/i);
    const qtyInput = screen.getByLabelText(/quantity/i);
    await user.clear(nameInput);
    await user.clear(qtyInput);
    await user.type(qtyInput, 'not-a-quantity');

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(updateItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /item name is required/i,
    );
  });

  it('adds a manual item with optional quantity and unit', async () => {
    const user = userEvent.setup();
    renderPage([]);

    await user.type(screen.getByPlaceholderText(/name/i), 'Bread');
    await user.type(screen.getByPlaceholderText(/qty/i), '2');
    await user.type(screen.getByPlaceholderText(/unit/i), 'loaves');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(addManualItem).toHaveBeenCalledWith({
      name: 'Bread',
      quantityText: '2',
      unit: 'loaves',
    });
  });

  it('renders a source recipe link for recipe-originated items', () => {
    renderPage([
      item({
        id: 'a',
        name: 'Flour',
        sourceRecipeId: 'recipe-1',
        sourceRecipeTitle: 'Pancakes',
      }),
    ]);

    const link = screen.getByRole('link', { name: /from pancakes/i });
    expect(link).toHaveAttribute('href', '/recipes/recipe-1');
  });
});
