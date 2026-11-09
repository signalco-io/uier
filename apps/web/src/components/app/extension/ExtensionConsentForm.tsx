'use client';

import { useActionState } from 'react';
import type { Authorization } from '@/src/lib/extension/auth';
import { approveExtensionAction } from '@/src/lib/extension/actions';
import { Button } from '@/src/components/ui/button';
import { FormMessage } from '../FormMessage';

export function ExtensionConsentForm({ userId, authorization }: { userId: string; authorization: Authorization }) {
    const [state, approve, pending] = useActionState(async () => approveExtensionAction(userId, authorization), null);
    return (
        <form action={approve} className="flex flex-col gap-4">
            <FormMessage state={state} />
            <Button type="submit" size="lg" className="w-full" disabled={pending}>Sign in to uier</Button>
        </form>
    );
}
