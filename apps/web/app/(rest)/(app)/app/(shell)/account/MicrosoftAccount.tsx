import { Section } from '@/src/components/app/PageHeader';
import { isMicrosoftSignInConfigured } from '@/src/lib/app/microsoft/config';
import { getMicrosoftAccount } from '@/src/lib/app/microsoft/identity';
import { PASSKEY_RECENT_SIGN_IN_SECONDS } from '@/src/lib/app/passkeys';
import { getSessionSignIn } from '@/src/lib/app/session';
import { MicrosoftAccountControls } from './MicrosoftAccountControls';

/** The linked Microsoft account. Hidden where Microsoft sign-in is off, unless one is linked (unlinking always works). */
export async function MicrosoftAccount({ userId }: { userId: string }) {
    const [account, session] = await Promise.all([getMicrosoftAccount(userId), getSessionSignIn()]);
    const configured = isMicrosoftSignInConfigured();
    if (!account && !configured)
        return null;
    // The rule for adding a passkey. Rendered per request (the app pages are dynamic), so the time is current.
    const recentSignIn = session?.userId === userId
        && Date.now() - session.signedInAt * 1000 <= PASSKEY_RECENT_SIGN_IN_SECONDS * 1000;
    return (
        <Section id="microsoft" title="Microsoft account" description="Sign in with Microsoft instead of an email code. Email sign-in always stays available.">
            <MicrosoftAccountControls linkedEmail={account ? account.email : null} configured={configured} recentSignIn={recentSignIn} />
        </Section>
    );
}
