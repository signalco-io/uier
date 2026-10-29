'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { KnownPages } from '../../../knownPages';
import { actionResult, UserFacingError, type ActionState } from '../../../lib/app/actionResult';
import { appContextOrThrow } from '../../../lib/app/context';
import { inviteToWorkspace, removeMember, revokeInvitation } from '../../../lib/app/invitations';
import { listProjects } from '../../../lib/app/projects';
import { emailSchema } from '../../../lib/app/users';
import { showsEmailLinksOnPage } from '../../../lib/email/send';
import { parseActionInput } from '../../../lib/app/validation';
import { removeMemberActionSchema, revokeInvitationActionSchema } from './actionSchemas';

export type InvitationSent = {
    email: string;
    /** The invitation link's path, only where no email is sent (locally and on previews) */
    devLink?: string;
};

const roleSchema = z.enum(['admin', 'commenter'], 'Choose a role.');

export async function inviteAction(_: ActionState<InvitationSent>, formData: FormData): Promise<ActionState<InvitationSent>> {
    return await actionResult(async () => {
        const context = await appContextOrThrow({ admin: true });
        const email = emailSchema.parse(formData.get('email') ?? '');
        const role = roleSchema.parse(formData.get('role'));
        const workspaceProjects = new Set((await listProjects(context.workspace.id)).map(project => project.id));

        const selected = formData.getAll('project').filter((id): id is string => typeof id === 'string' && workspaceProjects.has(id));
        const allProjects = role === 'admin' || formData.get('access') === 'all';
        if (!allProjects && !selected.length)
            throw new UserFacingError('Choose the projects they can review.');

        const from = formData.get('from');
        const projectId = typeof from === 'string' && workspaceProjects.has(from) && (allProjects || selected.includes(from))
            ? from
            : (!allProjects && selected.length === 1 ? selected[0] : undefined);

        const { url } = await inviteToWorkspace(context, {
            email,
            role,
            projects: allProjects ? 'all' : [...new Set(selected)],
            projectId
        });
        revalidatePath(KnownPages.AppUsers);
        const { pathname, search } = new URL(url);
        return { email, devLink: showsEmailLinksOnPage() ? `${pathname}${search}` : undefined };
    }, 'Invitation sent.');
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionState> {
    return await actionResult(async () => {
        const input = parseActionInput(revokeInvitationActionSchema, { invitationId });
        const context = await appContextOrThrow({ admin: true });
        await revokeInvitation(context.workspace.id, input.invitationId);
        revalidatePath(KnownPages.AppUsers);
    });
}

export async function removeMemberAction(userId: string): Promise<ActionState> {
    return await actionResult(async () => {
        const input = parseActionInput(removeMemberActionSchema, { userId });
        const context = await appContextOrThrow({ admin: true });
        await removeMember(context, input.userId);
        revalidatePath(KnownPages.AppUsers);
    });
}
