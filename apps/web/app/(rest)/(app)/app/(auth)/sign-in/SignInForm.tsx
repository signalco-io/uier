'use client';

import { useActionState, useId, useState } from 'react';
import Link from 'next/link';
import { MailCheckIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Button } from '@/src/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { requestSignInAction } from './actions';

export function SignInForm({ next }: { next?: string }) {
    const id = useId();
    const [state, formAction, pending] = useActionState(requestSignInAction, null);
    // Controlled, so a failed attempt keeps what was typed (React resets forms after an action)
    const [email, setEmail] = useState('');

    if (state?.ok) {
        return (
            <Alert role="status">
                <MailCheckIcon />
                <AlertTitle>
                    <h2 className="m-0 text-sm font-medium">Check your email</h2>
                </AlertTitle>
                <AlertDescription>
                    <p className="m-0">
                        We sent a sign-in link to <span className="font-medium text-foreground">{state.data.email}</span>.
                        It works once and expires in 15 minutes.
                    </p>
                    {state.data.devLink && (
                        // Local development, tests and previews only: no email is sent there
                        <p className="m-0">
                            <Link href={state.data.devLink} className="font-medium text-foreground underline underline-offset-4">Open the sign-in link</Link>
                            {' '}(no email is sent on this deployment)
                        </p>
                    )}
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <form action={formAction}>
            {next && <input type="hidden" name="next" value={next} />}
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
                    <Input
                        id={`${id}-email`}
                        name="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        required
                        placeholder="you@example.com" />
                </Field>
                <FormMessage state={state} />
                <Button type="submit" size="lg" className="w-full" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    Email me a sign-in link
                </Button>
            </FieldGroup>
        </form>
    );
}
