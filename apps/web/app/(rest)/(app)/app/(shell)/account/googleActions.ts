'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { unlinkGoogleAccount } from '@/src/lib/app/google/identity';
import { endSession } from '@/src/lib/app/session';

/** Takes no input: it always acts on the signed-in person's own account. */
export async function unlinkGoogleAction(_: ActionState): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow();
        await unlinkGoogleAccount(context.user.id);
        revalidatePath(KnownPages.AppAccount);
    }, 'Google account unlinked. Sign in with your email from now on.');
}

/** Linking needs a recent sign-in: sign out, then come back to Account after signing in */
export async function signInToLinkGoogleAction() {
    await endSession();
    redirect(`${KnownPages.AppSignIn}?next=${encodeURIComponent(KnownPages.AppAccount)}`);
}
