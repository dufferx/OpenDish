import { useMemo, useState } from 'react';
import {
  CheckIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  ShoppingCartIcon,
  Trash2Icon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, ErrorState, Loading } from '@/app/states';
import { ConfirmDialog } from '@/app/confirm-dialog.tsx';
import { formatQuantity, parseQuantityInput } from '@/domain/rational.ts';
import { cn } from '@/lib/utils';

import {
  useShoppingListActions,
  useShoppingListItems,
} from './shopping-list-queries.ts';
import type { ShoppingListItem } from './shopping-list-types.ts';

const SINGULAR_UNITS: Readonly<Record<string, string>> = {
  cups: 'cup',
  tablespoons: 'tablespoon',
  teaspoons: 'teaspoon',
  ounces: 'ounce',
  pounds: 'pound',
  grams: 'gram',
  kilograms: 'kilogram',
  liters: 'liter',
  milliliters: 'milliliter',
};

function displayUnit(
  unit: string | null,
  quantity: { num: number; den: number } | null,
): string | null {
  if (!unit || !quantity || quantity.num !== quantity.den) return unit;
  return SINGULAR_UNITS[unit.toLowerCase()] ?? unit;
}

function formatItemLine(item: ShoppingListItem): string {
  const parts: string[] = [];
  if (item.quantity !== null) parts.push(formatQuantity(item.quantity));
  const unit = displayUnit(item.unit, item.quantity);
  if (unit !== null) parts.push(unit);
  return parts.join(' ');
}

interface EditFormState {
  name: string;
  quantityText: string;
  unit: string;
}

function EditForm({
  item,
  onSave,
  onCancel,
  isSaving,
}: {
  item: ShoppingListItem;
  onSave: (item: ShoppingListItem) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<EditFormState>({
    name: item.name,
    quantityText: item.quantity === null ? '' : formatQuantity(item.quantity),
    unit: item.unit ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    const trimmedName = form.name.trim();
    if (trimmedName === '') {
      setError('Item name is required.');
      return;
    }

    const quantity =
      form.quantityText.trim() === ''
        ? null
        : parseQuantityInput(form.quantityText);
    if (form.quantityText.trim() !== '' && quantity === null) {
      setError(`"${form.quantityText}" is not a valid quantity.`);
      return;
    }

    onSave({
      ...item,
      name: trimmedName,
      quantity,
      unit: form.unit.trim() || null,
    });
  }

  return (
    <div className="grid flex-1 gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`edit-name-${item.id}`} className="sr-only">
          Item name
        </Label>
        <Input
          id={`edit-name-${item.id}`}
          value={form.name}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, name: event.target.value }))
          }
          placeholder="Name"
          disabled={isSaving}
        />
      </div>
      <div className="flex gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor={`edit-qty-${item.id}`} className="sr-only">
            Quantity
          </Label>
          <Input
            id={`edit-qty-${item.id}`}
            value={form.quantityText}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, quantityText: event.target.value }))
            }
            placeholder="Qty"
            disabled={isSaving}
          />
        </div>
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor={`edit-unit-${item.id}`} className="sr-only">
            Unit
          </Label>
          <Input
            id={`edit-unit-${item.id}`}
            value={form.unit}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, unit: event.target.value }))
            }
            placeholder="Unit"
            disabled={isSaving}
          />
        </div>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isSaving}
          onClick={() => void handleSave()}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSaving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ShoppingListItemRow({
  item,
  onDelete,
}: {
  item: ShoppingListItem;
  onDelete: () => void;
}) {
  const { togglePurchased, updateItem, isUpdating, togglingItemId } =
    useShoppingListActions();
  const [isEditing, setIsEditing] = useState(false);
  const isTogglingThis = togglingItemId === item.id;

  if (isEditing) {
    return (
      <li className="rounded-xl border bg-card p-4">
        <EditForm
          item={item}
          isSaving={isUpdating}
          onSave={async (updated) => {
            await updateItem(updated);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      </li>
    );
  }

  const line = formatItemLine(item);

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors duration-300 motion-reduce:transition-none',
        item.isPurchased && 'bg-muted/50',
      )}
    >
      <label
        htmlFor={`purchased-${item.id}`}
        className="flex min-h-11 items-center gap-3 py-1"
      >
        <span className="relative inline-flex">
          <Checkbox
            id={`purchased-${item.id}`}
            checked={item.isPurchased}
            disabled={isTogglingThis}
            onCheckedChange={async (checked) => {
              await togglePurchased({
                id: item.id,
                isPurchased: checked === true,
              });
            }}
            className="size-6 transition-transform motion-safe:duration-150 motion-safe:data-checked:scale-110"
            aria-label={`Mark ${item.name} as ${item.isPurchased ? 'not purchased' : 'purchased'}`}
          />
          {isTogglingThis ? (
            <Loader2Icon
              className="absolute -top-1 -right-1 size-3 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          ) : null}
        </span>
      </label>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'flex flex-wrap items-center gap-2 text-base font-medium transition-colors duration-300 motion-reduce:transition-none',
            item.isPurchased && 'text-muted-foreground line-through',
          )}
        >
          {item.name}
          {item.isPurchased ? (
            <CheckIcon
              className="size-3.5 shrink-0 text-emerald-600 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in"
              aria-hidden="true"
            />
          ) : null}
          {isTogglingThis ? (
            <span role="status" className="text-xs font-normal text-muted-foreground">
              Saving…
            </span>
          ) : null}
        </p>
        {line ? (
          <p
            className={cn(
              'text-sm transition-colors duration-300 motion-reduce:transition-none',
              item.isPurchased
                ? 'text-muted-foreground line-through'
                : 'text-muted-foreground',
            )}
          >
            {line}
          </p>
        ) : null}
        {item.sourceRecipeId ? (
          <p className="mt-1 text-sm">
            <Link
              to={`/recipes/${item.sourceRecipeId}`}
              className="text-primary hover:underline"
            >
              From {item.sourceRecipeTitle ?? 'a recipe'}
            </Link>
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10"
          aria-label={`Edit ${item.name}`}
          onClick={() => setIsEditing(true)}
        >
          <PencilIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10"
          aria-label={`Delete ${item.name}`}
          onClick={onDelete}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </li>
  );
}

function ManualAddForm() {
  const { addManualItem, isAddingManual } = useShoppingListActions();
  const [form, setForm] = useState({ name: '', quantityText: '', unit: '' });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await addManualItem(form);
      setForm({ name: '', quantityText: '', unit: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add item.');
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="manual-name">Add an item</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="manual-name"
            value={form.name}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, name: event.target.value }))
            }
            placeholder="Name"
            className="flex-[2]"
          />
          <Input
            value={form.quantityText}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, quantityText: event.target.value }))
            }
            placeholder="Qty"
            className="flex-1"
          />
          <Input
            value={form.unit}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, unit: event.target.value }))
            }
            placeholder="Unit"
            className="flex-1"
          />
          <Button type="submit" disabled={isAddingManual} className="gap-1">
            <PlusIcon className="size-4" />
            Add
          </Button>
        </div>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ShoppingListPage() {
  const { data: items, isLoading, error, refetch } = useShoppingListItems();
  const [deleteTarget, setDeleteTarget] = useState<ShoppingListItem | null>(
    null,
  );
  const { deleteItem, isDeleting } = useShoppingListActions();

  const { toBuy, purchased } = useMemo(() => {
    const list = [...(items ?? [])];
    list.sort((a, b) => {
      if (a.isPurchased !== b.isPurchased) return a.isPurchased ? 1 : -1;
      return a.position - b.position;
    });
    return {
      toBuy: list.filter((item) => !item.isPurchased),
      purchased: list.filter((item) => item.isPurchased),
    };
  }, [items]);

  if (isLoading) return <Loading label="Loading shopping list…" />;
  if (error)
    return (
      <ErrorState
        title="Could not load shopping list"
        description={error.message}
        onRetry={() => void refetch()}
      />
    );

  return (
    <section className="flex flex-col gap-6" aria-labelledby="shopping-title">
      <h1 id="shopping-title" className="text-2xl font-semibold tracking-tight">
        Shopping list
      </h1>

      <ManualAddForm />

      {toBuy.length === 0 && purchased.length === 0 ? (
        <EmptyState
          icon={ShoppingCartIcon}
          title="Your shopping list is empty"
          description="Add ingredients from a recipe, or use the form above to add items manually."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {toBuy.length > 0 ? (
            <section aria-labelledby="to-buy-heading">
              <h2
                id="to-buy-heading"
                className="mb-3 text-sm font-medium text-muted-foreground"
              >
                To buy
              </h2>
              <ul className="flex flex-col gap-3">
                {toBuy.map((item) => (
                  <ShoppingListItemRow
                    key={item.id}
                    item={item}
                    onDelete={() => setDeleteTarget(item)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {purchased.length > 0 ? (
            <section aria-labelledby="purchased-heading">
              <h2
                id="purchased-heading"
                className="mb-3 text-sm font-medium text-muted-foreground"
              >
                Purchased
              </h2>
              <ul className="flex flex-col gap-3">
                {purchased.map((item) => (
                  <ShoppingListItemRow
                    key={item.id}
                    item={item}
                    onDelete={() => setDeleteTarget(item)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete item?"
        description={`"${deleteTarget?.name ?? ''}" will be removed from your list.`}
        confirmLabel="Delete"
        pending={isDeleting}
        onConfirm={() => {
          if (deleteTarget) {
            void deleteItem(deleteTarget.id).then(() => setDeleteTarget(null));
          }
        }}
      />
    </section>
  );
}
