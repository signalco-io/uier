'use client';

import { LogOutIcon } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { changeAccount } from './accountSessions';

export function SignOutButton() {
    const [pending, startTransition] = useTransition();
    return (
        <Button variant="outline" disabled={pending} onClick={() => startTransition(async () => {
            try { await changeAccount({ action: 'sign-out' }); }
            catch (error) { toast.error(error instanceof Error ? error.message : 'Could not sign out.'); }
        })}>
            <LogOutIcon data-icon="inline-start" />
            Sign out
        </Button>
    );
}
