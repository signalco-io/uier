import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { Button } from '@/src/components/ui/button';
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

export function MicrosoftSignInButton({ next, lastUsed }: { next?: string; lastUsed?: boolean }) {
    if (!isMicrosoftSignInConfigured()) return null;
    return (
        <Button variant="outline" size="lg" className="relative w-full" asChild>
            {/* Full navigation: this route starts a sign-in and must never be prefetched. */}
            <a href={`${KnownPages.AppSignInMicrosoft}${next ? `?next=${encodeURIComponent(next)}` : ''}`}
                aria-label="Sign in with Microsoft" aria-describedby={lastUsed ? LAST_USED_ID : undefined}>
                {/* Official Microsoft asset, kept in its original colours. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/microsoft.svg" width={16} height={16} alt="" data-icon="inline-start" className="size-4 shrink-0" />
                Microsoft
                {lastUsed && <LastUsedBadge />}
            </a>
        </Button>
    );
}
