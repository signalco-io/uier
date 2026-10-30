import { Google_Sans } from 'next/font/google';
import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { Button } from '@/src/components/ui/button';
import { Separator } from '@/src/components/ui/separator';
import { KnownPages } from '@/src/knownPages';
import { isGoogleSignInConfigured } from '@/src/lib/app/google/config';

// Google's branding rules fix this button's font (Google Sans Medium 14/20), its colours and the
// standard "G": the one place the app leaves Geist and the brand tokens. Self-hosted by next/font.
// next/font has no fallback metrics for it, so the fallback is Google's previous button font.
const googleSans = Google_Sans({ weight: '500', subsets: ['latin'], display: 'swap', adjustFontFallback: false, fallback: ['Roboto', 'Arial', 'sans-serif'] });

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

/** The standard Google "G" in Google's colours, which the branding rules do not allow to change */
function GoogleG() {
    return (
        <svg viewBox="0 0 48 48" aria-hidden="true" className="size-5">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
    );
}

/** "Continue with Google" above the email form, with why the last attempt did not sign in */
export function GoogleSignIn({ next, outcome }: { next?: string; outcome?: string | string[] }) {
    const problem = typeof outcome === 'string' && Object.hasOwn(problems, outcome) ? problems[outcome] : undefined;
    const configured = isGoogleSignInConfigured();
    if (!configured && !problem)
        return null;

    return (
        // The card content adds 12 px between its children: 24 px on both sides of "or"
        <div className="mb-3 flex flex-col gap-6">
            {problem && (
                <Alert role="alert">
                    <CircleAlertIcon />
                    <AlertDescription>{problem}</AlertDescription>
                </Alert>
            )}
            {configured && <>
                {/* A plain link: a full navigation, never prefetched (the route starts a sign-in) */}
                <Button variant="outline" size="lg" asChild
                    className={`${googleSans.className} relative w-full gap-2.5 px-3 text-sm leading-5 font-medium border-[#747775] bg-[#FFFFFF] text-[#1F1F1F] hover:bg-[#FFFFFF] hover:text-[#1F1F1F] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#131314] dark:hover:text-[#E3E3E3] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-current before:opacity-0 hover:before:opacity-[0.08] active:before:opacity-[0.12]`}>
                    <a href={`${KnownPages.AppSignInGoogle}${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
                        <GoogleG />
                        Continue with Google
                    </a>
                </Button>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Separator className="flex-1" />
                    or
                    <Separator className="flex-1" />
                </div>
            </>}
        </div>
    );
}
