'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { KnownPages } from '@/src/knownPages';
import { actionResult, UserFacingError, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import {
    PASSKEY_SIGN_IN_AGAIN, passkeyIdSchema, passkeyNameSchema, passkeyRegistrationOptions, removePasskey, renamePasskey,
    verifyPasskeyRegistration, type PasskeyView
} from '@/src/lib/app/passkeys';
import { bindPasskeyChallenge, passkeyCeremonyContext, passkeyFailureMessage, takePasskeyChallenge } from '@/src/lib/app/passkeyRequest';
import { endSession, getSessionSignIn } from '@/src/lib/app/session';
import { parseActionInput } from '@/src/lib/app/validation';

/** `signInAgain`: the session is too old to add a passkey (`PASSKEY_RECENT_SIGN_IN_SECONDS`) */
export type PasskeyState<T> = NonNullable<ActionState<T>> & { signInAgain?: boolean };

function withSignInAgain<T>(state: ActionState<T>): PasskeyState<T> {
    if (!state)
        return { ok: false, error: 'Something went wrong. Try again.' };
    return !state.ok && state.error === PASSKEY_SIGN_IN_AGAIN ? { ...state, signInAgain: true } : state;
}

/** The signed-in user and when this browser's session signed in */
async function recentUser() {
    const context = await appContextOrThrow();
    const session = await getSessionSignIn();
    if (session?.userId !== context.user.id)
        throw new UserFacingError(PASSKEY_SIGN_IN_AGAIN);
    return { user: context.user, signedInAt: session.signedInAt };
}

export async function passkeyRegistrationOptionsAction(): Promise<PasskeyState<PublicKeyCredentialCreationOptionsJSON>> {
    return withSignInAgain(await actionResult(async () => {
        const { user, signedInAt } = await recentUser();
        const { options, binding } = await passkeyRegistrationOptions(user, signedInAt, await passkeyCeremonyContext());
        await bindPasskeyChallenge(binding);
        return options;
    }));
}

export async function addPasskeyAction(response: unknown): Promise<PasskeyState<PasskeyView>> {
    return withSignInAgain(await actionResult(async () => {
        const { user, signedInAt } = await recentUser();
        const binding = await takePasskeyChallenge();
        const outcome = await verifyPasskeyRegistration(user, signedInAt, response, binding, await passkeyCeremonyContext());
        if (!outcome.ok)
            throw new UserFacingError(passkeyFailureMessage(outcome.reason, 'register'));
        revalidatePath(KnownPages.AppAccount);
        return outcome.value;
    }, 'Passkey added. Use it the next time you sign in.'));
}

export async function renamePasskeyAction(passkeyId: string, name: string) {
    return await actionResult(async () => {
        const id = parseActionInput(passkeyIdSchema, passkeyId);
        const context = await appContextOrThrow();
        await renamePasskey(context.user.id, id, passkeyNameSchema.parse(name));
        revalidatePath(KnownPages.AppAccount);
    }, 'Passkey renamed.');
}

/** Removes the passkey; returns what the browser needs to stop offering it */
export async function removePasskeyAction(passkeyId: string) {
    return await actionResult(async () => {
        const id = parseActionInput(passkeyIdSchema, passkeyId);
        const context = await appContextOrThrow();
        const removed = await removePasskey(context.user.id, id);
        revalidatePath(KnownPages.AppAccount);
        if (!removed)
            return null;
        const { rp } = await passkeyCeremonyContext().catch(() => ({ rp: null }));
        return rp ? { rpId: rp.id, credentialId: removed.credentialId } : null;
    });
}

/** A fresh sign-in, so the person can add a passkey: back to Account afterwards */
export async function signInAgainAction() {
    await endSession();
    redirect(`${KnownPages.AppSignIn}?next=${encodeURIComponent(KnownPages.AppAccount)}`);
}
