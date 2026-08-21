import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_SERVINGS } from '@/domain/scaling.ts';
import type { RecipeDetail } from '@/features/recipes/recipe-queries.ts';

import { useShoppingListActions } from './shopping-list-queries.ts';

interface AddToShoppingListDialogProps {
  recipe: RecipeDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddToShoppingListDialog({
  recipe,
  open,
  onOpenChange,
}: AddToShoppingListDialogProps) {
  const [servingsInput, setServingsInput] = useState(String(recipe.servings));
  const { addRecipe, isAddingRecipe } = useShoppingListActions();

  useEffect(() => {
    if (open) setServingsInput(String(recipe.servings));
  }, [open, recipe.servings]);

  const targetServings = Number(servingsInput);
  const isValid =
    servingsInput.trim() !== '' &&
    Number.isInteger(targetServings) &&
    targetServings >= 1 &&
    targetServings <= MAX_SERVINGS;

  async function handleAdd() {
    if (!isValid) return;
    await addRecipe({ recipe, servings: targetServings });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to shopping list</DialogTitle>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="add-servings">Servings</Label>
          <Input
            id="add-servings"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SERVINGS}
            step={1}
            value={servingsInput}
            aria-invalid={!isValid}
            aria-describedby={!isValid ? 'add-servings-error' : undefined}
            onChange={(event) => setServingsInput(event.target.value)}
          />
          {!isValid ? (
            <p
              id="add-servings-error"
              className="text-sm text-destructive"
              role="alert"
            >
              Servings must be an integer between 1 and {MAX_SERVINGS}.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={isAddingRecipe}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={!isValid || isAddingRecipe}
            onClick={() => void handleAdd()}
          >
            {isAddingRecipe ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
