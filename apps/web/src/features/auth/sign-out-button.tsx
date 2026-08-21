import { useState } from 'react';
import { LogOutIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error('Sign-out failed. Please try again.');
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
