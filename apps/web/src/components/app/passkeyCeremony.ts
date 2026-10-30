import { sendSignal, WebAuthnError } from '@simplewebauthn/browser';

/**
 * What to tell the person when the browser's passkey prompt ends without a passkey, or `null`
 * when the page cancelled it (a newer prompt replaced the email field's autofill).
 */
export function passkeyPromptError(error: unknown, ceremony: 'register' | 'sign-in') {
    if (error instanceof WebAuthnError && error.code === 'ERROR_CEREMONY_ABORTED')
        return null;
    const name = error instanceof Error ? error.name : '';
    // Closed, timed out, or (at sign-in) no passkey for uier on this device: browsers don't say which.
    if (name === 'NotAllowedError')
        return ceremony === 'register'
            ? 'No passkey was added. The prompt was closed or timed out.'
            : 'No passkey was used. Try again or sign in with your email.';
    if (ceremony === 'register' && error instanceof WebAuthnError && error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')
        return 'This device already has a passkey for your account.';
    return ceremony === 'register'
        ? 'Your browser could not create a passkey. Try again or use another device.'
        : 'Your browser could not use a passkey. Try again or sign in with your email.';
}

/** Asks the browser and password manager to stop offering a passkey uier no longer accepts */
export function forgetPasskey(rpId: string, credentialId: string) {
    sendSignal({ signalName: 'unknownCredential', rpID: rpId, credentialID: credentialId }).catch(() => undefined);
}
