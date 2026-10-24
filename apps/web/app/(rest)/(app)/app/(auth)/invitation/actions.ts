'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { actionResult, type ActionState } from '@/src/lib/app/actionResult';
import { acceptInvitation } from '@/src/lib/app/invitations';
import { startSession } from '@/src/lib/app/session';
import { WORKSPACE_COOKIE_NAME } from '@/src/lib/app/context';
import { memberReviewTarget } from '@/src/lib/app/review';
import { isLocalRuntime } from '@/src/lib/comments/environment';

/**
 * Accepts the invitation: signs the invited person in, opens the invited workspace and goes
 * straight to the project's review link (or the projects, when the invitation had no project).
 */
export async function acceptInvitationAction(_: ActionState, formData: FormData): Promise<ActionState> {
    const result = await actionResult(async () => await acceptInvitation(formData.get('token')));
    if (!result?.ok)
        return result;
    if (!result.data)
        return { ok: false, error: 'This invitation has expired or was already used. Ask for a new one.' };

    const { user, invitation } = result.data;
    await startSession(user.id);
    (await cookies()).set(WORKSPACE_COOKIE_NAME, invitation.workspaceId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 24 * 60 * 60,
        secure: !isLocalRuntime()
    });

    const target = invitation.projectId ? await memberReviewTarget(user.id, invitation.projectId, null) : null;
    redirect(target ?? KnownPages.AppProjects);
}
