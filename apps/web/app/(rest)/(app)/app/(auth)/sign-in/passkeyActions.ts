'use server';

import { redirect } from 'next/navigation';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { KnownPages } from '@/src/knownPages';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { passkeySignInOptions, verifyPasskeySignIn } from '@/src/lib/app/passkeys';
import { bindPasskeyChallenge, passkeyCeremonyContext, passkeyFailureMessage, takePasskeyChallenge } from '@/src/lib/app/passkeyRequest';
import { startSession } from '@/src/lib/app/session';
import { safeNextPath } from '@/src/lib/app/signIn';

export type PasskeySignInState = {
    ok: false;
    error: string;
    /** A passkey uier doesn't know: the page asks the browser to stop offering it */
    unknownCredential?: { rpId: string; credentialId: string };
};

/** A new sign-in challenge for this browser (the button and the email field's autofill) */
export async function passkeySignInOptionsAction(): Promise<ActionState<PublicKeyCredentialRequestOptionsJSON>> {
    return await actionResult(async () => {
        const { options, binding } = await passkeySignInOptions(await passkeyCeremonyContext());
        await bindPasskeyChallenge(binding);
        return options;
    });
}

/** Signs in with the passkey's response and continues to `next`; returns only on failure */
export async function passkeySignInAction(response: unknown, next: unknown): Promise<PasskeySignInState> {
    const result = await actionResult(async () => {
        const context = await passkeyCeremonyContext();
        return { context, outcome: await verifyPasskeySignIn(response, await takePasskeyChallenge(), context) };
    });
    if (!result?.ok)
        return { ok: false, error: result?.error ?? passkeyFailureMessage('failed', 'sign-in') };
    const { context, outcome } = result.data;
    if (!outcome.ok)
        return {
            ok: false, error: passkeyFailureMessage(outcome.reason, 'sign-in'),
            unknownCredential: outcome.credentialId ? { rpId: context.rp.id, credentialId: outcome.credentialId } : undefined
        };

    await startSession(outcome.value.id);
    redirect(safeNextPath(next) ?? KnownPages.App);
}
