import {
  ClockIcon,
  HeartIcon,
  MoreVerticalIcon,
  PencilIcon,
  CopyIcon,
  Trash2Icon,
  ImageIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getRecipeImageUrl } from '@/lib/recipe-images.ts';
import { cn } from '@/lib/utils';

import type { RecipeListItem } from './recipe-queries.ts';

export interface RecipeCardProps {
  recipe: RecipeListItem;
  onToggleFavorite: (recipeId: string, isFavorite: boolean) => void;
  onDuplicate: (recipeId: string) => void;
  onDelete: (recipe: RecipeListItem) => void;
}

export function RecipeCard({
  recipe,
  onToggleFavorite,
  onDuplicate,
  onDelete,
}: RecipeCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  if (recipe.imagePath && imageUrl === null) {
    void getRecipeImageUrl(recipe.imagePath).then((url) => {
      if (url) setImageUrl(url);
    });
  }

  const description = recipe.description ?? '';
  const snippet =
    description.length > 120 ? `${description.slice(0, 120)}…` : description;

  return (
    <Card className="overflow-hidden">
      <Link to={`/recipes/${recipe.id}`} className="block">
        <div className="relative aspect-video bg-muted">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="size-8" />
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={
              recipe.isFavorite ? 'Unfavorite recipe' : 'Favorite recipe'
            }
            className={cn(
              'absolute top-2 right-2 rounded-full bg-background/80 backdrop-blur hover:bg-background',
              recipe.isFavorite && 'text-red-500',
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFavorite(recipe.id, !recipe.isFavorite);
            }}
          >
            <HeartIcon
              className={cn('size-4', recipe.isFavorite && 'fill-current')}
            />
          </Button>
        </div>
      </Link>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/recipes/${recipe.id}`} className="block flex-1">
            <CardTitle className="line-clamp-1 text-base">
              {recipe.title}
            </CardTitle>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Recipe actions">
                <MoreVerticalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link
                  to={`/recipes/${recipe.id}/edit`}
                  className="flex items-center gap-2"
                >
                  <PencilIcon className="size-4" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDuplicate(recipe.id)}
                className="flex items-center gap-2"
              >
                <CopyIcon className="size-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(recipe)}
                className="flex items-center gap-2 text-destructive focus:text-destructive"
              >
                <Trash2Icon className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="pb-2">
        {recipe.nutrition ? (
          <p className="mb-2 text-sm font-medium" aria-label="Recipe macros">
            {Math.round(recipe.nutrition.calories)} kcal ·{' '}
            {recipe.nutrition.proteinGrams.toFixed(1)}g protein ·{' '}
            {recipe.nutrition.carbohydratesGrams.toFixed(1)}g carbs
          </p>
        ) : (
          <p
            className="mb-2 text-sm text-muted-foreground"
            aria-label="Recipe macros"
          >
            Macros not calculated yet
          </p>
        )}
        {snippet ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {snippet}
          </p>
        ) : null}
        {recipe.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {recipe.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="border-t bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <ClockIcon className="size-3.5" />
          <span>
            {recipe.tags.length > 0
              ? `${recipe.tags.length} tag${recipe.tags.length === 1 ? '' : 's'}`
              : 'No tags'}
          </span>
        </div>
      </CardFooter>
    </Card>
  );
}
