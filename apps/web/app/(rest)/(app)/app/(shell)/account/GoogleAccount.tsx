import { Section } from '@/src/components/app/PageHeader';
import { isGoogleSignInConfigured } from '@/src/lib/app/google/config';
import { getGoogleAccount } from '@/src/lib/app/google/identity';
import { GoogleAccountControls } from './GoogleAccountControls';

/** The linked Google account. Hidden where Google sign-in is off, unless one is linked (unlinking always works). */
export async function GoogleAccount({ userId }: { userId: string }) {
    const account = await getGoogleAccount(userId);
    const configured = isGoogleSignInConfigured();
    if (!account && !configured)
        return null;
    return (
        <Section id="google" title="Google account" description="Sign in with Google instead of an email code. Email sign-in always stays available.">
            <GoogleAccountControls linkedEmail={account ? account.email : null} configured={configured} />
        </Section>
    );
}
