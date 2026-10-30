import { Section } from '@/src/components/app/PageHeader';
import { isGoogleSignInConfigured } from '@/src/lib/app/google/config';
import { getGoogleAccount } from '@/src/lib/app/google/identity';
import { recentEnoughToLink } from '@/src/lib/app/google/signIn';
import { getSessionSignIn } from '@/src/lib/app/session';
import { GoogleAccountControls } from './GoogleAccountControls';

/** The linked Google account. Hidden where Google sign-in is off, unless one is linked (unlinking always works). */
export async function GoogleAccount({ userId }: { userId: string }) {
    const [account, session] = await Promise.all([getGoogleAccount(userId), getSessionSignIn()]);
    const configured = isGoogleSignInConfigured();
    if (!account && !configured)
        return null;
    // Rendered per request (the app pages are dynamic), so the time is current
    const recentSignIn = session?.userId === userId && recentEnoughToLink(session.signedInAt);
    return (
        <Section id="google" title="Google account" description="Sign in with Google instead of an email code. Email sign-in always stays available.">
            <GoogleAccountControls linkedEmail={account ? account.email : null} configured={configured} recentSignIn={recentSignIn} />
        </Section>
    );
}
