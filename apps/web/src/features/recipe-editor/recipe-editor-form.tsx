import { zodResolver } from '@hookform/resolvers/zod';
import {
  GripVerticalIcon,
  ImageIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  useFieldArray,
  useForm,
  Controller,
  type FieldError,
  useWatch,
  type Resolver,
} from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

import {
  calculateNutrition,
  type NutritionRecord,
  type RecipeDraft,
} from '@opendish/contracts';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getRecipeImageUrl, validateRecipeImage } from '@/lib/recipe-images.ts';
import type { NutritionSourceOption } from '@/features/products/nutrition-source-queries.ts';
import { parseQuantityInput } from '@/domain/rational.ts';
import { NutritionSummary } from '@/features/recipes/nutrition-summary.tsx';
import { RecipeDraftAssistant } from '@/features/recipe-conversation';
import {
  estimateItemsToRecord,
  estimateMissingNutrition,
} from '@/features/recipes/nutrition-estimate-api.ts';

import {
  parseRecipeFormValues,
  recipeFormSchema,
  type RecipeFormValues,
} from './form-schema.ts';

export interface RecipeEditorFormProps {
  /** Existing draft when editing; omitted when creating. */
  initialValues?: Partial<RecipeFormValues>;
  existingImagePath?: string | null;
  recipeId?: string | null;
  onSubmit: (
    draft: RecipeDraft,
    imageFile: File | null,
    calculatedNutrition?: NutritionRecord,
  ) => Promise<void>;
  isSubmitting: boolean;
  submitLabel?: string;
  /** Optional destination for the Cancel button (defaults to recipe detail or home). */
  cancelTo?: string;
  /** Called instead of navigating when the Cancel button is pressed. */
  onCancel?: () => void;
  /** Optional note rendered near timing fields to flag AI-generated estimates. */
  aiEstimateNote?: ReactNode;
  nutritionSources?: NutritionSourceOption[];
  isLoadingNutritionSources?: boolean;
  /** Enables the local, review-before-apply AI assistant for this draft. */
  enableDraftAssistant?: boolean;
}

const defaultValues: RecipeFormValues = {
  title: '',
  description: null,
  servings: 1,
  prepTimeMinutes: null,
  cookTimeMinutes: null,
  sourceName: null,
  sourceUrl: null,
  ingredients: [
    { name: '', quantityText: '', unit: '', nutritionSource: null },
  ],
  steps: [{ text: '', durationSeconds: null }],
  tags: [],
};

function mergeInitialValues(
  base: RecipeFormValues,
  overrides?: Partial<RecipeFormValues>,
): RecipeFormValues {
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    ingredients:
      overrides.ingredients && overrides.ingredients.length > 0
        ? overrides.ingredients
        : base.ingredients,
    steps:
      overrides.steps && overrides.steps.length > 0
        ? overrides.steps
        : base.steps,
    tags: overrides.tags ?? base.tags,
  };
}

export function RecipeEditorForm({
  initialValues,
  existingImagePath,
  recipeId,
  onSubmit,
  isSubmitting,
  submitLabel = 'Save recipe',
  cancelTo,
  onCancel,
  aiEstimateNote,
  nutritionSources = [],
  isLoadingNutritionSources = false,
  enableDraftAssistant = false,
}: RecipeEditorFormProps) {
  const navigate = useNavigate();
  const [imageError, setImageError] = useState<string | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [aiEstimate, setAiEstimate] = useState<{
    key: string;
    record: NutritionRecord;
  } | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<RecipeFormValues>({
    resolver: zodResolver(
      recipeFormSchema,
    ) as unknown as Resolver<RecipeFormValues>,
    defaultValues: mergeInitialValues(defaultValues, initialValues),
  });

  if (existingImagePath && existingImageUrl === null) {
    void getRecipeImageUrl(existingImagePath).then((url) => {
      if (url) setExistingImageUrl(url);
    });
  }

  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = form;

  const ingredientsArray = useFieldArray({
    control,
    name: 'ingredients',
  });
  const watchedValues = useWatch({ control });
  const parsedWatchedDraft = useMemo(
    () => parseRecipeFormValues(watchedValues as RecipeFormValues),
    [watchedValues],
  );
  const nutritionCalculation = useMemo(() => {
    const sourceByKey = new Map(
      nutritionSources.map((source) => [
        `${source.sourceType}:${source.id}`,
        source,
      ]),
    );
    return calculateNutrition(
      (watchedValues.ingredients ?? []).map((ingredient) => ({
        name: ingredient.name || 'Unnamed ingredient',
        quantity: parseQuantityInput((ingredient.quantityText ?? '').trim()),
        unit: ingredient.unit || null,
        source: ingredient.nutritionSource
          ? (sourceByKey.get(
              `${ingredient.nutritionSource.sourceType}:${ingredient.nutritionSource.sourceId}`,
            ) ?? null)
          : null,
      })),
      Number(watchedValues.servings) || 1,
    );
  }, [nutritionSources, watchedValues]);
  const nutritionInputKey = JSON.stringify({
    servings: watchedValues.servings,
    ingredients: watchedValues.ingredients,
  });
  const displayedNutrition =
    aiEstimate?.key === nutritionInputKey
      ? {
          values: {
            calories: aiEstimate.record.calories,
            proteinGrams: aiEstimate.record.proteinGrams,
            carbohydratesGrams: aiEstimate.record.carbohydratesGrams,
          },
          status: aiEstimate.record.status,
          unresolvedIngredients:
            aiEstimate.record.status === 'missing'
              ? nutritionCalculation.unresolvedIngredients
              : [],
          ingredientValues: {},
        }
      : nutritionCalculation;

  async function calculateAiEstimate() {
    if (nutritionCalculation.unresolvedIngredients.length === 0) return;
    setIsEstimating(true);
    setEstimateError(null);
    try {
      const items = await estimateMissingNutrition(
        (watchedValues.ingredients ?? [])
          .filter((ingredient) =>
            nutritionCalculation.unresolvedIngredients.includes(
              ingredient.name || 'Unnamed ingredient',
            ),
          )
          .map((ingredient) => ({
            name: ingredient.name || 'Unnamed ingredient',
            quantity: parseQuantityInput((ingredient.quantityText ?? '').trim())
              ? parseQuantityInput((ingredient.quantityText ?? '').trim())!
                  .num /
                parseQuantityInput((ingredient.quantityText ?? '').trim())!.den
              : null,
            unit: ingredient.unit || null,
          })),
      );
      const estimate = estimateItemsToRecord(
        items,
        Number(watchedValues.servings) || 1,
      );
      setAiEstimate({
        key: nutritionInputKey,
        record: {
          ...estimate,
          calories: nutritionCalculation.values.calories + estimate.calories,
          proteinGrams:
            nutritionCalculation.values.proteinGrams + estimate.proteinGrams,
          carbohydratesGrams:
            nutritionCalculation.values.carbohydratesGrams +
            estimate.carbohydratesGrams,
          status:
            items.length === nutritionCalculation.unresolvedIngredients.length
              ? 'estimated'
              : 'missing',
        },
      });
    } catch (error) {
      setEstimateError(
        error instanceof Error
          ? error.message
          : 'Could not calculate an AI estimate.',
      );
    } finally {
      setIsEstimating(false);
    }
  }

  const stepsArray = useFieldArray({
    control,
    name: 'steps',
  });

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    setImageError(null);
    const file = event.target.files?.[0];
    if (!file) return;

    const validation = validateRecipeImage(file);
    if (!validation.ok) {
      setImageError(validation.reason);
      setSelectedImageFile(null);
      setImagePreviewUrl(null);
      return;
    }

    setSelectedImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  }

  function clearImageSelection() {
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setImageError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleFormSubmit(values: RecipeFormValues) {
    clearErrors();
    const { draft, fieldErrors } = parseRecipeFormValues(values);

    if (Object.keys(fieldErrors).length > 0) {
      for (const [key, value] of Object.entries(fieldErrors)) {
        if (!value) continue;
        const fieldKey = key as keyof RecipeFormValues;
        setError(fieldKey, value as FieldError);
      }
      return;
    }

    await onSubmit(
      draft,
      selectedImageFile,
      aiEstimate?.key === nutritionInputKey
        ? aiEstimate.record
        : nutritionCalculation.unresolvedIngredients.length === 0
          ? {
              ...nutritionCalculation.values,
              sourceType: 'manual',
              sourceId: null,
              basis: 'serving',
              preparation: 'not_applicable',
              status: nutritionCalculation.status,
            }
          : undefined,
    );
  }

  const displayedImageUrl = imagePreviewUrl ?? existingImageUrl;

  function applyAssistantDraft(nextDraft: RecipeDraft) {
    form.reset({
      title: nextDraft.title,
      description: nextDraft.description,
      servings: nextDraft.servings,
      prepTimeMinutes: nextDraft.prepTimeMinutes,
      cookTimeMinutes: nextDraft.cookTimeMinutes,
      sourceName: nextDraft.sourceName,
      sourceUrl: nextDraft.sourceUrl,
      ingredients: nextDraft.ingredients.map((ingredient) => ({
        name: ingredient.name,
        quantityText: ingredient.quantity
          ? `${ingredient.quantity.num}/${ingredient.quantity.den}`
          : '',
        unit: ingredient.unit ?? '',
        nutritionSource: ingredient.nutritionSource ?? null,
      })),
      steps: nextDraft.steps.map((step) => ({
        text: step.text,
        durationSeconds: step.durationSeconds ?? null,
      })),
      tags: nextDraft.tags,
    });
  }

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      className="flex flex-col gap-6"
      aria-label="Recipe editor"
    >
      {enableDraftAssistant ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Need to adjust the recipe? Ask AI and review the changes first.
          </p>
          <RecipeDraftAssistant
            draft={
              Object.keys(parsedWatchedDraft.fieldErrors).length === 0
                ? parsedWatchedDraft.draft
                : null
            }
            onApply={applyAssistantDraft}
          />
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="e.g. Tomato Basil Pasta"
              aria-invalid={!!errors.title}
              {...register('title')}
            />
            {errors.title ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.title.message}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="A short note about the recipe"
              {...register('description')}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="servings">Servings *</Label>
              <Input
                id="servings"
                type="number"
                min={1}
                aria-invalid={!!errors.servings}
                {...register('servings')}
              />
              {errors.servings ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.servings.message}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prepTimeMinutes">Prep (min)</Label>
              <Input
                id="prepTimeMinutes"
                type="number"
                min={0}
                {...register('prepTimeMinutes')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cookTimeMinutes">Cook (min)</Label>
              <Input
                id="cookTimeMinutes"
                type="number"
                min={0}
                {...register('cookTimeMinutes')}
              />
            </div>
          </div>
          {aiEstimateNote ? (
            <p className="text-sm text-muted-foreground">{aiEstimateNote}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ingredients</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {ingredientsArray.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-2"
            >
              <Input
                placeholder="Name"
                aria-label={`Ingredient ${index + 1} name`}
                aria-invalid={!!errors.ingredients?.[index]?.name}
                {...register(`ingredients.${index}.name`)}
              />
              <Input
                placeholder="Qty: 1, 1.5, 1/2, 1 ½"
                aria-label={`Ingredient ${index + 1} quantity`}
                aria-invalid={!!errors.ingredients?.[index]?.quantityText}
                {...register(`ingredients.${index}.quantityText`)}
              />
              <Input
                placeholder="Unit"
                aria-label={`Ingredient ${index + 1} unit`}
                {...register(`ingredients.${index}.unit`)}
              />
              <Controller
                control={control}
                name={`ingredients.${index}.nutritionSource`}
                render={({ field: sourceField }) => (
                  <select
                    aria-label={`Ingredient ${index + 1} nutrition source`}
                    className="col-span-3 h-10 rounded-md border border-input bg-background px-3 text-sm sm:col-span-3"
                    value={
                      sourceField.value
                        ? `${sourceField.value.sourceType}:${sourceField.value.sourceId}`
                        : ''
                    }
                    onChange={(event) => {
                      const [sourceType, sourceId] =
                        event.target.value.split(':');
                      sourceField.onChange(
                        sourceType && sourceId
                          ? { sourceType, sourceId }
                          : null,
                      );
                    }}
                  >
                    <option value="">
                      {isLoadingNutritionSources
                        ? 'Loading nutrition sources…'
                        : 'Nutrition source (optional)'}
                    </option>
                    {nutritionSources.map((source) => (
                      <option
                        key={`${source.sourceType}:${source.id}`}
                        value={`${source.sourceType}:${source.id}`}
                      >
                        {source.label}
                      </option>
                    ))}
                  </select>
                )}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Remove ingredient ${index + 1}`}
                onClick={() => ingredientsArray.remove(index)}
              >
                <Trash2Icon className="size-4" />
              </Button>
              {errors.ingredients?.[index]?.quantityText ? (
                <p className="col-span-3 text-sm text-destructive" role="alert">
                  {errors.ingredients[index]?.quantityText?.message}
                </p>
              ) : null}
            </div>
          ))}
          {errors.ingredients?.root ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.ingredients.root.message}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() =>
              ingredientsArray.append({
                name: '',
                quantityText: '',
                unit: '',
                nutritionSource: null,
              })
            }
          >
            <PlusIcon className="size-4" />
            Add ingredient
          </Button>
        </CardContent>
      </Card>

      <NutritionSummary
        calculation={displayedNutrition}
        title="Nutrition preview per serving"
        pending={
          nutritionCalculation.unresolvedIngredients.length > 0 &&
          aiEstimate?.key !== nutritionInputKey
        }
      />
      {nutritionCalculation.unresolvedIngredients.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={isEstimating}
            onClick={() => void calculateAiEstimate()}
          >
            {isEstimating ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : null}
            {isEstimating ? 'Calculating macros…' : 'Calculate macros with AI'}
          </Button>
          {estimateError ? (
            <p className="text-sm text-destructive" role="alert">
              {estimateError}
            </p>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {stepsArray.fields.map((field, index) => (
            <div
              key={field.id}
              className="flex items-start gap-2 rounded-lg border p-3"
            >
              <span
                className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
                aria-hidden
              >
                {index + 1}
              </span>
              <Textarea
                placeholder={`Step ${index + 1}`}
                aria-label={`Step ${index + 1}`}
                aria-invalid={!!errors.steps?.[index]?.text}
                className="min-h-0 flex-1"
                {...register(`steps.${index}.text`)}
              />
              <div className="w-28 shrink-0">
                <Label htmlFor={`step-${index}-duration`} className="sr-only">
                  Timer seconds
                </Label>
                <Input
                  id={`step-${index}-duration`}
                  type="number"
                  min={1}
                  placeholder="Seconds"
                  aria-label="Timer seconds (optional)"
                  {...register(`steps.${index}.durationSeconds`, {
                    setValueAs: (value) =>
                      value === '' || value === null || value === undefined
                        ? null
                        : Number(value),
                  })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Move step ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => stepsArray.swap(index, index - 1)}
                >
                  <GripVerticalIcon className="size-4 rotate-180" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Move step ${index + 1} down`}
                  disabled={index === stepsArray.fields.length - 1}
                  onClick={() => stepsArray.swap(index, index + 1)}
                >
                  <GripVerticalIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Remove step ${index + 1}`}
                  onClick={() => stepsArray.remove(index)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          {errors.steps?.root ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.steps.root.message}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() =>
              stepsArray.append({ text: '', durationSeconds: null })
            }
          >
            <PlusIcon className="size-4" />
            Add step
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tags & Source</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Controller
            control={control}
            name="tags"
            render={({ field }) => (
              <TagsInput value={field.value} onChange={field.onChange} />
            )}
          />
          <div className="grid gap-2">
            <Label htmlFor="sourceName">Source name</Label>
            <Input
              id="sourceName"
              placeholder="e.g. Example Kitchen"
              {...register('sourceName')}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sourceUrl">Source URL</Label>
            <Input
              id="sourceUrl"
              type="url"
              placeholder="https://example.com/recipe"
              aria-invalid={!!errors.sourceUrl}
              {...register('sourceUrl')}
            />
            {errors.sourceUrl ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.sourceUrl.message}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Image</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {displayedImageUrl ? (
            <div className="relative w-fit">
              <img
                src={displayedImageUrl}
                alt="Recipe preview"
                className="h-40 rounded-lg object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2"
                aria-label="Remove image"
                onClick={clearImageSelection}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              id="recipe-image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleImageChange}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="mr-2 size-4" />
              {displayedImageUrl ? 'Change image' : 'Upload image'}
            </Button>
            <span className="text-xs text-muted-foreground">
              JPEG, PNG, or WebP, up to 5 MB.
            </span>
          </div>
          {imageError ? (
            <p className="text-sm text-destructive" role="alert">
              {imageError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {errors.root ? (
        <p className="text-sm text-destructive" role="alert">
          {errors.root.message}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => {
            if (onCancel) {
              onCancel();
            } else {
              navigate(cancelTo ?? (recipeId ? `/recipes/${recipeId}` : '/'));
            }
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          ) : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

interface TagsInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
}

function TagsInput({ value, onChange }: TagsInputProps) {
  const [inputValue, setInputValue] = useState('');

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (tag === '' || value.includes(tag)) return;
    onChange([...value, tag]);
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor="tags">Tags</Label>
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-2',
          'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        )}
      >
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => removeTag(tag)}
              className="rounded-full p-0.5 hover:bg-muted"
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id="tags"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(inputValue);
              setInputValue('');
            }
          }}
          placeholder="Add a tag and press Enter"
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
