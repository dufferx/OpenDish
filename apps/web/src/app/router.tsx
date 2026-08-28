import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from '@/app/app-layout';
import { AiSettingsPage } from '@/features/ai-config';
import { ShoppingListPage } from '@/features/shopping-list';
import { GenerateRecipePage } from '@/features/recipe-generation';
import { ImportRecipePage } from '@/features/recipe-import';
import { AuthGuard } from '@/features/auth/auth-guard';
import { LoginPage } from '@/features/auth/login-page';
import { RecipeEditorPage } from '@/features/recipe-editor';
import { RecipeDetailPage, RecipeListPage } from '@/features/recipes';
import { ProductsPage } from '@/features/products';

/**
 * Route map. Placeholder pages are replaced by feature tasks
 * (see src/app/placeholders.tsx). The router itself is provided by
 * main.tsx (BrowserRouter) or by tests (MemoryRouter).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <AuthGuard>
            <AppLayout />
          </AuthGuard>
        }
      >
        <Route index element={<RecipeListPage />} />
        <Route
          path="recipes/new"
          element={<RecipeEditorPage mode="create" />}
        />
        <Route path="recipes/:id" element={<RecipeDetailPage />} />
        <Route
          path="recipes/:id/edit"
          element={<RecipeEditorPage mode="edit" />}
        />
        <Route path="import" element={<ImportRecipePage />} />
        <Route path="generate" element={<GenerateRecipePage />} />
        <Route path="shopping-list" element={<ShoppingListPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="settings" element={<AiSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
