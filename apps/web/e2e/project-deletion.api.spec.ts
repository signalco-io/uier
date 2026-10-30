import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { createProject, findProject, findReviewProject, getProject } from '../src/lib/app/projects';
import { projectByPublicId } from '../src/lib/app/projectPublicIds';
import { saveTeam, setTeamProjects, getTeam } from '../src/lib/app/teams';
import { deleteProject, runProjectDeletion, sweepProjectDeletions, type ProjectDeletion } from '../src/lib/app/projectDeletion';
import { createMcpCredential, authenticateMcp, mcpProject } from '../src/lib/mcp/credentials';
import { userPk as mcpUserPk, type McpGrant } from '../src/lib/mcp/oauth/grants';
import { notificationPk } from '../src/lib/notifications/preferences';
import { discoverIntegrationSync } from '../src/lib/integrations/discovery';
import { createWithScreenshot, screenshotInfo } from '../src/lib/comments/service';
import { parseScreenshot, type ParsedScreenshot } from '../src/lib/comments/screenshot';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { PUBLIC_PROJECT_ID, PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProjectPolicy';
import { memberId, projectRefPk, workspacePk, type DbInvitation, type DbMember, type DbProject } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import type { CommentsStore } from '../src/lib/repo/commentsStore';
import type { DbComment } from '../src/lib/db/schema';
import { pngImage } from './support/images';

test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
    process.env.UIER_COMMENTS_SECRET ??= 'project-deletion-local-test-secret';
});

const image = parseScreenshot(pngImage) as ParsedScreenshot;

async function fixture() {
    const store = getAppStore();
    const admin = await findOrCreateUser(`delete-admin-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(admin);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context: AppContext = { user: admin, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
    const doomed = await createProject(context, { name: 'Old site', urls: ['https://old.example'] });
    const kept = await createProject(context, { name: 'Kept site', urls: ['https://kept.example'] });
    const reviewer = await findOrCreateUser(`delete-reviewer-${randomUUID()}@example.com`);
    const reviewerMember: DbMember = { ...member, id: memberId(reviewer.id), userId: reviewer.id, email: reviewer.email,
        role: 'commenter', projects: [doomed.id, kept.id] };
    await store.create(reviewerMember);
    const reviewerContext: AppContext = { user: reviewer, member: reviewerMember, workspace, isAdmin: false,
        memberships: [{ member: reviewerMember, workspace }] };
    return { store, admin, context, doomed, kept, reviewer, reviewerMember, reviewerContext };
}

function thread(project: DbProject, text = 'Feedback'): DbComment {
    return { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id, path: '/', origin: project.urls[0],
        position: { type: 'page' }, thread: { items: [{ id: `item_${randomUUID()}`, text }] }, authorId: 'user:u_someone',
        createdAt: new Date().toISOString() };
}

test('only a current workspace admin deletes a project, and only by its exact name', async () => {
    const f = await fixture();
    await expect(deleteProject(f.reviewerContext, f.doomed.id, 'Old site')).rejects.toThrow('Only workspace admins can delete projects.');
    // A context from before a role change is not enough: the stored membership decides
    const demoted: DbMember = { ...f.reviewerMember, role: 'commenter' };
    await expect(deleteProject({ ...f.reviewerContext, isAdmin: true, member: demoted }, f.doomed.id, 'Old site'))
        .rejects.toThrow('Only workspace admins can delete projects.');
    for (const confirmation of ['', 'old site', 'Old', 'Kept site'])
        await expect(deleteProject(f.context, f.doomed.id, confirmation)).rejects.toThrow('Type the project name exactly as it is shown.');
    // Another workspace's admin cannot name it, by internal or public id
    const other = await fixture();
    for (const id of [f.doomed.id, f.doomed.publicId])
        await expect(deleteProject(other.context, id, 'Old site')).rejects.toThrow('This project no longer exists.');
    expect(await getProject(f.context.workspace.id, f.doomed.id)).not.toBeNull();
    expect(await f.store.get('project-deletion', f.doomed.id)).toBeNull();

    // Surrounding whitespace is forgiven, as the dialog trims it
    await deleteProject(f.context, f.doomed.id, '  Old site ');
    expect(await getProject(f.context.workspace.id, f.doomed.id)).toBeNull();
    await expect(deleteProject(f.context, f.doomed.id, 'Old site')).rejects.toThrow('This project no longer exists.');
});

test('the public feedback project and workspace cannot be deleted', async () => {
    const f = await fixture();
    const publicContext: AppContext = { ...f.context, workspace: { ...f.context.workspace, id: PUBLIC_WORKSPACE_ID } };
    for (const [context, id] of [[publicContext, PUBLIC_PROJECT_ID], [publicContext, f.doomed.id], [f.context, PUBLIC_PROJECT_ID]] as const)
        await expect(deleteProject(context, id, 'uier')).rejects.toThrow('The public feedback project settings are managed by uier.');
    const intent: ProjectDeletion = { type: 'project-deletion', pk: 'project-deletion', id: PUBLIC_PROJECT_ID, workspaceId: PUBLIC_WORKSPACE_ID,
        requestedBy: f.admin.id, requestedAt: new Date().toISOString() };
    await expect(runProjectDeletion(intent)).rejects.toThrow('The public feedback project settings are managed by uier.');
    expect((await findProject(PUBLIC_PROJECT_ID))?.id).toBe(PUBLIC_PROJECT_ID);
    expect(await f.store.get('project-deletion', PUBLIC_PROJECT_ID)).toBeNull();
});

test('deleting a project removes its comments, images, public ids, grants and records', async () => {
    const f = await fixture();
    const comments = getMemoryCommentsStore();
    const { store, doomed, kept } = f;
    const doomedThreads = [thread(doomed), thread(doomed), thread(doomed)];
    await createWithScreenshot(comments, { ...doomedThreads[0]!, screenshot: screenshotInfo(image) }, image);
    for (const item of doomedThreads.slice(1)) await comments.create(item);
    await comments.nextCommentNumber(`project:${doomed.id}`);
    const keptThread = thread(kept, 'Stays');
    await createWithScreenshot(comments, { ...keptThread, screenshot: screenshotInfo(image) }, image);

    // Notification and read records of the project
    const subscription = { type: 'notification-subscription', pk: notificationPk(doomed.id), id: `subscription_${randomUUID()}`,
        projectId: doomed.id, threadId: doomedThreads[1]!.id, actorId: `user:${f.reviewer.id}` };
    const preference = { type: 'notification-preference', pk: notificationPk(doomed.id), id: `preference_${randomUUID()}`, projectId: doomed.id, muted: true };
    const read = { type: 'review-read', pk: `review-read:${randomUUID()}`, id: doomedThreads[2]!.id, domain: `project:${doomed.id}`, reviewerId: 'user:u_someone' };
    const keptPreference = { ...preference, pk: notificationPk(kept.id), projectId: kept.id };
    for (const doc of [subscription, preference, read, keptPreference]) await store.create(doc);

    // A team and a direct grant over both projects, and invitations naming the project
    const now = Date.now();
    const teamId = await saveTeam(f.context, { name: 'Design' });
    await setTeamProjects(f.context, teamId, [doomed.id, kept.id]);
    const invitation = (projects: string[]): DbInvitation => {
        const tokenHash = randomUUID().replaceAll('-', '');
        return { type: 'invitation', id: `invitation_${randomUUID()}`, pk: doomed.pk, workspaceId: doomed.workspaceId,
            email: `invited-${randomUUID()}@example.com`, role: 'commenter', projects, projectId: doomed.id, invitedBy: f.admin.id,
            createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400_000).toISOString(), tokenHash, ttl: 7 * 86400 };
    };
    const only = invitation([doomed.id]);
    const both = invitation([doomed.id, kept.id]);
    for (const value of [only, both]) {
        await store.create(value);
        await store.create({ type: 'invitation-token', pk: `invitation:${value.tokenHash}`, id: value.tokenHash, workspaceId: value.workspaceId, invitationId: value.id, ttl: 7 * 86400 });
    }

    // Coding tool access: a token over both projects, one over this project alone and a connected app
    const credential = await createMcpCredential(f.context, { name: 'Both', projectIds: [doomed.id, kept.id], scopes: ['feedback:read'], days: 30 });
    const alone = await createMcpCredential(f.context, { name: 'Alone', projectIds: [doomed.id], scopes: ['feedback:read'], days: 30 });
    const grant: McpGrant = { type: 'mcp-grant', id: `grant_${randomUUID()}`, pk: mcpUserPk(f.admin.id), userId: f.admin.id, clientId: 'uier_client_test',
        client: { name: 'Test', kind: 'dcr', redirectHost: null }, name: 'Test', scopes: ['feedback:read'], resource: 'http://127.0.0.1/api/mcp',
        access: { kind: 'selected', workspaces: [{ workspaceId: doomed.workspaceId, projects: [doomed.id] }, { workspaceId: 'w_elsewhere', projects: 'all' }] },
        createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
        idleExpiresAt: new Date(now + 86400_000).toISOString(), absoluteExpiresAt: new Date(now + 86400_000).toISOString(), ttl: 2 * 86400 };
    await store.create(grant);
    const identity = await authenticateMcp(new Request('http://127.0.0.1', { headers: { authorization: `Bearer ${credential.token}` } }));
    expect((await mcpProject(identity, doomed.id)).project.id).toBe(doomed.id);

    // An integration's settings, credentials and ledger
    const connection = { type: 'notion-connection', provider: 'notion', pk: doomed.pk, id: `notion_${doomed.id}`, workspaceId: doomed.workspaceId,
        projectId: doomed.id, connectedBy: f.admin.id, enabled: true, status: 'connected', destinationRevision: 1, config: {},
        grantId: `notion_grant_${doomed.id}`, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    const notionGrant = { type: 'notion-grant', provider: 'notion', pk: doomed.pk, id: `notion_grant_${doomed.id}`, workspaceId: doomed.workspaceId,
        projectId: doomed.id, connectedBy: f.admin.id, status: 'connected', generation: 1, tokens: { access: 'sealed' } };
    const ledger = { type: 'notion-sync', provider: 'notion', pk: `notion:${doomed.id}`, id: `notion_${randomUUID()}`, workspaceId: doomed.workspaceId,
        connectionId: connection.id, projectId: doomed.id, threadId: doomedThreads[0]!.id, active: true, status: 'accepted', state: { pageId: 'page' } };
    for (const doc of [connection, notionGrant, ledger]) await store.create(doc);
    const stored = (await store.get<DbProject>(doomed.pk, doomed.id))!;
    await store.replace({ ...stored.doc, integrations: { notion: { connectionId: connection.id, since: new Date(now).toISOString() } } }, stored.etag);

    await deleteProject(f.context, doomed.id, 'Old site');

    // Nothing reaches the project: not its code, not its public id, not a review link
    for (const id of [doomed.id, doomed.publicId]) {
        expect(await getProject(doomed.workspaceId, id)).toBeNull();
        expect(await findReviewProject(id)).toBeNull();
    }
    expect(await findProject(doomed.id)).toBeNull();
    expect(await projectByPublicId(doomed.publicId)).toBeNull();
    // Both claims stay, without naming a workspace or project, so neither id is issued again
    expect((await store.get(projectRefPk(doomed.id), doomed.id))?.doc).toMatchObject({ type: 'project-ref-retired', ttl: -1 });
    expect((await store.get(projectRefPk(doomed.id), doomed.id))?.doc).not.toHaveProperty('workspaceId');
    const publicRef = (await store.get(`project-public:${doomed.publicId}`, doomed.publicId))?.doc;
    expect(publicRef).toMatchObject({ type: 'project-public-ref-retired', ttl: -1 });
    expect(publicRef).not.toHaveProperty('projectId');
    expect(await store.query({ type: 'project-public-ref', where: { projectId: doomed.id } })).toEqual([]);

    // Comments, their image, the comment numbers and every project record
    const domain = `project:${doomed.id}`;
    expect(await comments.listAll(domain, 1000)).toEqual([]);
    expect(await comments.getScreenshot(domain, doomedThreads[0]!.id)).toBeNull();
    expect(await comments.nextCommentNumber(domain)).toBe(1);
    await comments.deleteSequence(domain);
    for (const doc of [subscription, preference, read, connection, notionGrant, ledger])
        expect(await store.get(doc.pk, doc.id), doc.type).toBeNull();
    const cleanups = await store.query<{ type: 'thread-cleanup'; complete?: boolean } & import('../src/lib/app/model').AppDoc>({ type: 'thread-cleanup', where: { domain } });
    expect(cleanups.map(job => job.complete)).toEqual([true, true, true]);

    // Grants: removed from the team, the member and the invitations; the other project keeps them
    expect((await getTeam(doomed.workspaceId, teamId))?.doc.projectIds).toEqual([kept.id]);
    expect((await store.get<DbMember>(doomed.pk, f.reviewerMember.id))?.doc.projects).toEqual([kept.id]);
    expect(await store.get(doomed.pk, only.id)).toBeNull();
    expect(await store.get(`invitation:${only.tokenHash}`, only.tokenHash)).toBeNull();
    const remaining = (await store.get<DbInvitation>(doomed.pk, both.id))?.doc;
    expect(remaining?.projects).toEqual([kept.id]);
    expect(remaining).not.toHaveProperty('projectId');
    expect(remaining!.ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60);
    const events = await store.query<import('../src/lib/app/model').DbAccessEvent>({ type: 'access-event', pk: doomed.pk, targetId: doomed.id });
    expect(events.find(event => event.action === 'project.deleted')).toMatchObject({ actorId: f.admin.id });

    // Coding tools: the selections no longer name it, and one left with nothing is revoked
    await expect(mcpProject(identity, doomed.id)).rejects.toThrow();
    expect((await mcpProject(identity, kept.id)).project.id).toBe(kept.id);
    expect((await store.get<import('../src/lib/mcp/credentials').McpCredential>(mcpUserPk(f.admin.id), alone.credential.id))).toBeNull();
    expect((await store.get<import('../src/lib/mcp/credentials').McpCredential>(mcpUserPk(f.admin.id), credential.credential.id))?.doc.projectIds).toEqual([kept.id]);
    expect((await store.get<McpGrant>(grant.pk, grant.id))?.doc.access).toEqual({ kind: 'selected', workspaces: [{ workspaceId: 'w_elsewhere', projects: 'all' }] });

    // The other project is untouched
    expect((await comments.get(`project:${kept.id}`, keptThread.id))?.comment.thread.items[0]?.text).toBe('Stays');
    expect(await comments.getScreenshot(`project:${kept.id}`, keptThread.id)).not.toBeNull();
    expect(await store.get(keptPreference.pk, keptPreference.id)).not.toBeNull();
    expect(await findReviewProject(kept.publicId)).not.toBeNull();

    // Deletion intents were recorded like any thread delete, and discovery drops them: nothing is bound any more.
    // Scoped to this domain: other specs in the worker can leave more than a page of pending sources.
    const tombstones = async () => (await comments.listSyncPending({ after: `${domain}:`, limit: 1000 })).filter(source => source.domain === domain);
    expect((await tombstones()).map(source => 'type' in source ? source.type : 'comment')).toEqual(['tombstone', 'tombstone', 'tombstone']);
    expect(await discoverIntegrationSync({ comments: { ...comments, listSyncPending: tombstones } })).toEqual({ checked: 3, deferred: 0 });
    expect(await tombstones()).toEqual([]);

    const intent = (await store.get<ProjectDeletion>('project-deletion', doomed.id))?.doc;
    expect(intent).toMatchObject({ workspaceId: doomed.workspaceId, publicId: doomed.publicId, requestedBy: f.admin.id, complete: true, ttl: 86400 });
});

test('a partial failure leaves a durable intent that the scheduled sweep completes', async () => {
    const f = await fixture();
    const comments = getMemoryCommentsStore();
    const threads = [thread(f.doomed), thread(f.doomed)];
    for (const item of threads) await comments.create(item);
    let failures = 0;
    const failing: CommentsStore = { ...comments, async deleteWithTombstone() { failures++; throw new Error('Store unavailable'); } };

    // The project is gone once deletion starts, so the request reports success and the worker finishes
    await deleteProject(f.context, f.doomed.id, 'Old site', { comments: failing });
    expect(failures).toBeGreaterThan(0);
    expect(await getProject(f.doomed.workspaceId, f.doomed.id)).toBeNull();
    expect(await comments.listAll(`project:${f.doomed.id}`, 1000)).toHaveLength(2);
    expect((await f.store.get<ProjectDeletion>('project-deletion', f.doomed.id))?.doc).toMatchObject({ ttl: -1 });
    expect((await f.store.get<ProjectDeletion>('project-deletion', f.doomed.id))?.doc.complete).toBeUndefined();

    expect((await sweepProjectDeletions({ comments: failing })).failed).toBeGreaterThan(0);
    expect((await f.store.get<ProjectDeletion>('project-deletion', f.doomed.id))?.doc.complete).toBeUndefined();
    await sweepProjectDeletions({ comments });
    expect(await comments.listAll(`project:${f.doomed.id}`, 1000)).toEqual([]);
    expect((await f.store.get<ProjectDeletion>('project-deletion', f.doomed.id))?.doc).toMatchObject({ complete: true, ttl: 86400 });

    // A comment that a request in flight saved afterwards goes with the next run
    const late = thread(f.doomed, 'Late');
    await comments.create(late);
    await sweepProjectDeletions({ comments });
    expect(await comments.get(late.domain, late.id)).toBeNull();

    // A failure before the project is gone is reported, and a retry continues the same intent
    const g = await fixture();
    const unavailable = { ...g.store, async delete(pk: string, id: string) {
        if (pk === g.doomed.pk && id === g.doomed.id) throw new Error('Store unavailable');
        return g.store.delete(pk, id);
    } };
    await expect(deleteProject(g.context, g.doomed.id, 'Old site', { app: unavailable })).rejects.toThrow('Store unavailable');
    const requested = (await g.store.get<ProjectDeletion>('project-deletion', g.doomed.id))?.doc;
    expect(requested?.complete).toBeUndefined();
    await deleteProject(g.context, g.doomed.id, 'Old site');
    expect((await g.store.get<ProjectDeletion>('project-deletion', g.doomed.id))?.doc).toMatchObject({ requestedAt: requested!.requestedAt, complete: true });
});
