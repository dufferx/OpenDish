import type {
  ModificationOp,
  ModificationProposal,
  RecipeDraft,
} from '@opendish/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatQuantity } from '@/domain/rational.ts';

export type ProposalAction = 'apply' | 'variant' | 'discard' | 'regenerate';

export interface ModificationReviewProps {
  currentRecipe: RecipeDraft;
  proposal: ModificationProposal;
  isStale: boolean;
  pendingAction: ProposalAction | null;
  onApply: () => void | Promise<void>;
  onSaveAsVariant: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
}

function operationLabel(operation: ModificationOp, current: RecipeDraft) {
  switch (operation.kind) {
    case 'updateIngredient':
      return `Ingredient ${operation.position + 1} · ${current.ingredients[operation.position]?.name ?? 'ingredient'} updated`;
    case 'addIngredient':
      return `Add ingredient · ${operation.ingredient.name}`;
    case 'removeIngredient':
      return `Remove ingredient ${operation.position + 1} · ${current.ingredients[operation.position]?.name ?? 'ingredient'}`;
    case 'updateStep':
      return `Step ${operation.position + 1} · updated`;
    case 'addStep':
      return 'Add preparation step';
    case 'removeStep':
      return `Remove step ${operation.position + 1}`;
    case 'reorderSteps':
      return 'Reorder preparation steps';
    case 'setServings':
      return `Servings · ${current.servings} → ${operation.servings}`;
    case 'setTitle':
      return `Title · ${current.title} → ${operation.title}`;
    case 'setDescription':
      return 'Update description';
    case 'setTimes':
      return 'Update preparation times';
  }
}

function RecipeComparison({
  recipe,
  label,
  suggested = false,
}: {
  recipe: RecipeDraft;
  label: string;
  suggested?: boolean;
}) {
  return (
    <section
      aria-label={label}
      className={
        suggested
          ? 'rounded-xl border border-foreground/25 bg-foreground/[0.03] p-3'
          : 'rounded-xl border bg-muted/25 p-3'
      }
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold">{suggested ? 'Suggested' : 'Current'}</h3>
        <Badge variant={suggested ? 'default' : 'secondary'}>
          {suggested ? 'AI suggestion' : 'Saved'}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {recipe.servings} serving{recipe.servings === 1 ? '' : 's'}
      </p>
      <h4 className="mt-4 text-sm font-semibold">Ingredients</h4>
      <ul className="mt-2 grid gap-1 text-sm">
        {recipe.ingredients.map((ingredient, index) => (
          <li key={`${ingredient.name}-${index}`}>
            {ingredient.quantity
              ? `${formatQuantity(ingredient.quantity)} `
              : ''}
            {ingredient.unit ? `${ingredient.unit} ` : ''}
            {ingredient.name}
          </li>
        ))}
      </ul>
      <h4 className="mt-4 text-sm font-semibold">Steps</h4>
      <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm">
        {recipe.steps.map((step, index) => (
          <li key={index}>{step.text}</li>
        ))}
      </ol>
    </section>
  );
}

export function ModificationReview({
  currentRecipe,
  proposal,
  isStale,
  pendingAction,
  onApply,
  onSaveAsVariant,
  onDiscard,
  onRegenerate,
}: ModificationReviewProps) {
  const actionPending = pendingAction !== null;

  return (
    <article className="overflow-hidden rounded-2xl rounded-tl-md border bg-background shadow-sm">
      <div className="grid gap-3 border-b bg-muted/20 p-4">
        <div
          role="status"
          className="w-fit rounded-full bg-foreground px-2.5 py-1 text-[0.68rem] font-medium tracking-wide text-background uppercase"
        >
          AI suggestion · not applied
        </div>
        <h3 className="text-base font-semibold">Review proposed changes</h3>
        <p className="text-sm text-muted-foreground">{proposal.summary}</p>
      </div>
      <div className="grid gap-4 p-4">
        <section aria-labelledby="changes-summary">
          <h4
            id="changes-summary"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Changes
          </h4>
          <ul className="mt-2 grid gap-1.5 text-sm">
            {proposal.operations.map((operation, index) => (
              <li
                key={index}
                className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2"
              >
                <span aria-hidden className="font-medium">
                  ±
                </span>
                <span>{operationLabel(operation, currentRecipe)}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          <RecipeComparison
            recipe={currentRecipe}
            label="Current saved recipe"
          />
          <RecipeComparison
            recipe={proposal.resultingRecipe}
            label="AI suggested recipe"
            suggested
          />
        </div>

        {isStale ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            This recipe has changed since the suggestion was created. Regenerate
            it from the current saved recipe before applying or creating a
            variant.
          </div>
        ) : null}

        <div
          role="group"
          aria-label="Proposal actions"
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        >
          <Button
            type="button"
            aria-label="Apply"
            disabled={actionPending || isStale}
            onClick={() => void onApply()}
          >
            {pendingAction === 'apply' ? 'Applying…' : 'Apply changes'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={actionPending || isStale}
            onClick={() => void onSaveAsVariant()}
          >
            {pendingAction === 'variant'
              ? 'Saving variant…'
              : 'Save as variant'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={actionPending}
            onClick={() => void onDiscard()}
          >
            {pendingAction === 'discard' ? 'Discarding…' : 'Discard'}
          </Button>
        </div>

        {isStale ? (
          <Button
            type="button"
            className="w-fit"
            variant="outline"
            disabled={actionPending}
            onClick={() => void onRegenerate()}
          >
            Regenerate suggestion
          </Button>
        ) : null}
      </div>
    </article>
  );
}
