'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { KnownPages } from '@/src/knownPages';
import { unlinkGoogleAction } from './googleActions';

const outcomes: Record<string, string> = {
    linked: 'Google account linked. You can sign in with it now.',
    taken: 'That Google account is linked to another uier account.',
    other_account: 'Your account is linked to a different Google account. Unlink it first.',
    cancelled: 'Linking was cancelled.',
    failed: 'Google did not link. Try again.',
    expired: 'Google did not link. Try again.',
    too_fast: 'Too many attempts. Try again later.',
    unavailable: 'Google sign-in is not available here.'
};

export function GoogleAccountControls({ linkedEmail, configured }: { linkedEmail: string | null; configured: boolean }) {
    const [state, formAction, pending] = useActionState(unlinkGoogleAction, null);
    const outcome = useSearchParams().get('google');
    const linked = linkedEmail !== null;
    // The return from Google stays in the address; say "linked" only while it still is
    const notice = !state && outcome && Object.hasOwn(outcomes, outcome) && (outcome !== 'linked' || linked) ? outcomes[outcome] : undefined;

    return (
        <div className="flex flex-col items-start gap-4">
            {notice && <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>}
            <p className="m-0 text-sm">
                {linked
                    ? linkedEmail ? <>Linked to <span className="font-medium">{linkedEmail}</span>.</> : 'A Google account is linked.'
                    : 'No Google account is linked.'}
            </p>
            <FormMessage state={state} />
            {linked
                ? (
                    <form action={formAction}>
                        <Button type="submit" variant="outline" disabled={pending}>
                            {pending && <Spinner data-icon="inline-start" />}
                            Unlink Google account
                        </Button>
                    </form>
                )
                : configured && (
                    <Button variant="outline" asChild>
                        {/* A full navigation, never prefetched: the route starts the link with Google */}
                        <a href={`${KnownPages.AppSignInGoogle}?intent=link`}>Link Google account</a>
                    </Button>
                )}
        </div>
    );
}
