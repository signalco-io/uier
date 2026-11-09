'use client';

import { useActionState, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { InfoIcon, MailCheckIcon, MailIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { AuthCard } from '@/src/components/app/AuthCard';
import { FormMessage } from '@/src/components/app/FormMessage';
import { KnownPages } from '@/src/knownPages';
import { confirmSignInCodeAction, requestSignInAction, type SignInLinkSent } from './actions';
import type { SignInMethod } from '@/src/lib/app/session';
import { PasskeySignIn } from './PasskeySignIn';
import { LAST_USED_ID, LastUsedBadge } from './LastUsedBadge';

/** The sign-in page, keeping `next`; `email` opens the email form straight away (`?with=email`) */
function signInHref(next: string | undefined, email: boolean, addingAccount = false) {
    const params = new URLSearchParams();
    if (addingAccount) params.set('add', '1');
    if (next) params.set('next', next);
    if (email) params.set('with', 'email');
    const query = params.toString();
    return `${KnownPages.AppSignIn}${query ? `?${query}` : ''}`;
}

/**
 * The code field of a sent sign-in email. On its own (Google and Microsoft linking) it starts with the
 * "Check your email" status; the sign-in page's {@link SignInCodeStep} says that in the card's header.
 */
export function SignInCodeForm({ sent, next, announce = true, addingAccount = false }: { sent: SignInLinkSent; next?: string; announce?: boolean; addingAccount?: boolean }) {
    const id = useId();
    const [state, formAction, pending] = useActionState(confirmSignInCodeAction, null);
    const [code, setCode] = useState('');
    const invalid = state?.ok === false;

    return (
        <div className="flex flex-col gap-6">
            {announce && (
                <Alert role="status">
                    <MailCheckIcon />
                    <AlertTitle><h2 className="m-0 text-sm font-medium">Check your email</h2></AlertTitle>
                    <AlertDescription><p className="m-0"><SentTo sent={sent} /></p></AlertDescription>
                </Alert>
            )}
            {sent.devLink && (
                <Alert role="note">
                    <InfoIcon />
                    <AlertDescription>
                        <p className="m-0">
                            No email is sent on this deployment.{' '}
                            <Link href={sent.devLink} className="font-medium text-foreground underline underline-offset-4">Open the sign-in link</Link>
                            {' '}or type this code: <code data-sign-in-code>{sent.devCode}</code>
                        </p>
                    </AlertDescription>
                </Alert>
            )}
            <form action={formAction}>
                <input type="hidden" name="requestId" value={sent.requestId} />
                <FieldGroup>
                    <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor={`${id}-code`}>Sign-in code</FieldLabel>
                        <Input id={`${id}-code`} name="code" type="text" inputMode="numeric"
                            autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required autoFocus
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
                    <a href={signInHref(next, true, addingAccount)} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}>Ask for a new email</a>
                </FieldGroup>
            </form>
        </div>
    );
}

/** Where the code and link went, and for how long they work */
function SentTo({ sent }: { sent: SignInLinkSent }) {
    return <>
        We sent a code and a sign-in link to <span className="font-medium text-foreground">{sent.email}</span>.
        They work once and expire in 15 minutes.
    </>;
}

/** The sign-in card once the email is sent: its own header, then the code field (focused) */
function SignInCodeStep({ sent, next, addingAccount }: { sent: SignInLinkSent; next?: string; addingAccount?: boolean }) {
    return (
        <AuthCard title="Check your email" description={<span role="status"><SentTo sent={sent} /></span>}>
            <SignInCodeForm addingAccount={addingAccount} sent={sent} next={next} announce={false} />
        </AuthCard>
    );
}

/**
 * The sign-in card: the options, all the same outline button with the method's name ("Sign in with ..."
 * to assistive technologies): a passkey, `alternatives` (Google and Microsoft), then email, the last
 * resort, whose form opens in place (`withEmail` opens it straight away). `lastUsed` marks the option
 * this browser signed in with last; `problems` (a provider's failed sign-in) go above the options. Once
 * the email is sent, the card becomes the code step, with its own header.
 */
export function SignInForm({ next, alternatives, problems, withEmail = false, lastUsed, addingAccount = false }: {
    next?: string; alternatives?: ReactNode; problems?: ReactNode; withEmail?: boolean; lastUsed?: SignInMethod; addingAccount?: boolean;
}) {
    const id = useId();
    const [state, formAction, pending] = useActionState(requestSignInAction, null);
    const [emailOpen, setEmailOpen] = useState(withEmail);
    // Controlled, so a failed attempt keeps what was typed (React resets forms after an action)
    const [email, setEmail] = useState('');

    if (state?.ok) {
        return <SignInCodeStep key={state.data.requestId} sent={state.data} next={next} addingAccount={addingAccount} />;
    }

    return (
        <AuthCard title={addingAccount ? "Add account" : "Sign in"} description={addingAccount ? "Sign in to another account. Your other accounts stay signed in." : <>Choose how to sign in.<br />New here? Signing in creates your account.</>}>
            {problems}
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
                    <a href={signInHref(next, true, addingAccount)} onClick={(event) => { event.preventDefault(); setEmailOpen(true); }}
                        aria-label="Sign in with email" aria-describedby={lastUsed === 'email' ? LAST_USED_ID : undefined} data-slot="button" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'relative w-full')}>
                        <MailIcon data-icon="inline-start" />
                        Email
                        {lastUsed === 'email' && <LastUsedBadge />}
                    </a>
                )}
            </div>
        </AuthCard>
    );
}
