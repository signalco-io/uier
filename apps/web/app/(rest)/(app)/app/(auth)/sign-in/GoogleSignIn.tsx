import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { GoogleLogo } from '@/src/components/app/SignInProviderLogos';
import { KnownPages } from '@/src/knownPages';
import { isGoogleSignInConfigured } from '@/src/lib/app/google/config';
import { LAST_USED_ID, LastUsedBadge } from './LastUsedBadge';

const problems: Record<string, string> = {
    cancelled: 'Google sign-in was cancelled.',
    unverified: 'Google has not verified the email address of that account. Sign in with your email instead.',
    failed: 'Google sign-in did not work. Try again, or sign in with your email.',
    expired: 'That Google sign-in expired or was already used. Start again.',
    too_fast: 'Too many sign-in attempts. Try again later.',
    taken: 'That Google account is linked to another uier account.',
    other_account: 'Your uier account is linked to a different Google account. Use that one, or sign in with your email.',
    unavailable: 'Google sign-in is not available here. Sign in with your email.'
};

/** Why the last Google attempt did not sign in, at the top of the card */
export function GoogleSignInProblem({ outcome }: { outcome?: string | string[] }) {
    const problem = typeof outcome === 'string' && Object.hasOwn(problems, outcome) ? problems[outcome] : undefined;
    if (!problem)
        return null;
    return (
        // The card content adds 12 px between its children: 24 px above the email field
        <Alert role="alert" className="mb-3">
            <CircleAlertIcon />
            <AlertDescription>{problem}</AlertDescription>
        </Alert>
    );
}

/** "Google" ("Sign in with Google" to assistive technologies), the same outline button as the other options (`SignInForm`'s `alternatives`) */
export function GoogleSignInButton({ next, lastUsed, addingAccount = false }: { next?: string; lastUsed?: boolean; addingAccount?: boolean }) {
    if (!isGoogleSignInConfigured())
        return null;
    const params = new URLSearchParams();
    if (next) params.set('next', next);
    if (addingAccount) params.set('add', '1');
    return (
        // A plain link: a full navigation, never prefetched (the route starts a sign-in).
        <a href={`${KnownPages.AppSignInGoogle}${params.size ? `?${params}` : ''}`}
            aria-label="Sign in with Google" aria-describedby={lastUsed ? LAST_USED_ID : undefined} data-slot="button" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'relative w-full')}>
            <GoogleLogo data-icon="inline-start" />
            Google
            {lastUsed && <LastUsedBadge />}
        </a>
    );
}
