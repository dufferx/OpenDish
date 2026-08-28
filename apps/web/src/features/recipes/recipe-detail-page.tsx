import { useEffect, useState } from 'react';
import {
  ClockIcon,
  CopyIcon,
  EditIcon,
  ExternalLinkIcon,
  HeartIcon,
  ImageIcon,
  ShoppingCartIcon,
  Trash2Icon,
  UsersIcon,
  ChefHatIcon,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loading, ErrorState, EmptyState } from '@/app/states';
import { ConfirmDialog } from '@/app/confirm-dialog.tsx';
import { formatQuantity } from '@/domain/rational.ts';
import { MAX_SERVINGS, scaleIngredients } from '@/domain/scaling.ts';
import { getRecipeImageUrl } from '@/lib/recipe-images.ts';
import { cn } from '@/lib/utils';
import { RecipeConversation } from '@/features/recipe-conversation';
import { RecipeHistoryPanel } from '@/features/recipe-history';
import { AddToShoppingListDialog } from '@/features/shopping-list';
import { NutritionSummary } from './nutrition-summary.tsx';

import { useRecipeDetail, type RecipeDetail } from './recipe-queries.ts';
import { useRecipeActions } from './use-recipe-actions.ts';

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

function ServingsScaler({
  recipe,
  onSave,
  isSaving,
}: {
  recipe: RecipeDetail;
  onSave: (input: {
    recipe: RecipeDetail;
    targetServings: number;
  }) => Promise<unknown>;
  isSaving: boolean;
}) {
  const [servingsInput, setServingsInput] = useState(String(recipe.servings));
  const targetServings = Number(servingsInput);
  const isValid =
    servingsInput.trim() !== '' &&
    Number.isInteger(targetServings) &&
    targetServings >= 1 &&
    targetServings <= MAX_SERVINGS;
  const ingredients = isValid
    ? scaleIngredients(recipe.ingredients, recipe.servings, targetServings)
    : recipe.ingredients;

  return (
    <>
      <div className="rounded-xl border bg-card p-4 text-card-foreground">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid max-w-40 gap-2">
            <Label htmlFor="displayed-servings">Servings</Label>
            <Input
              id="displayed-servings"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_SERVINGS}
              step={1}
              value={servingsInput}
              aria-describedby={!isValid ? 'servings-error' : undefined}
              aria-invalid={!isValid}
              onChange={(event) => setServingsInput(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!isValid || isSaving}
            onClick={() => void onSave({ recipe, targetServings })}
          >
            {isSaving ? 'Saving…' : 'Save adjustment'}
          </Button>
          {isValid ? (
            <p
              className="flex flex-wrap gap-x-1 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <span className="font-medium text-foreground">
                {targetServings} serving{targetServings === 1 ? '' : 's'}
              </span>
              <span>in this view — changes stay temporary until saved.</span>
            </p>
          ) : null}
        </div>
        {!isValid ? (
          <p
            id="servings-error"
            className="mt-2 text-sm text-destructive"
            role="alert"
          >
            Servings must be an integer between 1 and {MAX_SERVINGS}.
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ingredients</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2">
            {ingredients.map((ingredient, index) => {
              const unit = displayUnit(ingredient.unit, ingredient.quantity);
              return (
                <li
                  key={index}
                  className="flex items-baseline gap-2 border-b py-2 last:border-b-0"
                >
                  {ingredient.quantity !== null ? (
                    <span className="font-medium text-foreground">
                      {formatQuantity(ingredient.quantity)}
                    </span>
                  ) : null}
                  {unit ? (
                    <span className="text-muted-foreground"> {unit}</span>
                  ) : null}
                  <span className="flex-1">
                    {ingredient.quantity !== null || unit ? ' ' : ''}
                    {ingredient.name}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function getDeleteDescription(recipe: RecipeDetail): string {
  if (recipe.variantRecipes.length === 0) {
    return `"${recipe.title}" will be permanently deleted.`;
  }

  const variantCount = recipe.variantRecipes.length;
  const variantLabel = variantCount === 1 ? 'variant' : 'variants';
  return `"${recipe.title}" will be permanently deleted. ${variantCount} ${variantLabel} currently linked to this recipe will become standalone recipes.`;
}

export function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    data: recipe,
    isLoading,
    error,
    refetch,
  } = useRecipeDetail(id ?? undefined);
  const {
    deleteRecipe,
    duplicateRecipe,
    toggleFavorite,
    saveServingAdjustment,
    isSavingServingAdjustment,
  } = useRecipeActions();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddToList, setShowAddToList] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setImageUrl(null);
    if (recipe?.imagePath) {
      void getRecipeImageUrl(recipe.imagePath).then((url) => {
        if (active) setImageUrl(url);
      });
    }
    return () => {
      active = false;
    };
  }, [recipe?.imagePath]);

  if (isLoading) return <Loading label="Loading recipe…" />;
  if (error)
    return (
      <ErrorState
        title="Could not load recipe"
        description={error.message}
        onRetry={() => void refetch()}
      />
    );
  if (!recipe)
    return (
      <EmptyState
        title="Recipe not found"
        description="This recipe may have been deleted."
        action={
          <Button asChild>
            <Link to="/">Back to recipes</Link>
          </Button>
        }
      />
    );

  const totalTime =
    (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
  const hasRelationships =
    recipe.sourceRecipe !== null || recipe.variantRecipes.length > 0;
  const nutritionCalculation = recipe.nutrition
    ? {
        values: {
          calories: recipe.nutrition.calories,
          proteinGrams: recipe.nutrition.proteinGrams,
          carbohydratesGrams: recipe.nutrition.carbohydratesGrams,
        },
        status: recipe.nutrition.status,
        unresolvedIngredients: [],
        ingredientValues: {},
      }
    : {
        values: { calories: 0, proteinGrams: 0, carbohydratesGrams: 0 },
        status: 'missing' as const,
        unresolvedIngredients: recipe.ingredients.map(
          (ingredient) => ingredient.name,
        ),
        ingredientValues: {},
      };

  async function handleDelete() {
    if (!recipe) return;
    setIsDeleting(true);
    try {
      await deleteRecipe(recipe.id);
      navigate('/');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleDuplicate() {
    if (!recipe) return;
    const result = await duplicateRecipe(recipe.id);
    navigate(`/recipes/${result.recipeId}`);
  }

  return (
    <section
      className="flex flex-col gap-6 pb-20"
      aria-labelledby="recipe-title"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="recipe-title"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            {recipe.title}
          </h1>
          {recipe.description ? (
            <p className="mt-1 text-muted-foreground">{recipe.description}</p>
          ) : null}
          {hasRelationships ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {recipe.sourceRecipe ? (
                <Badge asChild variant="outline">
                  <Link to={`/recipes/${recipe.sourceRecipe.id}`}>
                    Variant of {recipe.sourceRecipe.title}
                  </Link>
                </Badge>
              ) : null}
              {recipe.variantRecipes.length > 0 ? (
                <Badge variant="secondary">
                  {recipe.variantRecipes.length} variant
                  {recipe.variantRecipes.length === 1 ? '' : 's'}
                </Badge>
              ) : null}
            </div>
          ) : null}
          {recipe.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {recipe.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={recipe.isFavorite ? 'default' : 'outline'}
            size="sm"
            onClick={() =>
              void toggleFavorite({
                recipeId: recipe.id,
                isFavorite: !recipe.isFavorite,
              })
            }
          >
            <HeartIcon
              className={cn(
                'mr-1.5 size-4',
                recipe.isFavorite && 'fill-current',
              )}
            />
            {recipe.isFavorite ? 'Favorited' : 'Favorite'}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/recipes/${recipe.id}/cook`}>
              <ChefHatIcon className="mr-1.5 size-4" />
              Cook
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/recipes/${recipe.id}/edit`}>
              <EditIcon className="mr-1.5 size-4" />
              Edit
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddToList(true)}
          >
            <ShoppingCartIcon className="mr-1.5 size-4" />
            Add to list
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleDuplicate()}
          >
            <CopyIcon className="mr-1.5 size-4" />
            Duplicate
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2Icon className="mr-1.5 size-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {(recipe.prepTimeMinutes !== null ||
              recipe.cookTimeMinutes !== null) &&
            totalTime > 0 ? (
              <div className="flex items-center gap-1.5">
                <ClockIcon className="size-4" />
                <span>
                  {totalTime} min
                  {recipe.prepTimeMinutes !== null &&
                  recipe.cookTimeMinutes !== null
                    ? ` (${recipe.prepTimeMinutes} prep + ${recipe.cookTimeMinutes} cook)`
                    : ''}
                </span>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <UsersIcon className="size-4" />
              <span>
                {recipe.servings} saved serving
                {recipe.servings === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <NutritionSummary calculation={nutritionCalculation} />

          <ServingsScaler
            key={`${recipe.id}:${recipe.headVersion}`}
            recipe={recipe}
            onSave={saveServingAdjustment}
            isSaving={isSavingServingAdjustment}
          />

          {recipe.imagePath ? (
            <div className="overflow-hidden rounded-xl bg-muted">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={recipe.title}
                  className="w-full max-h-96 object-cover"
                />
              ) : (
                <div className="flex h-48 items-center justify-center text-muted-foreground">
                  <ImageIcon className="size-8" />
                </div>
              )}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-4">
                {recipe.steps.map((step, index) => (
                  <li key={index} className="flex gap-3">
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium"
                      aria-hidden
                    >
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-foreground">{step.text}</p>
                      {step.durationSeconds ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Timer: {Math.floor(step.durationSeconds / 60)}:
                          {String(step.durationSeconds % 60).padStart(2, '0')}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {recipe.sourceUrl || recipe.sourceName ? (
            <Card>
              <CardHeader>
                <CardTitle>Source</CardTitle>
              </CardHeader>
              <CardContent>
                {recipe.sourceUrl ? (
                  <a
                    href={recipe.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-primary hover:underline"
                  >
                    {recipe.sourceName || recipe.sourceUrl}
                    <ExternalLinkIcon className="size-4" />
                  </a>
                ) : (
                  <p className="text-muted-foreground">{recipe.sourceName}</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {hasRelationships ? (
            <Card>
              <CardHeader>
                <CardTitle>Recipe family</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                {recipe.sourceRecipe ? (
                  <div className="grid gap-1">
                    <p className="text-sm font-medium text-foreground">
                      Based on
                    </p>
                    <Link
                      to={`/recipes/${recipe.sourceRecipe.id}`}
                      className="inline-flex w-fit items-center gap-1.5 text-primary hover:underline"
                    >
                      {recipe.sourceRecipe.title}
                    </Link>
                  </div>
                ) : null}
                {recipe.variantRecipes.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium text-foreground">
                      Variants
                    </p>
                    <ul className="grid gap-2">
                      {recipe.variantRecipes.map((variant) => (
                        <li key={variant.id}>
                          <Link
                            to={`/recipes/${variant.id}`}
                            className="inline-flex w-fit items-center gap-1.5 text-primary hover:underline"
                          >
                            {variant.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <RecipeHistoryPanel
            recipeId={recipe.id}
            onRestored={() => void refetch()}
          />
        </div>
      </div>

      <RecipeConversation
        recipe={recipe}
        onRecipeChanged={() => void refetch()}
      />

      <AddToShoppingListDialog
        recipe={recipe}
        open={showAddToList}
        onOpenChange={setShowAddToList}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete recipe?"
        description={getDeleteDescription(recipe)}
        confirmLabel="Delete"
        pending={isDeleting}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
}
