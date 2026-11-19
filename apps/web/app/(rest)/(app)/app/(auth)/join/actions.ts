'use server';

import { refresh, revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { AccessDeniedError } from '@/src/lib/app/context';
import { DOMAIN_JOIN_SIGN_IN_AGAIN } from '@/src/lib/app/emailProof';
import { getSessionEmailProof, getSessionUser } from '@/src/lib/app/session';
import { joinNextPath } from '@/src/lib/app/signInDestination';
import { parseActionInput, workspaceIdSchema } from '@/src/lib/app/validation';
import { joinWorkspaceByDomain } from '@/src/lib/app/workspaceDomains';
import { selectWorkspace } from '@/src/lib/app/workspaceCookie';

/**
 * Joins a workspace that offers the account's email domain, opens it and continues to `next`. The session's
 * email proof is checked again here (`joinWorkspaceByDomain`), not only when the page showed the offer.
 */
export async function joinWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
    const result = await actionResult(async () => {
        const user = await getSessionUser();
        if (!user)
            throw new AccessDeniedError('Your session has ended. Sign in again.');
        const workspaceId = parseActionInput(workspaceIdSchema, formData.get('workspaceId'));
        await joinWorkspaceByDomain(user, workspaceId, await getSessionEmailProof(user));
        await selectWorkspace(workspaceId);
    });
    if (!result?.ok) {
        // The page drew its offers with an email proof that has run out since. Draw it again: without a fresh
        // proof it is the Sign in again card, which names no workspace.
        if (result?.error === DOMAIN_JOIN_SIGN_IN_AGAIN) refresh();
        return result;
    }
    revalidatePath('/app', 'layout');
    redirect(joinNextPath(formData.get('next')));
}
