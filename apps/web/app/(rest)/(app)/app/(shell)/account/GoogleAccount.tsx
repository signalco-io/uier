import { Section } from '@/src/components/app/PageHeader';
import { isGoogleSignInConfigured } from '@/src/lib/app/google/config';
import { getGoogleAccount } from '@/src/lib/app/google/identity';
import { PASSKEY_RECENT_SIGN_IN_SECONDS } from '@/src/lib/app/passkeys';
import { getSessionSignIn } from '@/src/lib/app/session';
import { GoogleAccountControls } from './GoogleAccountControls';

/** The linked Google account. Hidden where Google sign-in is off, unless one is linked (unlinking always works). */
export async function GoogleAccount({ userId }: { userId: string }) {
    const [account, session] = await Promise.all([getGoogleAccount(userId), getSessionSignIn()]);
    const configured = isGoogleSignInConfigured();
    if (!account && !configured)
        return null;
    // The rule for adding a passkey. Rendered per request (the app pages are dynamic), so the time is current.
    const recentSignIn = session?.userId === userId
        && Date.now() - session.signedInAt * 1000 <= PASSKEY_RECENT_SIGN_IN_SECONDS * 1000;
    return (
        <Section id="google" title="Google account" description="Sign in with Google instead of an email code. Email sign-in always stays available.">
            <GoogleAccountControls linkedEmail={account ? account.email : null} configured={configured} recentSignIn={recentSignIn} />
        </Section>
    );
}
