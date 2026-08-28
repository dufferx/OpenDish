import {
  BookOpenIcon,
  ImportIcon,
  ShoppingCartIcon,
  PackageIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Exact-match only (for the index route). */
  end?: boolean;
}

/** Primary destinations for recipes, nutrition products, and app settings. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Recipes', icon: BookOpenIcon, end: true },
  { to: '/import', label: 'Import', icon: ImportIcon },
  { to: '/generate', label: 'AI Create', icon: SparklesIcon },
  { to: '/shopping-list', label: 'Shopping', icon: ShoppingCartIcon },
  { to: '/products', label: 'Products', icon: PackageIcon },
];
