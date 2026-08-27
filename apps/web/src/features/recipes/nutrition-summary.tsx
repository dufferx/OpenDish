import type { NutritionCalculation } from '@opendish/contracts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function NutritionSummary({
  calculation,
  title = 'Nutrition per serving',
  pending = false,
}: {
  calculation: NutritionCalculation;
  title?: string;
  pending?: boolean;
}) {
  const statusLabel = pending
    ? 'AI estimate pending'
    : calculation.status === 'confirmed'
      ? 'Confirmed sources'
      : calculation.status === 'estimated'
        ? 'Estimated'
        : 'Incomplete';
  return (
    <Card aria-label={title}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        <Badge
          variant={
            !pending && calculation.status === 'missing'
              ? 'destructive'
              : 'secondary'
          }
        >
          {statusLabel}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric
            label="Calories"
            value={`${Math.round(calculation.values.calories)} kcal`}
          />
          <Metric
            label="Protein"
            value={`${calculation.values.proteinGrams.toFixed(1)} g`}
          />
          <Metric
            label="Carbs"
            value={`${calculation.values.carbohydratesGrams.toFixed(1)} g`}
          />
        </div>
        {pending ? (
          <p className="text-sm text-muted-foreground">
            Ingredients without a saved source will be estimated by AI when you
            save this recipe.
          </p>
        ) : calculation.unresolvedIngredients.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Assign a source and compatible unit for:{' '}
            {calculation.unresolvedIngredients.join(', ')}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
