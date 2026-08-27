import { useRef, useState } from 'react';
import {
  CameraIcon,
  ImageIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, ErrorState, Loading } from '@/app/states';

import { useUserProductActions, useUserProducts } from './product-queries.ts';
import { extractProductLabel } from './product-label-api.ts';
import type { UserProduct, UserProductInput } from './product-types.ts';

const EMPTY_FORM: UserProductInput = {
  name: '',
  brand: null,
  servingSizeText: '1 serving',
  servingMassG: null,
  servingVolumeMl: null,
  calories: 0,
  proteinGrams: 0,
  carbohydratesGrams: 0,
  status: 'confirmed',
};

function ProductForm({
  product,
  prefill,
  onDone,
}: {
  product: UserProduct | null;
  prefill?: UserProductInput | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState<UserProductInput>(() =>
    product
      ? {
          name: product.name,
          brand: product.brand,
          servingSizeText: product.servingSizeText,
          servingMassG: product.servingMassG,
          servingVolumeMl: product.servingVolumeMl,
          calories: product.calories,
          proteinGrams: product.proteinGrams,
          carbohydratesGrams: product.carbohydratesGrams,
          status: product.status,
        }
      : (prefill ?? EMPTY_FORM),
  );
  const [error, setError] = useState<string | null>(null);
  const { saveProduct } = useUserProductActions();

  function update(
    field: keyof UserProductInput,
    value: string | number | null,
  ) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const servingSizeText = form.servingSizeText.trim();
    if (!name || !servingSizeText) {
      setError('Product name and serving size are required.');
      return;
    }
    if (form.servingMassG === null && form.servingVolumeMl === null) {
      setError('Enter grams or millilitres for one serving.');
      return;
    }
    setError(null);
    void saveProduct
      .mutateAsync({
        id: product?.id,
        input: { ...form, name, servingSizeText },
      })
      .then(onDone)
      .catch(() => undefined);
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-1.5">
        <Label htmlFor="product-name">Product name</Label>
        <Input
          id="product-name"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="Greek yogurt"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="product-brand">Brand (optional)</Label>
        <Input
          id="product-brand"
          value={form.brand ?? ''}
          onChange={(e) => update('brand', e.target.value || null)}
          placeholder="Brand"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="serving-size">Label serving</Label>
          <Input
            id="serving-size"
            value={form.servingSizeText}
            onChange={(e) => update('servingSizeText', e.target.value)}
            placeholder="1 container"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="serving-mass">Grams</Label>
          <Input
            id="serving-mass"
            type="number"
            min="0"
            step="0.1"
            value={form.servingMassG ?? ''}
            onChange={(e) =>
              update(
                'servingMassG',
                e.target.value ? Number(e.target.value) : null,
              )
            }
            placeholder="150"
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="serving-volume">Millilitres</Label>
          <Input
            id="serving-volume"
            type="number"
            min="0"
            step="0.1"
            value={form.servingVolumeMl ?? ''}
            onChange={(e) =>
              update(
                'servingVolumeMl',
                e.target.value ? Number(e.target.value) : null,
              )
            }
            placeholder="200"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="product-calories">Calories</Label>
          <Input
            id="product-calories"
            type="number"
            min="0"
            step="0.1"
            value={form.calories}
            onChange={(e) => update('calories', Number(e.target.value))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="product-protein">Protein (g)</Label>
          <Input
            id="product-protein"
            type="number"
            min="0"
            step="0.1"
            value={form.proteinGrams}
            onChange={(e) => update('proteinGrams', Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="product-carbs">Carbohydrates (g)</Label>
        <Input
          id="product-carbs"
          type="number"
          min="0"
          step="0.1"
          value={form.carbohydratesGrams}
          onChange={(e) => update('carbohydratesGrams', Number(e.target.value))}
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={saveProduct.isPending}>
          {saveProduct.isPending
            ? 'Saving…'
            : product
              ? 'Save changes'
              : 'Save product'}
        </Button>
        {product ? (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ProductRow({
  product,
  onEdit,
}: {
  product: UserProduct;
  onEdit: () => void;
}) {
  const { deleteProduct } = useUserProductActions();
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border bg-card p-4">
      <div className="min-w-0">
        <p className="font-medium">{product.name}</p>
        {product.brand ? (
          <p className="text-sm text-muted-foreground">{product.brand}</p>
        ) : null}
        <p className="mt-1 text-sm text-muted-foreground">
          {product.servingSizeText}
          {product.servingMassG
            ? ` · ${product.servingMassG} g`
            : product.servingVolumeMl
              ? ` · ${product.servingVolumeMl} ml`
              : ''}
        </p>
        <p className="mt-2 text-sm">
          {product.calories} kcal · {product.proteinGrams} g protein ·{' '}
          {product.carbohydratesGrams} g carbs
        </p>
        {product.status === 'estimated' ? (
          <p className="mt-1 text-xs text-amber-700">Estimated values</p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${product.name}`}
          onClick={onEdit}
        >
          <PencilIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${product.name}`}
          disabled={deleteProduct.isPending}
          onClick={() => void deleteProduct.mutateAsync(product.id)}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </li>
  );
}

export function ProductsPage() {
  const { data: products, isLoading, error, refetch } = useUserProducts();
  const [editing, setEditing] = useState<UserProduct | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [prefill, setPrefill] = useState<UserProductInput | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  async function handleLabelSelected(file: File) {
    setIsExtracting(true);
    setExtractError(null);
    try {
      const draft = await extractProductLabel(file);
      setPrefill({
        name: draft.name,
        brand: draft.brand,
        servingSizeText: draft.servingSizeText,
        servingMassG: draft.servingMassG,
        servingVolumeMl: draft.servingVolumeMl,
        calories: draft.calories,
        proteinGrams: draft.proteinGrams,
        carbohydratesGrams: draft.carbohydratesGrams,
        status: 'estimated',
      });
      setEditing(null);
      setShowForm(true);
    } catch (error) {
      setExtractError(
        error instanceof Error ? error.message : 'Could not read the label.',
      );
    } finally {
      setIsExtracting(false);
      if (labelInputRef.current) labelInputRef.current.value = '';
    }
  }

  if (isLoading) return <Loading label="Loading products…" />;
  if (error)
    return (
      <ErrorState
        title="Could not load products"
        description={error.message}
        onRetry={() => void refetch()}
      />
    );

  return (
    <section className="grid gap-6" aria-labelledby="products-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            id="products-title"
            className="text-2xl font-semibold tracking-tight"
          >
            My products
          </h1>
          <p className="mt-1 text-muted-foreground">
            Save label values once and reuse them for more precise recipe
            macros.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setPrefill(null);
            setShowForm(true);
          }}
        >
          <PlusIcon className="size-4" /> Add product
        </Button>
      </div>
      <Drawer
        open={showForm || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setShowForm(false);
          }
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {editing ? 'Edit product' : 'Add product'}
            </DrawerTitle>
            <DrawerDescription>
              Enter exactly what the nutrition label says for one serving.
            </DrawerDescription>
            {!editing ? (
              <>
                <input
                  ref={labelInputRef}
                  className="hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  aria-label="Take nutrition label photo"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleLabelSelected(file);
                  }}
                />
                <input
                  ref={galleryInputRef}
                  className="hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Choose nutrition label from gallery"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleLabelSelected(file);
                  }}
                />
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-fit"
                    disabled={isExtracting}
                    onClick={() => labelInputRef.current?.click()}
                  >
                    <CameraIcon className="size-4" />
                    {isExtracting ? 'Reading label…' : 'Take photo'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-fit"
                    disabled={isExtracting}
                    onClick={() => galleryInputRef.current?.click()}
                  >
                    <ImageIcon className="size-4" />
                    Choose from gallery
                  </Button>
                </div>
                {isExtracting ? (
                  <div
                    className="mt-3 flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3 text-sm"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2Icon
                      className="mt-0.5 size-5 shrink-0 animate-spin text-primary"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium">
                        Reading your nutrition label…
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        Sending the image securely and extracting the visible
                        values. This can take a few seconds.
                      </p>
                    </div>
                  </div>
                ) : null}
                {extractError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {extractError}
                  </p>
                ) : null}
              </>
            ) : null}
          </DrawerHeader>
          <div className="overflow-y-auto px-5 pb-6">
            <ProductForm
              product={editing}
              key={
                prefill
                  ? `prefill-${prefill.name}-${prefill.calories}`
                  : 'manual'
              }
              prefill={prefill}
              onDone={() => {
                setEditing(null);
                setPrefill(null);
                setShowForm(false);
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>
      <Card className="border-dashed">
        <CardContent className="flex items-start gap-3 py-4">
          <CameraIcon className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="font-medium">Scan a nutrition label with AI</p>
            <p className="text-sm text-muted-foreground">
              Take a photo or choose one from your gallery. Extracted values
              always require your confirmation before saving.
            </p>
          </div>
        </CardContent>
      </Card>
      {!products || products.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Add a product from a nutrition label to use it in your recipes."
          action={
            <Button
              onClick={() => {
                setPrefill(null);
                setShowForm(true);
              }}
            >
              Add your first product
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              onEdit={() => {
                setEditing(product);
                setShowForm(false);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
