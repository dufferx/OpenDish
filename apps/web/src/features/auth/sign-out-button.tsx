import { useState } from 'react';
import { LogOutIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const auth = useAuth();

  async function handleSignOut() {
    setPending(true);
    const { error } = await auth.signOut();
    if (error) {
      toast.error(error);
      setPending(false);
    }
    // On success AuthProvider flips to unauthenticated and AuthGuard
    // redirects to /login.
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleSignOut}
      disabled={pending}
    >
      <LogOutIcon aria-hidden />
      <span className="hidden sm:inline">
        {pending ? 'Signing out…' : 'Sign out'}
      </span>
      <span className="sr-only sm:hidden">Sign out</span>
    </Button>
  );
}
