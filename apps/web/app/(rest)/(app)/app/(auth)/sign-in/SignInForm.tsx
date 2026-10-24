'use client';

import { useActionState, useState } from 'react';
import { Input } from '@signalco/ui-primitives/Input';
import { Button } from '@signalco/ui-primitives/Button';
import { Link } from '@signalco/ui-primitives/Link';
import { FormMessage } from '@/src/components/app/FormMessage';
import { requestSignInAction } from './actions';

export function SignInForm({ next }: { next?: string }) {
    const [state, formAction, pending] = useActionState(requestSignInAction, null);
    // Controlled, so a failed attempt keeps what was typed (React resets forms after an action)
    const [email, setEmail] = useState('');

    if (state?.ok) {
        return (
            <div role="status" className="flex flex-col gap-3">
                <h2 className="m-0 text-xl font-semibold tracking-[-0.015em]">Check your email</h2>
                <p className="m-0 text-sm text-muted-foreground">
                    We sent a sign-in link to <span className="font-medium text-foreground">{state.data.email}</span>.
                    It works once and expires in 15 minutes.
                </p>
                {state.data.devLink && (
                    // Local development, tests and previews only: no email is sent there
                    <p className="m-0 text-sm">
                        <Link href={state.data.devLink}>Open the sign-in link</Link>
                        <span className="text-muted-foreground"> (no email is sent on this deployment)</span>
                    </p>
                )}
            </div>
        );
    }

    return (
        <form action={formAction} className="flex flex-col gap-4">
            {next && <input type="hidden" name="next" value={next} />}
            <Input
                label="Email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                placeholder="you@example.com"
                fullWidth />
            <FormMessage state={state} />
            <Button type="submit" variant="solid" size="lg" fullWidth loading={pending}>
                Email me a sign-in link
            </Button>
        </form>
    );
}
