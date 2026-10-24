'use client';

import { useActionState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { FormMessage } from '@/src/components/app/FormMessage';
import { confirmSignInAction } from '../actions';

/**
 * Signing in takes a click: email security scanners open links before people do, and a GET
 * must not use up the single-use link.
 */
export function ConfirmSignInForm({ token }: { token: string }) {
    const [state, formAction, pending] = useActionState(confirmSignInAction, null);
    return (
        <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            <FormMessage state={state} />
            <Button type="submit" variant="solid" size="lg" fullWidth loading={pending}>
                Continue
            </Button>
        </form>
    );
}
