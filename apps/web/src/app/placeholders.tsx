import { useParams } from 'react-router-dom';

import { EmptyState } from '@/app/states';

interface PagePlaceholderProps {
  title: string;
  /** Task ID of the task that will replace this placeholder. */
  taskRef: string;
  description: string;
}

/**
 * Stand-in page used until the owning feature task lands. Later agents
 * replace the default export for their route with the real feature page.
 */
export function PagePlaceholder({
  title,
  taskRef,
  description,
}: PagePlaceholderProps) {
  return (
    <section className="flex flex-col gap-6" aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      <EmptyState
        title="Coming soon"
        description={`${description} (lands in ${taskRef}.)`}
      />
    </section>
  );
}

export function RecipesPage() {
  return (
    <PagePlaceholder
      title="Recipes"
      taskRef="T034"
      description="Browse, search, and manage your recipe collection"
    />
  );
}

export function NewRecipePage() {
  return (
    <PagePlaceholder
      title="New recipe"
      taskRef="T035"
      description="Create a recipe manually with the editor form"
    />
  );
}

export function ImportRecipePage() {
  return (
    <PagePlaceholder
      title="Import a recipe"
      taskRef="T042"
      description="Import from a URL or pasted text, then review before saving"
    />
  );
}

export function GenerateRecipePage() {
  return (
    <PagePlaceholder
      title="Create with AI"
      taskRef="T061"
      description="Describe what you want to cook and review the generated draft"
    />
  );
}

export function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PagePlaceholder
      title="Recipe"
      taskRef="T038"
      description={`Cooking-focused view for recipe ${id ?? ''}`}
    />
  );
}

export function ShoppingListPage() {
  return (
    <PagePlaceholder
      title="Shopping list"
      taskRef="T065"
      description="One shared list, built from your recipes"
    />
  );
}
