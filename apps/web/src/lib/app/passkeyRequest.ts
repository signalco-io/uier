import { cookies } from 'next/headers';
import { UserFacingError } from './actionErrors';
import { PASSKEY_CHALLENGE_COOKIE_NAME, PASSKEY_CHALLENGE_TTL_SECONDS, relyingParty, type PasskeyCeremonyContext, type PasskeyFailure } from './passkeys';
import { appBaseUrl, requestIpBucket } from './request';
import { appCookieOptions } from './session';

/** The relying party from `appBaseUrl()` and the client's rate-limit bucket */
export async function passkeyCeremonyContext(): Promise<PasskeyCeremonyContext> {
    const rp = relyingParty(await appBaseUrl());
    if (!rp)
        throw new UserFacingError('Passkeys need a domain name. Open uier on localhost instead of an IP address.');
    return { rp, ipBucket: await requestIpBucket() };
}

/** Binds a new challenge to this browser, replacing any earlier one */
export async function bindPasskeyChallenge(binding: string) {
    (await cookies()).set(PASSKEY_CHALLENGE_COOKIE_NAME, binding, appCookieOptions(PASSKEY_CHALLENGE_TTL_SECONDS));
}

/** The browser's challenge binding, cleared here: every verification uses it up */
export async function takePasskeyChallenge() {
    const jar = await cookies();
    const binding = jar.get(PASSKEY_CHALLENGE_COOKIE_NAME)?.value;
    jar.set(PASSKEY_CHALLENGE_COOKIE_NAME, '', appCookieOptions(0));
    return binding;
}

export function passkeyFailureMessage(reason: PasskeyFailure, ceremony: 'register' | 'sign-in') {
    switch (reason) {
        case 'expired': return 'This passkey request expired. Try again.';
        case 'unknown_credential': return 'uier doesn’t know this passkey. It may have been removed. Sign in with your email instead.';
        case 'already_added': return 'This passkey is already added to an account.';
        case 'failed': return ceremony === 'register'
            ? 'The passkey could not be added. Try again.'
            : 'This passkey did not work. Try again or sign in with your email.';
    }
}
