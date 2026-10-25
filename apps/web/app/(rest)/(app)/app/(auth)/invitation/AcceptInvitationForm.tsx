'use client';

import { useActionState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { acceptInvitationAction } from './actions';

/** Accepting takes a click, like signing in: email scanners open links before people do */
export function AcceptInvitationForm({ token }: { token: string }) {
    const [state, formAction, pending] = useActionState(acceptInvitationAction, null);
    return (
        <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            <FormMessage state={state} />
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                Accept invitation
            </Button>
        </form>
    );
}
