import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { KnownPages } from '../../knownPages';
import { getSessionUser } from './session';
import { ensureOwnWorkspace, getWorkspace, listUserMemberships, ownWorkspaceId } from './workspaces';
import { ensurePublicProject, joinPublicProject, PUBLIC_WORKSPACE_ID } from '../comments/publicProject';
import type { DbMember, DbUser, DbWorkspace } from './model';
import { publicProjectMember } from '../comments/publicProjectPolicy';

export const WORKSPACE_COOKIE_NAME = 'uier_workspace';

export type Membership = {
    member: DbMember;
    workspace: DbWorkspace;
};

export type AppContext = {
    user: DbUser;
    /** The workspace the app shows */
    workspace: DbWorkspace;
    /** The user's membership in that workspace */
    member: DbMember;
    isAdmin: boolean;
    /** Every workspace of the user (more than one after accepting an invitation) */
    memberships: Membership[];
};

/** Thrown by server actions when the user may not do something */
export class AccessDeniedError extends Error {
    constructor(message = 'You don\'t have access to this.') {
        super(message);
        this.name = 'AccessDeniedError';
    }
}

/**
 * The signed-in user with their current workspace, or `null` when signed out. A user without any
 * workspace (a new user) gets their own. The current workspace is remembered in a cookie.
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
    const user = await getSessionUser();
    if (!user)
        return null;

    let members = await listUserMemberships(user.id);
    // Automatic feedback membership must not replace a new user's own workspace/onboarding.
    if (!members.some(member => member.workspaceId !== PUBLIC_WORKSPACE_ID))
        members.push(await ensureOwnWorkspace(user));
    await ensurePublicProject();
    const feedbackMember = publicProjectMember(await joinPublicProject(user), user.email);
    members = [...members.filter(member => member.workspaceId !== PUBLIC_WORKSPACE_ID), feedbackMember];

    const workspaces = await Promise.all(members.map(member => getWorkspace(member.workspaceId)));
    const memberships = members
        .map((member, index) => ({ member, workspace: workspaces[index] }))
        .filter((membership): membership is Membership => Boolean(membership.workspace))
        .sort((a, b) => a.member.createdAt.localeCompare(b.member.createdAt));
    if (!memberships.length)
        return null;

    const selectedId = (await cookies()).get(WORKSPACE_COOKIE_NAME)?.value;
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
});

/** Pages: the app context, or a redirect to sign in */
export async function requireAppContext() {
    const context = await getAppContext();
    if (!context)
        redirect(KnownPages.AppSignIn);
    return context;
}

/** Pages: the app context of an admin, or a redirect to the app */
export async function requireAdminContext() {
    const context = await requireAppContext();
    if (!context.isAdmin)
        redirect(KnownPages.App);
    return context;
}

/** Server actions: the app context, or an error */
export async function appContextOrThrow({ admin = false } = {}) {
    const context = await getAppContext();
    if (!context)
        throw new AccessDeniedError('Your session has ended. Sign in again.');
    if (admin && !context.isAdmin)
        throw new AccessDeniedError('Only admins can do this.');
    return context;
}
