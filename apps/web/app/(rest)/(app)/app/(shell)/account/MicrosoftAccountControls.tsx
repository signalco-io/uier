'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LogInIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { KnownPages } from '@/src/knownPages';
import { unlinkMicrosoftAction } from './microsoftActions';
import { signInAgainAction } from './passkeyActions';

const outcomes: Record<string, string> = {
    linked: 'Microsoft account linked. You can sign in with it now.',
    taken: 'That Microsoft account is linked to another uier account.',
    other_account: 'Your account is linked to a different Microsoft account. Unlink it first.',
    cancelled: 'Linking was cancelled.',
    failed: 'Microsoft did not link. Try again.',
    expired: 'Microsoft did not link. Try again.',
    too_fast: 'Too many attempts. Try again later.',
    unavailable: 'Microsoft sign-in is not available here.'
    // `sign_in_again` has no line: the panel under the status says it
};

export function MicrosoftAccountControls({ linkedEmail, configured, recentSignIn }: { linkedEmail: string | null; configured: boolean; recentSignIn: boolean }) {
    const [state, formAction, pending] = useActionState(unlinkMicrosoftAction, null);
    const outcome = useSearchParams().get('microsoft');
    const linked = linkedEmail !== null;
    // The return from Microsoft stays in the address; say "linked" only while it still is
    const notice = !state && outcome && Object.hasOwn(outcomes, outcome) && (outcome !== 'linked' || linked) ? outcomes[outcome] : undefined;

    return (
        <div className="flex flex-col items-start gap-4">
            {notice && <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>}
            <p className="m-0 text-sm">
                {linked
                    ? linkedEmail ? <>Linked to <span className="font-medium">{linkedEmail}</span>.</> : 'A Microsoft account is linked.'
                    : 'No Microsoft account is linked.'}
            </p>
            <FormMessage state={state} />
            {linked
                ? (
                    <form action={formAction}>
                        <Button type="submit" variant="outline" disabled={pending}>
                            {pending && <Spinner data-icon="inline-start" />}
                            Unlink Microsoft account
                        </Button>
                    </form>
                )
                : configured && (recentSignIn
                    ? (
                        // A full navigation, never prefetched: the route starts the link with Microsoft
                        <a href={`${KnownPages.AppSignInMicrosoft}?intent=link`} className={buttonVariants({ variant: 'outline' })}>Link Microsoft account</a>
                    )
                    : (
                        <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                            <p className="m-0 min-w-0 flex-1 text-sm text-muted-foreground">To link a Microsoft account, sign in again. Linking needs a sign-in from the last 10 minutes.</p>
                            <form action={signInAgainAction}>
                                <Button type="submit" variant="outline">
                                    <LogInIcon data-icon="inline-start" />
                                    Sign in again
                                </Button>
                            </form>
                        </div>
                    ))}
        </div>
    );
}
