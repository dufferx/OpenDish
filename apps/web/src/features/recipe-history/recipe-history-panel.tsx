import { useMemo, useState } from 'react';
import {
  EyeIcon,
  HistoryIcon,
  RotateCcwIcon,
  TagsIcon,
  UtensilsCrossedIcon,
} from 'lucide-react';

import { EmptyState, ErrorState, Loading } from '@/app/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatQuantity } from '@/domain/rational.ts';

import {
  useRecipeHistory,
  useRestoreRecipeHistoryVersion,
  type RecipeHistoryEntry,
} from './recipe-history-queries.ts';

export interface RecipeHistoryPanelProps {
  recipeId: string;
  onRestored: () => void;
}

function formatChangeKind(changeKind: string): string {
  return changeKind
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatTimes(
  prepTimeMinutes: number | null,
  cookTimeMinutes: number | null,
): string | null {
  const parts = [
    prepTimeMinutes === null ? null : `Prep ${prepTimeMinutes} min`,
    cookTimeMinutes === null ? null : `Cook ${cookTimeMinutes} min`,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' · ') : null;
}

function SnapshotPreview({ entry }: { entry: RecipeHistoryEntry }) {
  const { snapshot } = entry;
  const times = formatTimes(
    snapshot.prepTimeMinutes ?? null,
    snapshot.cookTimeMinutes ?? null,
  );

  return (
    <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1">
      <section className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Version {entry.version}</Badge>
          <Badge>{formatChangeKind(entry.changeKind)}</Badge>
        </div>
        {snapshot.description ? (
          <p className="text-sm text-muted-foreground">
            {snapshot.description}
          </p>
        ) : null}
        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <p>
            {snapshot.servings} serving{snapshot.servings === 1 ? '' : 's'}
          </p>
          {times ? <p>{times}</p> : null}
          {snapshot.sourceName ? <p>Source: {snapshot.sourceName}</p> : null}
          {snapshot.sourceUrl ? (
            <a
              href={snapshot.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-4"
            >
              View original source
            </a>
          ) : null}
        </div>
        {snapshot.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {snapshot.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid gap-2">
        <div className="flex items-center gap-2">
          <UtensilsCrossedIcon className="size-4 text-muted-foreground" />
          <h3 className="font-medium">Ingredients</h3>
        </div>
        <ul className="grid gap-2 text-sm">
          {snapshot.ingredients.map((ingredient, index) => (
            <li
              key={`${ingredient.name}-${index}`}
              className="rounded-lg border p-3"
            >
              {ingredient.quantity
                ? `${formatQuantity(ingredient.quantity)} `
                : ''}
              {ingredient.unit ? `${ingredient.unit} ` : ''}
              {ingredient.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center gap-2">
          <TagsIcon className="size-4 text-muted-foreground" />
          <h3 className="font-medium">Steps</h3>
        </div>
        <ol className="grid list-decimal gap-2 pl-5 text-sm">
          {snapshot.steps.map((step, index) => (
            <li key={index}>{step.text}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function RecipeHistoryPanel({
  recipeId,
  onRestored,
}: RecipeHistoryPanelProps) {
  const { data, isLoading, error, refetch } = useRecipeHistory(recipeId);
  const restoreMutation = useRestoreRecipeHistoryVersion();
  const [previewEntryId, setPreviewEntryId] = useState<string | null>(null);

  const previewEntry = useMemo(
    () => data?.find((entry) => entry.id === previewEntryId) ?? null,
    [data, previewEntryId],
  );

  const pendingHistoryId = restoreMutation.isPending
    ? restoreMutation.variables?.historyId
    : null;
  const activeHistoryId = restoreMutation.variables?.historyId ?? null;
  const activeVersion =
    data?.find((entry) => entry.id === activeHistoryId)?.version ?? null;

  if (isLoading) return <Loading label="Loading history…" />;

  if (error) {
    return (
      <ErrorState
        title="Could not load recipe history"
        description={error.message}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <HistoryIcon className="size-4" aria-hidden />
            <span className="text-sm">Recipe history</span>
          </div>
          <CardTitle>Previous saved versions</CardTitle>
          <p className="text-sm text-muted-foreground">
            Review earlier snapshots and restore one when you need to roll back
            a change.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {restoreMutation.isSuccess && activeVersion !== null ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
            >
              Version {activeVersion} restored. The latest recipe data has been
              refreshed.
            </div>
          ) : null}

          {restoreMutation.isError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {restoreMutation.error.message ??
                'Could not restore that version.'}
            </div>
          ) : null}

          {data && data.length > 0 ? (
            <ul className="grid gap-3" aria-label="Recipe history entries">
              {data.map((entry) => {
                const isRestoring = pendingHistoryId === entry.id;

                return (
                  <li key={entry.id} className="rounded-xl border bg-card p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="grid gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">
                            Version {entry.version}
                          </h3>
                          <Badge variant="secondary">
                            {formatChangeKind(entry.changeKind)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Saved {formatTimestamp(entry.createdAt)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {entry.snapshot.title}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setPreviewEntryId(entry.id)}
                          aria-label={`View version ${entry.version} snapshot`}
                          disabled={restoreMutation.isPending}
                        >
                          <EyeIcon className="size-4" aria-hidden />
                          View snapshot
                        </Button>
                        <Button
                          type="button"
                          onClick={() =>
                            restoreMutation.mutate({
                              recipeId,
                              historyId: entry.id,
                              onRestored,
                            })
                          }
                          aria-label={`Restore version ${entry.version}`}
                          disabled={restoreMutation.isPending}
                        >
                          <RotateCcwIcon className="size-4" aria-hidden />
                          {isRestoring ? 'Restoring…' : 'Restore version'}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={HistoryIcon}
              title="No saved history yet"
              description="Once this recipe is updated, previous versions will appear here."
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={previewEntry !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewEntryId(null);
        }}
      >
        {previewEntry ? (
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{previewEntry.snapshot.title}</DialogTitle>
              <DialogDescription>
                Snapshot from version {previewEntry.version} saved{' '}
                {formatTimestamp(previewEntry.createdAt)}.
              </DialogDescription>
            </DialogHeader>
            <SnapshotPreview entry={previewEntry} />
            <DialogFooter showCloseButton />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
