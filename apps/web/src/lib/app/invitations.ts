import { nanoid } from 'nanoid';
import { getCommentsStore } from '../repo/commentsStore';
import { APP_COUNTERS_PARTITION, consume } from '../comments/rateLimits';
import { sendEmail } from '../email/send';
import { invitationEmail } from '../email/templates';
import { KnownPages } from '../../knownPages';
import { getAppStore } from './store';
import { isRandomToken, randomToken, sha256Hex } from './tokens';
import { findOrCreateUser, findUserByEmail } from './users';
import { getMember, getWorkspace } from './workspaces';
import { getProject } from './projects';
import { accessGeneration, bumpAccessGeneration, mutateAccess } from './accessMutations';
import { getTeam, validateTeamIds, validateProjectIds, relationshipSchema, teamIdsSchema } from './teams';
import type { AppStore } from './store';
import { z } from 'zod';
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
    type MemberRole,
    type ProjectsAccess,
    type MemberRelationship
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
    teamIds?: string[];
    relationship?: MemberRelationship;
};

export async function listInvitations(workspaceId: string) {
    const invitations = await getAppStore().query<DbInvitation>({ type: 'invitation', pk: workspacePk(workspaceId) });
    return (
        await Promise.all(
            invitations.map((invitation) =>
                currentInvitation(invitation).then((current) => (current ? invitation : null))
            )
        )
    )
        .filter((invitation): invitation is DbInvitation => Boolean(invitation))
        .filter((invitation) => Date.parse(invitation.expiresAt) > Date.now())
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
    z.enum(['admin', 'commenter']).parse(input.role);
    relationshipSchema.parse(input.relationship);
    await validateTeamIds(context.workspace.id, input.teamIds ?? []);
    if (input.projects !== 'all') await validateProjectIds(context.workspace.id, input.projects);
    if (input.role !== 'admin' && input.projects !== 'all' && !input.projects.length && !input.teamIds?.length)
        throw new UserFacingError('Choose teams or direct projects they can review.');
    if (await emailSuppression(input.email))
        throw new UserFacingError(
            'Email to this address bounced. Ask them to sign in to uier before inviting them again.'
        );
    const store = getAppStore();
    const workspaceId = context.workspace.id;

    const existingUser = await findUserByEmail(input.email);
    if (existingUser && (await getMember(workspaceId, existingUser.id)))
        throw new UserFacingError(`${input.email} is already in this workspace.`);

    await consume(getCommentsStore(), APP_COUNTERS_PARTITION, {
        key: `invitations:${workspaceId}`,
        limit: INVITATIONS_PER_WORKSPACE_PER_DAY,
        windowSeconds: 24 * 60 * 60,
        reason: 'too_fast',
        message: 'This workspace sent many invitations today. Try again tomorrow.'
    });

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
    await mutateAccess(workspaceId, context.user.id, async (currentStore) => {
        z.enum(['admin', 'commenter']).parse(input.role);
        const teamIds = await validateTeamIds(workspaceId, input.teamIds ?? [], currentStore);
        const projects =
            input.role === 'admin' || input.projects === 'all'
                ? 'all'
                : await validateProjectIds(workspaceId, input.projects, currentStore);
        if (input.role !== 'admin' && projects !== 'all' && !projects.length && !teamIds.length)
            throw new UserFacingError('Choose teams or direct projects they can review.');
        const selectedTeams = await Promise.all(teamIds.map((id) => getTeam(workspaceId, id, currentStore)));
        const recipientGeneration = await bumpAccessGeneration(workspaceId, input.email, currentStore);
        Object.assign(invitation, {
            teamGenerations: Object.fromEntries(
                selectedTeams.map((team) => [team!.doc.id, team!.doc.invitationGeneration ?? 0])
            ),
            teamIds,
            projects,
            relationship: relationshipSchema.parse(input.relationship),
            recipientGeneration: recipientGeneration.doc.generation,
            issuerGeneration: await accessGeneration(workspaceId, context.user.email, currentStore)
        });
        return {
            operations: [recipientGeneration, { kind: 'create', doc: invitation }],
            action: 'invitation.created',
            targetIds: [invitation.id, ...teamIds],
            before: {},
            after: { role: invitation.role, projects, teamIds, relationship: invitation.relationship ?? null }
        };
    });
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
    await sendEmail(
        invitationEmail({
            to: input.email,
            url,
            inviterName: context.user.name,
            inviterEmail: context.user.email,
            projectName: project?.name,
            role: input.role,
            teamAccess: Boolean(input.teamIds?.length)
        })
    );
    return { invitation, url };
}

export async function revokeInvitation(context: AppContext, invitationId: string) {
    const workspaceId = context.workspace.id;
    await mutateAccess(workspaceId, context.user.id, async (store) => {
        const invitation = await store.get<DbInvitation>(workspacePk(workspaceId), invitationId);
        if (!invitation || invitation.doc.type !== 'invitation') return null;
        return {
            operations: [{ kind: 'delete', pk: invitation.doc.pk, id: invitationId, etag: invitation.etag }],
            action: 'invitation.revoked',
            targetIds: [invitationId],
            before: { projects: invitation.doc.projects, teamIds: invitation.doc.teamIds ?? [] },
            after: {}
        };
    });
}

/** Current grants and revocation checks; token lookup alone is never authority. */
async function currentInvitation(invitation: DbInvitation, store: AppStore = getAppStore()) {
    if (Date.parse(invitation.expiresAt) <= Date.now() || !['admin', 'commenter'].includes(invitation.role))
        return null;
    if (
        (invitation.recipientGeneration ?? 0) !==
        (await accessGeneration(invitation.workspaceId, invitation.email, store))
    )
        return null;
    if (invitation.workspaceId === PUBLIC_WORKSPACE_ID) return { ...invitation, teamIds: [] };
    const ids = teamIdsSchema.safeParse(invitation.teamIds ?? []);
    if (!ids.success) return null;
    if (ids.data.length) {
        const issuer = await getMember(invitation.workspaceId, invitation.invitedBy);
        const issuerUser = issuer ? await findUserByEmail(issuer.email) : null;
        if (
            !issuer ||
            !issuerUser ||
            issuerUser.id !== issuer.userId ||
            issuer.role !== 'admin' ||
            (invitation.issuerGeneration ?? 0) !== (await accessGeneration(invitation.workspaceId, issuer.email, store))
        )
            return null;
    }
    const teams = await Promise.all(ids.data.map((id) => getTeam(invitation.workspaceId, id, store)));
    const teamIds = teams.flatMap((team) =>
        team?.doc.state === 'active' &&
        (invitation.teamGenerations?.[team.doc.id] ?? 0) === (team.doc.invitationGeneration ?? 0)
            ? [team.doc.id]
            : []
    );
    const direct: ProjectsAccess =
        invitation.projects === 'all'
            ? 'all'
            : (
                  await Promise.all(
                      invitation.projects.map(async (id) => {
                          const project = await getProject(invitation.workspaceId, id);
                          return project?.workspaceId === invitation.workspaceId ? id : null;
                      })
                  )
              ).filter((id): id is string => Boolean(id));
    if (invitation.role !== 'admin' && direct !== 'all' && !direct.length && !teamIds.length) return null;
    return { ...invitation, projects: direct, teamIds };
}

/** The pending invitation of a link token (without using it up), or `null` */
export async function getInvitation(token: unknown) {
    if (!isRandomToken(token)) return null;
    const store = getAppStore();
    const hash = sha256Hex(token);
    const entry = (await store.get<DbInvitationToken>(invitationTokenPk(hash), hash))?.doc;
    if (!entry) return null;
    const invitation = (await store.get<DbInvitation>(workspacePk(entry.workspaceId), entry.invitationId))?.doc;
    if (!invitation || invitation.tokenHash !== hash || Date.parse(invitation.expiresAt) <= Date.now()) return null;
    const workspace = await getWorkspace(invitation.workspaceId);
    const current = workspace ? await currentInvitation(invitation, store) : null;
    return workspace && current ? { invitation: current, workspace } : null;
}

/** Both access lists together (an existing member keeps what they had) */
function mergeProjects(a: ProjectsAccess, b: ProjectsAccess): ProjectsAccess {
    if (a === 'all' || b === 'all') return 'all';
    return [...new Set([...a, ...b])];
}

/**
 * Uses up an invitation link: the invited person's account (created on first use) joins the
 * workspace with the invited role and projects. The link was emailed to that address, which is
 * what signs them in. Returns the member and the invitation, or `null` when the link is not valid.
 */
export async function acceptInvitation(token: unknown) {
    const pending = await getInvitation(token);
    if (!pending) return null;

    const store = getAppStore();
    const { invitation } = pending;
    const user = await findOrCreateUser(invitation.email);
    if (invitation.workspaceId === PUBLIC_WORKSPACE_ID) {
        if (!(await store.delete(invitationTokenPk(invitation.tokenHash), invitation.tokenHash))) return null;
        await store.delete(invitation.pk, invitation.id);
        await joinPublicProject(user);
        return { user, invitation };
    }
    let accepted = false;
    await mutateAccess(
        invitation.workspaceId,
        user.id,
        async (currentStore) => {
            accepted = false;
            const pending = await currentStore.get<DbInvitation>(invitation.pk, invitation.id);
            if (!pending || pending.doc.tokenHash !== invitation.tokenHash) return null;
            const current = await currentInvitation(pending.doc, currentStore);
            if (!current) return null;
            const old = await currentStore.get<DbMember>(invitation.pk, memberId(user.id));
            const teamIds = teamIdsSchema.parse([
                ...new Set([...(old?.doc.teamIds ?? []), ...(current.teamIds ?? [])])
            ]);
            const member: DbMember = {
                type: 'member',
                id: memberId(user.id),
                pk: invitation.pk,
                workspaceId: invitation.workspaceId,
                userId: user.id,
                email: user.email,
                role: old?.doc.role === 'admin' || current.role === 'admin' ? 'admin' : 'commenter',
                projects: old ? mergeProjects(old.doc.projects, current.projects) : current.projects,
                teamIds,
                relationship: old?.doc.relationship ?? current.relationship,
                createdAt: old?.doc.createdAt ?? new Date().toISOString()
            };
            accepted = true;
            return {
                operations: [
                    old ? { kind: 'replace', doc: member, etag: old.etag } : { kind: 'create', doc: member },
                    { kind: 'delete', pk: invitation.pk, id: invitation.id, etag: pending.etag }
                ],
                action: 'invitation.accepted',
                targetIds: [invitation.id, member.id, ...teamIds],
                before: old ? { projects: old.doc.projects, teamIds: old.doc.teamIds ?? [] } : {},
                after: { role: member.role, projects: member.projects, teamIds }
            };
        },
        { admin: false }
    );
    // The workspace invitation is consumed in the same transaction as its grants. An orphaned
    // cross-partition lookup token cannot accept it again, even if this cleanup fails.
    if (!accepted) return null;
    await store.delete(invitationTokenPk(invitation.tokenHash), invitation.tokenHash);
    return { user, invitation };
}

/** Removes someone from the workspace; the last admin stays */
export async function removeMember(context: AppContext, userId: string) {
    assertMutableWorkspace(context.workspace.id);
    if (!context.isAdmin) throw new UserFacingError('Only workspace admins can remove people.');
    const workspaceId = context.workspace.id;
    await mutateAccess(workspaceId, context.user.id, async (store) => {
        const member = await store.get<DbMember>(workspacePk(workspaceId), memberId(userId));
        if (!member || member.doc.type !== 'member')
            throw new UserFacingError('This person is no longer in the workspace.');
        if (member.doc.userId === context.user.id) throw new UserFacingError("You can't remove yourself.");
        if (member.doc.role === 'admin') {
            const admins = await store.query<DbMember>({
                type: 'member',
                pk: workspacePk(workspaceId),
                where: { role: 'admin' }
            });
            if (admins.length <= 1) throw new UserFacingError('A workspace needs at least one admin.');
        }
        return {
            operations: [
                { kind: 'delete', pk: member.doc.pk, id: member.doc.id, etag: member.etag },
                await bumpAccessGeneration(workspaceId, member.doc.email, store)
            ],
            action: 'member.removed',
            targetIds: [member.doc.id],
            before: { role: member.doc.role, projects: member.doc.projects, teamIds: member.doc.teamIds ?? [] },
            after: {}
        };
    });
    await revokeIntegrationGrantsOf(workspaceId, userId, getAppStore());
}
