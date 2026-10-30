'use client';

import { useActionState, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MailCheckIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { confirmSignInCodeAction, requestSignInAction, type SignInLinkSent } from './actions';
import { PasskeySignIn } from './PasskeySignIn';

export function SignInCodeForm({ sent, next }: { sent: SignInLinkSent; next?: string }) {
    const id = useId();
    const [state, formAction, pending] = useActionState(confirmSignInCodeAction, null);
    const [code, setCode] = useState('');
    const invalid = state?.ok === false;
    const signInPath = `/app/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`;

    return (
        <div className="flex flex-col gap-6">
            <Alert role="status">
                <MailCheckIcon />
                <AlertTitle><h2 className="m-0 text-sm font-medium">Check your email</h2></AlertTitle>
                <AlertDescription>
                    <p className="m-0">
                        We sent a code and a sign-in link to <span className="font-medium text-foreground">{sent.email}</span>.
                        They work once and expire in 15 minutes.
                    </p>
                    {sent.devLink && (
                        <p className="m-0">
                            <Link href={sent.devLink} className="font-medium text-foreground underline underline-offset-4">Open the sign-in link</Link>
                            {' '}or type this code: <code data-sign-in-code>{sent.devCode}</code>
                            {' '}(no email is sent on this deployment)
                        </p>
                    )}
                </AlertDescription>
            </Alert>
            <form action={formAction}>
                <input type="hidden" name="requestId" value={sent.requestId} />
                <FieldGroup>
                    <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor={`${id}-code`}>Sign-in code</FieldLabel>
                        <Input id={`${id}-code`} name="code" type="text" inputMode="numeric"
                            autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required
                            value={code} onChange={event => setCode(event.target.value.replace(/\s/g, ''))}
                            aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`} />
                        <FieldDescription id={`${id}-hint`}>Enter the 8-digit code. It works only in this browser.</FieldDescription>
                    </Field>
                    <FormMessage state={state} />
                    <Button type="submit" size="lg" className="w-full" disabled={pending}>
                        {pending && <Spinner data-icon="inline-start" />}
                        Sign in
                    </Button>
                    <Button variant="outline" size="lg" className="w-full" asChild>
                        {/* A fresh navigation resets the email form, even on the same route. */}
                        <a href={signInPath}>Ask for a new email</a>
                    </Button>
                </FieldGroup>
            </form>
        </div>
    );
}

/** `alternatives`: other sign-in buttons (Google), after the passkey button under the same "or" */
export function SignInForm({ next, alternatives }: { next?: string; alternatives?: ReactNode }) {
    const id = useId();
    const [state, formAction, pending] = useActionState(requestSignInAction, null);
    // Controlled, so a failed attempt keeps what was typed (React resets forms after an action)
    const [email, setEmail] = useState('');

    if (state?.ok) {
        return <SignInCodeForm key={state.data.requestId} sent={state.data} next={next} />;
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
                        autoComplete="email webauthn"
                        required
                        placeholder="you@example.com" />
                </Field>
                <FormMessage state={state} />
                <Button type="submit" size="lg" className="w-full" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    Email me a sign-in code
                </Button>
                <PasskeySignIn next={next} />
                {alternatives}
            </FieldGroup>
        </form>
    );
}
