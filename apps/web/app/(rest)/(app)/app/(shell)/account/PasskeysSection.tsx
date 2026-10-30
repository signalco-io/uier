import { getSessionSignIn } from '@/src/lib/app/session';
import { listPasskeys, passkeyView, PASSKEY_RECENT_SIGN_IN_SECONDS } from '@/src/lib/app/passkeys';
import { Passkeys } from './Passkeys';

/** Account: the person's passkeys. Adding one needs a recent sign-in on this browser (`passkeys.ts`). */
export async function PasskeysSection({ userId }: { userId: string }) {
    const [passkeys, session] = await Promise.all([listPasskeys(userId), getSessionSignIn()]);
    // Rendered per request (the app pages are dynamic), so the time is current.
    const recentSignIn = session?.userId === userId
        && Date.now() - session.signedInAt * 1000 <= PASSKEY_RECENT_SIGN_IN_SECONDS * 1000;
    return <Passkeys passkeys={passkeys.map(passkeyView)} recentSignIn={recentSignIn} />;
}
