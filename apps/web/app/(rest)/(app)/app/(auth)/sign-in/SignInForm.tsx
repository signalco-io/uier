'use client';

import { useActionState, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MailCheckIcon, MailIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { KnownPages } from '@/src/knownPages';
import { confirmSignInCodeAction, requestSignInAction, type SignInLinkSent } from './actions';
import type { SignInMethod } from '@/src/lib/app/session';
import { PasskeySignIn } from './PasskeySignIn';
import { LAST_USED_ID, LastUsedBadge } from './LastUsedBadge';

/** The sign-in page, keeping `next`; `email` opens the email form straight away (`?with=email`) */
function signInHref(next: string | undefined, email: boolean) {
    const params = new URLSearchParams();
    if (next) params.set('next', next);
    if (email) params.set('with', 'email');
    const query = params.toString();
    return `${KnownPages.AppSignIn}${query ? `?${query}` : ''}`;
}

export function SignInCodeForm({ sent, next }: { sent: SignInLinkSent; next?: string }) {
    const id = useId();
    const [state, formAction, pending] = useActionState(confirmSignInCodeAction, null);
    const [code, setCode] = useState('');
    const invalid = state?.ok === false;

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
                    {/* A fresh navigation resets the email form, even on the same route. */}
                    <a href={signInHref(next, true)} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}>Ask for a new email</a>
                </FieldGroup>
            </form>
        </div>
    );
}

/**
 * The sign-in options, all the same outline button with the method's name ("Sign in with ..." to
 * assistive technologies): a passkey, `alternatives` (Google and Microsoft), then email, the last
 * resort, whose form opens in place (`withEmail` opens it straight away). `lastUsed` marks the option
 * this browser signed in with last.
 */
export function SignInForm({ next, alternatives, withEmail = false, lastUsed }: {
    next?: string; alternatives?: ReactNode; withEmail?: boolean; lastUsed?: SignInMethod;
}) {
    const id = useId();
    const [state, formAction, pending] = useActionState(requestSignInAction, null);
    const [emailOpen, setEmailOpen] = useState(withEmail);
    // Controlled, so a failed attempt keeps what was typed (React resets forms after an action)
    const [email, setEmail] = useState('');

    if (state?.ok) {
        return <SignInCodeForm key={state.data.requestId} sent={state.data} next={next} />;
    }

    return (
        <div className="flex flex-col gap-3">
            <PasskeySignIn next={next} autofill={emailOpen} lastUsed={lastUsed === 'passkey'} />
            {alternatives}
            {emailOpen ? (
                <>
                    {/* first:hidden: no "or" when email is the only way this browser can sign in */}
                    <FieldSeparator className="my-2 first:hidden *:data-[slot=field-separator-content]:bg-card">or</FieldSeparator>
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
                                    autoFocus
                                    required
                                    placeholder="you@example.com"
                                    aria-describedby={`${id}-email-hint`} />
                                <FieldDescription id={`${id}-email-hint`}>We will send you a code and a link.</FieldDescription>
                            </Field>
                            <FormMessage state={state} />
                            <Button type="submit" size="lg" className="w-full" disabled={pending}>
                                {pending && <Spinner data-icon="inline-start" />}
                                Email me a sign-in code
                            </Button>
                        </FieldGroup>
                    </form>
                </>
            ) : (
                // A link, so it opens the form before hydration too (a full navigation to ?with=email)
                <a href={signInHref(next, true)} onClick={(event) => { event.preventDefault(); setEmailOpen(true); }}
                    aria-label="Sign in with email" aria-describedby={lastUsed === 'email' ? LAST_USED_ID : undefined} data-slot="button" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'relative w-full')}>
                    <MailIcon data-icon="inline-start" />
                    Email
                    {lastUsed === 'email' && <LastUsedBadge />}
                </a>
            )}
        </div>
    );
}
