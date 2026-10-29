import { nanoid } from 'nanoid';
import { getCommentsStore } from '../repo/commentsStore';
import { APP_COUNTERS_PARTITION, consume } from '../comments/rateLimits';
import { sendEmail } from '../email/send';
import { invitationEmail } from '../email/templates';
import { KnownPages } from '../../knownPages';
import { getAppStore, updateDoc } from './store';
import { isRandomToken, randomToken, sha256Hex } from './tokens';
import { findOrCreateUser, findUserByEmail } from './users';
import { getMember, getWorkspace } from './workspaces';
import { getProject } from './projects';
import { UserFacingError } from './actionErrors';
import { emailSuppression } from '../email/suppression';
import { revokeIntegrationGrantsOf } from '../integrations/connection';
import type { AppContext } from './context';
import { PUBLIC_WORKSPACE_ID, joinPublicProject } from '../comments/publicProject';
import { assertMutableWorkspace } from '../comments/publicProjectPolicy';
import {
    memberId,
    workspacePk,
    type DbInvitation,
    type DbInvitationToken,
    type DbMember,
    type DbWorkspace,
    type MemberRole,
    type ProjectsAccess
} from './model';

export const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;
const INVITATIONS_PER_WORKSPACE_PER_DAY = 50;

const invitationTokenPk = (hash: string) => `invitation:${hash}` as const;

export type NewInvitation = {
    email: string;
    role: MemberRole;
    /** Commenters: every project, or these (admins always have every project) */
    projects: ProjectsAccess;
    /** The project to open after accepting */
    projectId?: string;
};

export async function listInvitations(workspaceId: string) {
    const invitations = await getAppStore().query<DbInvitation>({ type: 'invitation', pk: workspacePk(workspaceId) });
    return invitations
        .filter(invitation => Date.parse(invitation.expiresAt) > Date.now())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Invites someone to the current workspace and emails them the link. Inviting the same address
 * again replaces the earlier invitation (and its link). Returns the link, which only the invited
 * person gets by email; pages show it only where no email is sent (local and previews).
 */
export async function inviteToWorkspace(context: AppContext, input: NewInvitation) {
    assertMutableWorkspace(context.workspace.id);
    if (!context.isAdmin) throw new UserFacingError('Only workspace admins can invite people.');
    if (await emailSuppression(input.email))
        throw new UserFacingError('Email to this address bounced. Ask them to sign in to uier before inviting them again.');
    const store = getAppStore();
    const workspaceId = context.workspace.id;

    const existingUser = await findUserByEmail(input.email);
    if (existingUser && await getMember(workspaceId, existingUser.id))
        throw new UserFacingError(`${input.email} is already in this workspace.`);

    await consume(getCommentsStore(), APP_COUNTERS_PARTITION, {
        key: `invitations:${workspaceId}`,
        limit: INVITATIONS_PER_WORKSPACE_PER_DAY,
        windowSeconds: 24 * 60 * 60,
        reason: 'too_fast',
        message: 'This workspace sent many invitations today. Try again tomorrow.'
    });

    for (const earlier of (await listInvitations(workspaceId)).filter(invitation => invitation.email === input.email))
        await revokeInvitation(workspaceId, earlier.id);

    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const now = new Date();
    const invitation: DbInvitation = {
        type: 'invitation',
        id: `invitation_${nanoid()}`,
        pk: workspacePk(workspaceId),
        workspaceId,
        email: input.email,
        role: input.role,
        projects: input.role === 'admin' ? 'all' : input.projects,
        projectId: input.projectId,
        invitedBy: context.user.id,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_SECONDS * 1000).toISOString(),
        tokenHash,
        // Deleted by the database once it expired, like its token
        ttl: INVITATION_TTL_SECONDS
    };
    await store.create(invitation);
    await store.create<DbInvitationToken>({
        type: 'invitation-token',
        id: tokenHash,
        pk: invitationTokenPk(tokenHash),
        workspaceId,
        invitationId: invitation.id,
        ttl: INVITATION_TTL_SECONDS
    });

    const { appBaseUrl } = await import('./request');
    const url = `${await appBaseUrl()}${KnownPages.AppInvitation}?token=${encodeURIComponent(token)}`;
    const project = input.projectId ? await getProject(workspaceId, input.projectId) : null;
    await sendEmail(invitationEmail({
        to: input.email,
        url,
        inviterName: context.user.name,
        inviterEmail: context.user.email,
        projectName: project?.name,
        role: input.role
    }));
    return { invitation, url };
}

export async function revokeInvitation(workspaceId: string, invitationId: string) {
    const store = getAppStore();
    const invitation = (await store.get<DbInvitation>(workspacePk(workspaceId), invitationId))?.doc;
    if (!invitation)
        return false;
    await store.delete(invitationTokenPk(invitation.tokenHash), invitation.tokenHash);
    return await store.delete(invitation.pk, invitation.id);
}

/** The pending invitation of a link token (without using it up), or `null` */
export async function getInvitation(token: unknown) {
    if (!isRandomToken(token))
        return null;
    const store = getAppStore();
    const hash = sha256Hex(token);
    const entry = (await store.get<DbInvitationToken>(invitationTokenPk(hash), hash))?.doc;
    if (!entry)
        return null;
    const invitation = (await store.get<DbInvitation>(workspacePk(entry.workspaceId), entry.invitationId))?.doc;
    if (!invitation || invitation.tokenHash !== hash || Date.parse(invitation.expiresAt) <= Date.now())
        return null;
    const workspace = await getWorkspace(invitation.workspaceId);
    return workspace ? { invitation, workspace } : null;
}

/** Both access lists together (an existing member keeps what they had) */
function mergeProjects(a: ProjectsAccess, b: ProjectsAccess): ProjectsAccess {
    if (a === 'all' || b === 'all')
        return 'all';
    return [...new Set([...a, ...b])];
}

/**
 * Uses up an invitation link: the invited person's account (created on first use) joins the
 * workspace with the invited role and projects. The link was emailed to that address, which is
 * what signs them in. Returns the member and the invitation, or `null` when the link is not valid.
 */
export async function acceptInvitation(token: unknown) {
    const pending = await getInvitation(token);
    if (!pending)
        return null;

    const store = getAppStore();
    const { invitation } = pending;
    // Deleting the token makes the link single-use
    if (!await store.delete(invitationTokenPk(invitation.tokenHash), invitation.tokenHash))
        return null;
    await store.delete(invitation.pk, invitation.id);

    const user = await findOrCreateUser(invitation.email);
    if (invitation.workspaceId === PUBLIC_WORKSPACE_ID) {
        // Earlier invitations can still sign their recipient in, but never assign a role.
        await joinPublicProject(user);
        return { user, invitation };
    }
    const now = new Date().toISOString();
    const member: DbMember = {
        type: 'member',
        id: memberId(user.id),
        pk: workspacePk(invitation.workspaceId),
        workspaceId: invitation.workspaceId,
        userId: user.id,
        email: user.email,
        role: invitation.role,
        projects: invitation.projects,
        createdAt: now
    };
    if (!await store.create(member)) {
        // Already a member: the higher role and both project lists
        await updateDoc<DbMember>(member.pk, member.id, existing => ({
            ...existing,
            role: existing.role === 'admin' || invitation.role === 'admin' ? 'admin' : 'commenter',
            projects: mergeProjects(existing.projects, invitation.projects)
        }));
    }
    return { user, invitation };
}

/** Removes someone from the workspace; the last admin stays */
export async function removeMember(context: AppContext, userId: string) {
    assertMutableWorkspace(context.workspace.id);
    if (!context.isAdmin) throw new UserFacingError('Only workspace admins can remove people.');
    const store = getAppStore();
    const workspaceId = context.workspace.id;
    const pk = workspacePk(workspaceId);
    for (let attempt = 0; attempt < 8; attempt++) {
        // Read the guard before counting admins. Every successful removal changes its etag.
        const workspace = await store.get<DbWorkspace>(pk, workspaceId);
        const stored = await store.get<DbMember>(pk, memberId(userId));
        if (!workspace || !stored)
            throw new UserFacingError('This person is no longer in the workspace.');
        const member = stored.doc;
        if (member.userId === context.user.id)
            throw new UserFacingError('You can\'t remove yourself.');
        if (member.role === 'admin') {
            const admins = await store.query<DbMember>({ type: 'member', pk, where: { role: 'admin' } });
            if (admins.length <= 1)
                throw new UserFacingError('A workspace needs at least one admin.');
        }
        const result = await store.replaceAndDelete({ ...workspace.doc,
            memberRemovalVersion: (workspace.doc.memberRemovalVersion ?? 0) + 1 }, workspace.etag, stored);
        if (result === 'ok') {
            await revokeIntegrationGrantsOf(workspaceId, member.userId, store);
            return;
        }
    }
    throw new UserFacingError('The workspace changed. Try again.');
}
