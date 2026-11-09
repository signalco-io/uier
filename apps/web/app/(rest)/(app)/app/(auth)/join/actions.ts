'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { AccessDeniedError } from '@/src/lib/app/context';
import { getSessionUser } from '@/src/lib/app/session';
import { joinNextPath } from '@/src/lib/app/signInDestination';
import { parseActionInput, workspaceIdSchema } from '@/src/lib/app/validation';
import { joinWorkspaceByDomain } from '@/src/lib/app/workspaceDomains';
import { selectWorkspace } from '@/src/lib/app/workspaceCookie';

/** Joins a workspace that offers the account's email domain, opens it and continues to `next` */
export async function joinWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
    const result = await actionResult(async () => {
        const user = await getSessionUser();
        if (!user)
            throw new AccessDeniedError('Your session has ended. Sign in again.');
        const workspaceId = parseActionInput(workspaceIdSchema, formData.get('workspaceId'));
        await joinWorkspaceByDomain(user, workspaceId);
        await selectWorkspace(workspaceId);
    });
    if (!result?.ok)
        return result;
    revalidatePath('/app', 'layout');
    redirect(joinNextPath(formData.get('next')));
}
