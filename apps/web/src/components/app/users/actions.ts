'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { KnownPages } from '../../../knownPages';
import { actionResult, UserFacingError, type ActionState } from '../../../lib/app/actionResult';
import { appContextOrThrow } from '../../../lib/app/context';
import { inviteToWorkspace, removeMember, revokeInvitation } from '../../../lib/app/invitations';
import { listProjects } from '../../../lib/app/projects';
import { teamIdsSchema, relationshipSchema } from '../../../lib/app/teams';
import { emailSchema } from '../../../lib/app/users';
import { showsEmailLinksOnPage } from '../../../lib/email/send';
import { parseActionInput } from '../../../lib/app/validation';
import { removeMemberActionSchema, revokeInvitationActionSchema } from './actionSchemas';
import { getAppStore } from '../../../lib/app/store';
import { workspacePk, type DbInvitation } from '../../../lib/app/model';

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
        const teamIds = teamIdsSchema.parse(formData.getAll('team'));
        const relationship = relationshipSchema.parse(formData.get('relationship') || undefined);
        if (!allProjects && !selected.length && !teamIds.length)
            throw new UserFacingError('Choose the projects they can review.');

        const from = formData.get('from');
        const projectId = typeof from === 'string' && workspaceProjects.has(from) && (allProjects || selected.includes(from))
            ? from
            : (!allProjects && selected.length === 1 ? selected[0] : undefined);

        const { url } = await inviteToWorkspace(context, {
            email,
            role,
            projects: allProjects ? 'all' : [...new Set(selected)],
            projectId, teamIds, relationship
        });
        revalidatePath(KnownPages.App, 'layout');
        const { pathname, search } = new URL(url);
        return { email, devLink: showsEmailLinksOnPage() ? `${pathname}${search}` : undefined };
    }, 'Invitation sent.');
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionState> {
    return await actionResult(async () => {
        const input = parseActionInput(revokeInvitationActionSchema, { invitationId });
        const context = await appContextOrThrow({ admin: true });
        await revokeInvitation(context, input.invitationId);
        revalidatePath(KnownPages.App, 'layout');
    });
}

export async function removeMemberAction(userId: string): Promise<ActionState> {
    return await actionResult(async () => {
        const input = parseActionInput(removeMemberActionSchema, { userId });
        const context = await appContextOrThrow({ admin: true });
        await removeMember(context, input.userId);
        revalidatePath(KnownPages.App, 'layout');
    });
}

export async function resendInvitationAction(invitationId: string): Promise<ActionState<InvitationSent>> {
    return await actionResult(async () => {
        const input = parseActionInput(revokeInvitationActionSchema, { invitationId });
        const context = await appContextOrThrow({ admin: true });
        const invitation = (await getAppStore().get<DbInvitation>(workspacePk(context.workspace.id), input.invitationId))?.doc;
        if (invitation?.type !== 'invitation') throw new UserFacingError('This invitation is unavailable.');
        const { url } = await inviteToWorkspace(context, { email: invitation.email, role: invitation.role, projects: invitation.projects,
            teamIds: invitation.teamIds, relationship: invitation.relationship, projectId: invitation.projectId });
        revalidatePath(KnownPages.App, 'layout');
        const { pathname, search } = new URL(url);
        return { email: invitation.email, devLink: showsEmailLinksOnPage() ? `${pathname}${search}` : undefined };
    }, 'Invitation resent.');
}
