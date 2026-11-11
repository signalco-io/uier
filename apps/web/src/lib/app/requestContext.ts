import type { AppContext, Membership } from './context';
import type { DbUser } from './model';
import { ensureOwnWorkspace, getWorkspace, listUserMemberships, ownWorkspaceId } from './workspaces';
import { ensurePublicProject, joinPublicProject, PUBLIC_WORKSPACE_ID } from '../comments/publicProject';
import { publicProjectMember } from '../comments/publicProjectPolicy';

/** Shared request context for the page preflight and render. Never persist across requests. */
export async function loadAppContext(user: DbUser | null, selectedId?: string): Promise<AppContext | null> {
    if (!user)
        return null;

    const [existingMembers] = await Promise.all([listUserMemberships(user.id), ensurePublicProject()]);
    let members = existingMembers;
    // Automatic feedback membership must not replace a new user's own workspace/onboarding.
    if (!members.some(member => member.workspaceId !== PUBLIC_WORKSPACE_ID))
        members.push(await ensureOwnWorkspace(user));
    const feedbackMember = publicProjectMember(await joinPublicProject(user), user.email);
    members = [...members.filter(member => member.workspaceId !== PUBLIC_WORKSPACE_ID), feedbackMember];

    const workspaces = await Promise.all(members.map(member => getWorkspace(member.workspaceId)));
    const memberships = members
        .map((member, index) => ({ member, workspace: workspaces[index] }))
        .filter((membership): membership is Membership => Boolean(membership.workspace))
        .sort((a, b) => a.member.createdAt.localeCompare(b.member.createdAt));
    if (!memberships.length)
        return null;

    const current = memberships.find(m => m.workspace.id === selectedId)
        ?? memberships.find(m => m.workspace.id === ownWorkspaceId(user.id))
        ?? memberships.find(m => m.workspace.id !== PUBLIC_WORKSPACE_ID)
        ?? memberships[0]!;

    return {
        user,
        workspace: current.workspace,
        member: current.member,
        isAdmin: current.member.role === 'admin',
        memberships
    };
}
