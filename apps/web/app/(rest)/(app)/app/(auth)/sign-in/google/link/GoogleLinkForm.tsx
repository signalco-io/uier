'use client';

import { useActionState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { requestSignInAction } from '../../actions';
import { SignInCodeForm } from '../../SignInForm';

/** The usual sign-in email for the account's address; this browser's waiting Google account rides along. */
export function GoogleLinkForm({ email, next }: { email: string; next?: string }) {
    const [state, formAction, pending] = useActionState(requestSignInAction, null);

    if (state?.ok)
        return <SignInCodeForm key={state.data.requestId} sent={state.data} next={next} />;

    return (
        <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="email" value={email} />
            {next && <input type="hidden" name="next" value={next} />}
            <FormMessage state={state} />
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                Email me a sign-in code
            </Button>
        </form>
    );
}
