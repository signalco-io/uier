import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { MicrosoftLogo } from '@/src/components/app/SignInProviderLogos';
import { KnownPages } from '@/src/knownPages';
import { isMicrosoftSignInConfigured } from '@/src/lib/app/microsoft/config';
import { LAST_USED_ID, LastUsedBadge } from './LastUsedBadge';

const problems: Record<string, string> = {
    cancelled: 'Microsoft sign-in was cancelled.',
    failed: 'Microsoft sign-in did not work. Try again, or sign in with your email.',
    expired: 'That Microsoft sign-in expired or was already used. Start again.',
    too_fast: 'Too many sign-in attempts. Try again later.',
    taken: 'That Microsoft account is linked to another uier account.',
    other_account: 'Your uier account is linked to a different Microsoft account. Use that one, or sign in with your email.',
    unavailable: 'Microsoft sign-in is not available here. Sign in with your email.'
};

export function MicrosoftSignInProblem({ outcome }: { outcome?: string | string[] }) {
    const problem = typeof outcome === 'string' && Object.hasOwn(problems, outcome) ? problems[outcome] : undefined;
    if (!problem) return null;
    return <Alert role="alert" className="mb-3"><CircleAlertIcon /><AlertDescription>{problem}</AlertDescription></Alert>;
}

export function MicrosoftSignInButton({ next, lastUsed, addingAccount = false }: { next?: string; lastUsed?: boolean; addingAccount?: boolean }) {
    if (!isMicrosoftSignInConfigured()) return null;
    const params = new URLSearchParams();
    if (next) params.set('next', next);
    if (addingAccount) params.set('add', '1');
    return (
        // Full navigation: this route starts a sign-in and must never be prefetched.
        <a href={`${KnownPages.AppSignInMicrosoft}${params.size ? `?${params}` : ''}`}
            aria-label="Sign in with Microsoft" aria-describedby={lastUsed ? LAST_USED_ID : undefined} data-slot="button" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'relative w-full')}>
            <MicrosoftLogo data-icon="inline-start" />
            Microsoft
            {lastUsed && <LastUsedBadge />}
        </a>
    );
}
