'use server';

import { revalidatePath } from 'next/cache';
import { KnownPageLinks } from '@/src/knownPages';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { appContextOrThrow } from '@/src/lib/app/context';
import { unlinkMicrosoftAccount } from '@/src/lib/app/microsoft/identity';

/** Takes no input: it always acts on the signed-in person's own account. */
export async function unlinkMicrosoftAction(_: ActionState): Promise<ActionState> {
    return await actionResult(async () => {
        const context = await appContextOrThrow();
        await unlinkMicrosoftAccount(context.user.id);
        revalidatePath(KnownPageLinks.account('sign-in'));
    }, 'Microsoft account unlinked. Sign in with your email from now on.');
}
