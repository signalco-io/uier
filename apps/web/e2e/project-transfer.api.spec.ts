import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore, type AppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { createWorkspace, ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { createProject, findProject, findReviewProject, getProject, getVisibleProject, listVisibleProjects, updateProject } from '../src/lib/app/projects';
import { projectByPublicId } from '../src/lib/app/projectPublicIds';
import { getClient, loadClients, setProjectClient, updateClient } from '../src/lib/app/clients';
import { getTeam, saveTeam, setTeamProjects } from '../src/lib/app/teams';
import { deleteProject } from '../src/lib/app/projectDeletion';
import {
    projectTransferPreview,
    projectTransferTargets,
    runProjectTransfer,
    settleProjectTransfer,
    sweepProjectTransfers,
    transferProject,
    type ProjectTransfer
} from '../src/lib/app/projectTransfer';
import { createMcpCredential, authenticateMcp, mcpProject, type McpCredential } from '../src/lib/mcp/credentials';
import { userPk as mcpUserPk } from '../src/lib/mcp/oauth/grants';
import { eventsPk as mcpEventsPk } from '../src/lib/mcp/events/subscriptions';
import { notificationPk } from '../src/lib/notifications/preferences';
import { memberActor } from '../src/lib/review/actor';
import { createWithScreenshot, screenshotInfo } from '../src/lib/comments/service';
import { parseScreenshot, type ParsedScreenshot } from '../src/lib/comments/screenshot';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { PUBLIC_PROJECT_ID, PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProjectPolicy';
import { parseActionInput } from '../src/lib/app/validation';
import { transferProjectActionSchema } from '../src/components/app/projects/actionSchemas';
import { describeAccessEvent } from '../src/components/app/teams/activityText';
import {
    memberId,
    projectRefPk,
    userPk,
    workspacePk,
    type AppDoc,
    type DbAccessEvent,
    type DbInvitation,
    type DbMember,
    type DbProject,
    type DbUser,
    type DbWorkspace
} from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import type { DbComment } from '../src/lib/db/schema';
import { pngImage } from './support/images';

test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
    process.env.UIER_COMMENTS_SECRET ??= 'project-transfer-local-test-secret';
});

const image = parseScreenshot(pngImage) as ParsedScreenshot;

function contextOf(user: DbUser, member: DbMember, workspace: DbWorkspace, memberships: AppContext['memberships']): AppContext {
    return { user, member, workspace, isAdmin: member.role === 'admin', memberships };
}

async function addMember(store: AppStore, workspace: DbWorkspace, prefix: string, role: DbMember['role'], projects: DbMember['projects']) {
    const user = await findOrCreateUser(`${prefix}-${randomUUID()}@example.com`);
    const member: DbMember = { type: 'member', id: memberId(user.id), pk: workspacePk(workspace.id), workspaceId: workspace.id, userId: user.id,
        email: user.email, role, projects, createdAt: new Date().toISOString() };
    await store.create(member);
    return { user, member, context: contextOf(user, member, workspace, [{ member, workspace }]) };
}

/** An admin of two workspaces with a project in the first, and people in both */
async function fixture() {
    const store = getAppStore();
    const admin = await findOrCreateUser(`transfer-admin-${randomUUID()}@example.com`);
    const sourceMember = await ensureOwnWorkspace(admin);
    const source = (await getWorkspace(sourceMember.workspaceId))!;
    const target = await createWorkspace(admin, 'Agency');
    const targetMember = (await store.get<DbMember>(workspacePk(target.id), memberId(admin.id)))!.doc;
    const memberships = [{ member: sourceMember, workspace: source }, { member: targetMember, workspace: target }];
    const context = contextOf(admin, sourceMember, source, memberships);
    const targetContext = contextOf(admin, targetMember, target, memberships);
    const project = await createProject(context, { name: 'Moving site', urls: ['https://moving.example'] });
    const kept = await createProject(context, { name: 'Kept site', urls: ['https://kept.example'] });
    const reviewer = await addMember(store, source, 'transfer-reviewer', 'commenter', [project.id, kept.id]);
    // In the new workspace: someone with every project, and someone with chosen projects only
    const everything = await addMember(store, target, 'transfer-all', 'commenter', 'all');
    const chosen = await addMember(store, target, 'transfer-chosen', 'commenter', []);
    return { store, admin, source, target, context, targetContext, project, kept, reviewer, everything, chosen };
}

function thread(project: DbProject, text = 'Feedback'): DbComment {
    return { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id, path: '/', origin: project.urls[0],
        position: { type: 'page' }, thread: { items: [{ id: `item_${randomUUID()}`, text }, { id: `item_${randomUUID()}`, text: 'A reply' }] },
        authorId: 'user:u_someone', createdAt: new Date().toISOString() };
}

const accessEvents = (store: AppStore, workspaceId: string, projectId: string) =>
    store.query<DbAccessEvent>({ type: 'access-event', pk: workspacePk(workspaceId), targetId: projectId });

test('only an admin of both workspaces transfers a project, by its exact name', async () => {
    const f = await fixture();
    const { project } = f;
    // A commenter of the project's workspace, even with a context that says admin
    await expect(transferProject(f.reviewer.context, project.id, f.target.id, project.name)).rejects.toThrow('Only workspace admins can transfer projects.');
    await expect(transferProject({ ...f.reviewer.context, isAdmin: true }, project.id, f.target.id, project.name))
        .rejects.toThrow('Only workspace admins can transfer projects.');
    // Not a member of the other workspace, or not its admin
    const stranger = await findOrCreateUser(`transfer-stranger-${randomUUID()}@example.com`);
    const elsewhere = await createWorkspace(stranger, 'Elsewhere');
    await expect(transferProject(f.context, project.id, elsewhere.id, project.name)).rejects.toThrow('Choose a workspace where you are an admin.');
    await expect(transferProject(f.context, project.id, 'w_missing', project.name)).rejects.toThrow('Choose a workspace where you are an admin.');
    const demoted = (await f.store.get<DbMember>(workspacePk(f.target.id), memberId(f.admin.id)))!;
    await f.store.replace({ ...demoted.doc, role: 'commenter', projects: 'all' }, demoted.etag);
    await expect(transferProject(f.context, project.id, f.target.id, project.name)).rejects.toThrow('Choose a workspace where you are an admin.');
    const restored = (await f.store.get<DbMember>(workspacePk(f.target.id), memberId(f.admin.id)))!;
    await f.store.replace({ ...restored.doc, role: 'admin' }, restored.etag);
    // The same workspace, the wrong name, another workspace's project
    await expect(transferProject(f.context, project.id, f.source.id, project.name)).rejects.toThrow('Choose another workspace.');
    for (const confirmation of ['', 'moving site', 'Moving', 'Kept site'])
        await expect(transferProject(f.context, project.id, f.target.id, confirmation)).rejects.toThrow('Type the project name exactly as it is shown.');
    const other = await fixture();
    for (const id of [project.id, project.publicId])
        await expect(transferProject(other.context, id, other.target.id, project.name)).rejects.toThrow('This project no longer exists.');
    // uier's public project and workspace never move, in either direction
    await expect(transferProject(f.context, PUBLIC_PROJECT_ID, f.target.id, 'uier')).rejects.toThrow('The public feedback project settings are managed by uier.');
    await expect(transferProject(f.context, project.id, PUBLIC_WORKSPACE_ID, project.name)).rejects.toThrow('Everyone joins the uier workspace automatically.');
    // The action accepts only well-formed ids
    for (const input of [{ projectId: project.id, workspaceId: 'x', confirmation: project.name },
        { projectId: 'not-a-project', workspaceId: f.target.id, confirmation: project.name },
        { projectId: project.id, workspaceId: f.target.id, confirmation: 'x'.repeat(1000) }])
        expect(() => parseActionInput(transferProjectActionSchema, input)).toThrow('Check the request and try again.');

    // Nothing moved
    expect((await findProject(project.id))?.workspaceId).toBe(f.source.id);
    expect(await getProject(f.target.id, project.id)).toBeNull();
    expect(await f.store.get('project-transfer', project.id)).toBeNull();

    // Surrounding whitespace is forgiven, as the dialog trims it
    await transferProject(f.context, project.id, f.target.id, '  Moving site ');
    expect((await findProject(project.id))?.workspaceId).toBe(f.target.id);
    await expect(transferProject(f.context, project.id, f.target.id, project.name)).rejects.toThrow('This project no longer exists.');
});

test('a transfer moves the comments, links and settings, leaves workspace access behind and changes who sees it', async () => {
    const f = await fixture();
    const { store, project, kept } = f;
    const comments = getMemoryCommentsStore();
    const domain = `project:${project.id}`;

    // Settings that move: review settings, environments and a client with its details
    await updateProject(f.source.id, project.id, { access: 'guests', brief: 'Check the menu', emailCommentExcerpts: true,
        environments: [{ origin: 'https://moving.example', label: 'Production' }] });
    await setProjectClient(f.context, project.id, 'Acme');
    const client = (await getProject(f.source.id, project.id))!.clientId!;
    await updateClient(f.context, client, { name: 'Acme', description: 'Restaurant group', icon: 'utensils', color: 'green' });

    // Comments with a reply, an image, numbers, read state and notification settings
    const threads = [thread(project), thread(project)];
    await createWithScreenshot(comments, { ...threads[0]!, screenshot: screenshotInfo(image) }, image);
    await comments.create(threads[1]!);
    await comments.nextCommentNumber(domain);
    const read = { type: 'review-read', pk: `review-read:${randomUUID()}`, id: threads[0]!.id, domain, reviewerId: `user:${f.admin.id}` };
    const preference = { type: 'notification-preference', pk: notificationPk(project.id), id: `preference_${randomUUID()}`, projectId: project.id, muted: true };
    for (const doc of [read, preference]) await store.create(doc);

    // Access given in this workspace: a team, a direct grant and invitations
    const teamId = await saveTeam(f.context, { name: 'Design' });
    await setTeamProjects(f.context, teamId, [project.id, kept.id]);
    const now = Date.now();
    const invitation = (projects: string[]): DbInvitation => ({ type: 'invitation', id: `invitation_${randomUUID()}`, pk: workspacePk(f.source.id),
        workspaceId: f.source.id, email: `invited-${randomUUID()}@example.com`, role: 'commenter', projects, projectId: project.id,
        invitedBy: f.admin.id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400_000).toISOString(),
        tokenHash: randomUUID().replaceAll('-', ''), ttl: 7 * 86400 });
    const only = invitation([project.id]);
    const both = invitation([project.id, kept.id]);
    for (const value of [only, both]) {
        await store.create(value);
        await store.create({ type: 'invitation-token', pk: `invitation:${value.tokenHash}`, id: value.tokenHash, workspaceId: value.workspaceId, invitationId: value.id, ttl: 7 * 86400 });
    }

    // Workspace-bound settings: a connected service with its ledger, coding tools, webhooks and an author filter
    const connection = { type: 'notion-connection', provider: 'notion', pk: project.pk, id: `notion_${project.id}`, workspaceId: f.source.id,
        projectId: project.id, connectedBy: f.admin.id, enabled: true, status: 'connected', destinationRevision: 1, config: {},
        grantId: `notion_grant_${project.id}`, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    const notionGrant = { type: 'notion-grant', provider: 'notion', pk: project.pk, id: `notion_grant_${project.id}`, workspaceId: f.source.id,
        projectId: project.id, connectedBy: f.admin.id, status: 'connected', generation: 1, tokens: { access: 'sealed' } };
    const ledger = { type: 'notion-sync', provider: 'notion', pk: `notion:${project.id}`, id: `notion_${randomUUID()}`, workspaceId: f.source.id,
        connectionId: connection.id, projectId: project.id, threadId: threads[0]!.id, active: true, status: 'accepted', state: { pageId: 'page' } };
    const eventSubscription = { type: 'mcp-event-subscription', pk: mcpEventsPk(project.id), id: `sub_${'b'.repeat(32)}`, projectId: project.id,
        workspaceId: f.source.id, url: 'https://hooks.example.com/uier', secret: 'v1.e1.sealed' };
    const authorFilter = { type: 'comment-author', pk: workspacePk(f.source.id), id: `comment-author_${randomUUID()}`, projectId: project.id,
        userId: f.admin.id, authorId: 'user:u_someone', name: 'Someone', expiresAt: new Date(now + 86400_000).toISOString(), ttl: 86400 };
    for (const doc of [connection, notionGrant, ledger, eventSubscription, authorFilter]) await store.create(doc);
    const stored = (await store.get<DbProject>(project.pk, project.id))!;
    await store.replace({ ...stored.doc, integrations: { notion: { connectionId: connection.id, since: new Date(now).toISOString() } } }, stored.etag);
    const both_ = await createMcpCredential(f.context, { name: 'Both', projectIds: [project.id, kept.id], scopes: ['feedback:read'], days: 30 });
    const alone = await createMcpCredential(f.context, { name: 'Alone', projectIds: [project.id], scopes: ['feedback:read'], days: 30 });
    const identity = await authenticateMcp(new Request('http://127.0.0.1', { headers: { authorization: `Bearer ${both_.token}` } }));
    expect((await mcpProject(identity, project.id)).project.id).toBe(project.id);

    // The confirmation lists what stays behind (everyone else here loses access, also with all projects);
    // the workspace menu offers the other workspace
    const allHere = await addMember(store, f.source, 'transfer-all-source', 'commenter', 'all');
    expect(await projectTransferPreview((await getProject(f.source.id, project.id))!, f.admin.id)).toEqual({
        integrations: ['Notion'], people: 2, teams: 1, invitations: 2, client: 'Acme' });
    expect(projectTransferTargets(f.context)).toEqual([{ id: f.target.id, name: 'Agency' }]);
    expect(projectTransferTargets(f.reviewer.context)).toEqual([]);

    await transferProject(f.context, project.id, f.target.id, project.name);

    // The same project, ids and links, now in the other workspace
    expect(await getProject(f.source.id, project.id)).toBeNull();
    const moved = (await getProject(f.target.id, project.id))!;
    expect(moved).toMatchObject({ id: project.id, publicId: project.publicId, workspaceId: f.target.id, pk: workspacePk(f.target.id),
        name: 'Moving site', urls: ['https://moving.example'], access: 'guests', brief: 'Check the menu', emailCommentExcerpts: true,
        environments: [{ origin: 'https://moving.example', label: 'Production' }], createdAt: project.createdAt, createdBy: project.createdBy });
    expect(moved.integrations).toBeUndefined();
    expect(moved.transfer).toBeUndefined();
    for (const id of [project.id, project.publicId]) {
        expect((await findReviewProject(id))?.workspaceId).toBe(f.target.id);
        expect((await getProject(f.target.id, id))?.id).toBe(project.id);
        expect(await getProject(f.source.id, id)).toBeNull();
    }
    expect((await findProject(project.id))?.workspaceId).toBe(f.target.id);
    expect((await projectByPublicId(project.publicId))?.workspaceId).toBe(f.target.id);

    // Its client follows by name, with its details; the old workspace keeps its own client
    const movedClient = (await getClient(f.target.id, moved.clientId!))!.doc;
    expect(movedClient).toMatchObject({ name: 'Acme', description: 'Restaurant group', icon: 'utensils', color: 'green', workspaceId: f.target.id });
    expect((await loadClients(f.source.id)).get(client)?.name).toBe('Acme');

    // Comments, replies, the image, numbers, read state and notification settings did not move at all
    const saved = await comments.listAll(domain, 1000);
    expect(saved.map(item => item.id).sort()).toEqual(threads.map(item => item.id).sort());
    expect((await comments.get(domain, threads[0]!.id))?.comment.thread.items.map(item => item.text)).toEqual(['Feedback', 'A reply']);
    expect(await comments.getScreenshot(domain, threads[0]!.id)).not.toBeNull();
    expect(await comments.nextCommentNumber(domain)).toBe(2);
    for (const doc of [read, preference]) expect(await store.get(doc.pk, doc.id), doc.type).not.toBeNull();

    // Who sees it: the new workspace's admins and people with every project; nobody through the old workspace
    expect(await getVisibleProject(f.targetContext, project.id)).not.toBeNull();
    expect(await getVisibleProject(f.everything.context, project.id)).not.toBeNull();
    expect(await getVisibleProject(f.chosen.context, project.id)).toBeNull();
    expect((await listVisibleProjects(f.reviewer.context)).map(item => item.id)).toEqual([kept.id]);
    expect(await getVisibleProject(f.context, project.id)).toBeNull();
    expect(await memberActor(moved, f.admin.id)).toMatchObject({ kind: 'member', isAdmin: true });
    expect(await memberActor(moved, f.everything.user.id)).toMatchObject({ kind: 'member' });
    expect(await memberActor(moved, f.chosen.user.id)).toBeNull();
    expect(await memberActor(moved, f.reviewer.user.id)).toBeNull();
    expect(await memberActor(moved, allHere.user.id)).toBeNull();

    // The access it had in the old workspace is gone; the other project keeps its access
    expect((await getTeam(f.source.id, teamId))?.doc.projectIds).toEqual([kept.id]);
    expect((await store.get<DbMember>(workspacePk(f.source.id), f.reviewer.member.id))?.doc.projects).toEqual([kept.id]);
    expect(await store.get(workspacePk(f.source.id), only.id)).toBeNull();
    expect(await store.get(`invitation:${only.tokenHash}`, only.tokenHash)).toBeNull();
    expect((await store.get<DbInvitation>(workspacePk(f.source.id), both.id))?.doc.projects).toEqual([kept.id]);

    // Workspace-bound settings stay behind: the service, its records, coding tools and webhooks
    for (const doc of [connection, notionGrant, ledger, eventSubscription, authorFilter])
        expect(await store.get(doc.pk, doc.id), doc.type).toBeNull();
    await expect(mcpProject(identity, project.id)).rejects.toThrow();
    expect((await mcpProject(identity, kept.id)).project.id).toBe(kept.id);
    expect(await store.get<McpCredential>(mcpUserPk(f.admin.id), alone.credential.id)).toBeNull();
    expect((await store.get<McpCredential>(mcpUserPk(f.admin.id), both_.credential.id))?.doc.projectIds).toEqual([kept.id]);

    // Both workspaces' activity says what happened, by name
    const names = { people: new Map([[f.admin.id, 'Admin']]), invitations: new Map<string, string>(), teams: new Map<string, string>(), projects: new Map<string, string>() };
    const out = (await accessEvents(store, f.source.id, project.id)).find(event => event.action === 'project.transferred-out')!;
    const into = (await accessEvents(store, f.target.id, project.id)).find(event => event.action === 'project.transferred-in')!;
    expect(describeAccessEvent(out, names).text).toBe('transferred Moving site to another workspace');
    expect(describeAccessEvent(into, names).text).toBe('transferred Moving site to this workspace');
    expect(out.actorId).toBe(f.admin.id);
    expect(JSON.stringify([out, into])).not.toContain(f.target.name);

    const intent = (await store.get<ProjectTransfer>('project-transfer', project.id))?.doc;
    expect(intent).toMatchObject({ fromWorkspaceId: f.source.id, toWorkspaceId: f.target.id, requestedBy: f.admin.id, complete: true, ttl: 86400 });

    // It can move back; the access it had there before does not return with it
    await transferProject(f.targetContext, project.id, f.source.id, project.name);
    expect((await findProject(project.id))?.workspaceId).toBe(f.source.id);
    expect(await getProject(f.target.id, project.id)).toBeNull();
    const back = (await getProject(f.source.id, project.id))!;
    expect(await memberActor(back, f.reviewer.user.id)).toBeNull();
    expect(await memberActor(back, f.admin.id)).toMatchObject({ kind: 'member', isAdmin: true });
    expect(back.clientId).toBe(client);
});

test('a client of the same name in the new workspace is used, and no client stays without one', async () => {
    const f = await fixture();
    const existing = await createProject(f.targetContext, { name: 'There', urls: ['https://there.example'], clientName: 'Acme' });
    await setProjectClient(f.context, f.project.id, 'Acme');
    await transferProject(f.context, f.project.id, f.target.id, f.project.name);
    expect((await getProject(f.target.id, f.project.id))?.clientId).toBe(existing.clientId);
    expect([...(await loadClients(f.target.id)).values()].map(client => client.name)).toEqual(['Acme']);

    const plain = await createProject(f.context, { name: 'Plain', urls: ['https://plain.example'] });
    await transferProject(f.context, plain.id, f.target.id, 'Plain');
    expect((await getProject(f.target.id, plain.id))?.clientId).toBeUndefined();
});

test('an interrupted transfer never shows the project in the wrong workspace, and the sweep finishes it', async () => {
    const f = await fixture();
    const { store, project } = f;
    const team = await saveTeam(f.context, { name: 'Design' });
    await setTeamProjects(f.context, team, [project.id]);
    const sees = async (context: AppContext) => Boolean(await getVisibleProject(context, project.id))
        || (await listVisibleProjects(context)).some(item => item.id === project.id);

    // Interrupted after the copy, before the project code moved: only the old workspace has the project
    const codeFails: AppStore = { ...store, async replace(doc, etag) {
        if (doc.pk === projectRefPk(project.id)) throw new Error('Store unavailable');
        return store.replace(doc, etag);
    } };
    await expect(transferProject(f.context, project.id, f.target.id, project.name, codeFails)).rejects.toThrow('Store unavailable');
    expect(await store.get(workspacePk(f.target.id), project.id)).not.toBeNull();
    expect((await findProject(project.id))?.workspaceId).toBe(f.source.id);
    // Its public id already names the new workspace, and still opens the project where the code is
    expect((await findReviewProject(project.publicId))?.workspaceId).toBe(f.source.id);
    expect(await sees(f.reviewer.context)).toBe(true);
    for (const context of [f.targetContext, f.everything.context])
        expect(await sees(context)).toBe(false);
    expect(await getProject(f.target.id, project.id)).toBeNull();
    expect(await getProject(f.target.id, project.publicId)).toBeNull();
    await expect(createMcpCredential(f.targetContext, { name: 'Early', projectIds: [project.id], scopes: ['feedback:read'], days: 30 }))
        .rejects.toThrow('Choose projects you can access.');
    await expect(setTeamProjects(f.targetContext, await saveTeam(f.targetContext, { name: 'Early' }), [project.id]))
        .rejects.toThrow('A selected project is unavailable.');
    // Meanwhile nobody can send it elsewhere or delete it
    const third = await createWorkspace(f.admin, 'Third');
    await expect(transferProject(f.context, project.id, third.id, project.name)).rejects.toThrow('This project is being transferred to another workspace.');
    await expect(deleteProject(f.context, project.id, project.name)).rejects.toThrow('This project is being transferred to another workspace.');

    // Retried, and interrupted after the code moved, before the old copy went: only the new workspace has it
    const copyStays: AppStore = { ...store, async transact(operations) {
        if (operations.some(operation => operation.kind === 'delete' && operation.id === project.id)) throw new Error('Store unavailable');
        return store.transact(operations);
    } };
    await expect(transferProject(f.context, project.id, f.target.id, project.name, copyStays)).rejects.toThrow('Store unavailable');
    expect(await store.get(workspacePk(f.source.id), project.id)).not.toBeNull();
    expect((await findProject(project.id))?.workspaceId).toBe(f.target.id);
    expect((await findReviewProject(project.publicId))?.workspaceId).toBe(f.target.id);
    // The old workspace's commenter (still granted there) and admin get nothing: no page, list, token or review access
    for (const context of [f.reviewer.context, f.context])
        expect(await sees(context)).toBe(false);
    expect(await getProject(f.source.id, project.id)).toBeNull();
    for (const context of [f.reviewer.context, f.context])
        await expect(createMcpCredential(context, { name: 'Late', projectIds: [project.id], scopes: ['feedback:read'], days: 30 }))
            .rejects.toThrow('Choose projects you can access.');
    expect(await memberActor((await findProject(project.id))!, f.reviewer.user.id)).toBeNull();
    for (const context of [f.targetContext, f.everything.context])
        expect(await sees(context)).toBe(true);
    // The copy left behind cannot be deleted or sent elsewhere from there
    await expect(transferProject(f.context, project.id, third.id, project.name)).rejects.toThrow('This project no longer exists.');

    // The scheduled sweep finishes it: the old copy and its access go, the new one is a plain project
    expect(await sweepProjectTransfers()).toEqual({ failed: 0 });
    expect(await store.get(workspacePk(f.source.id), project.id)).toBeNull();
    expect((await getProject(f.target.id, project.id))?.transfer).toBeUndefined();
    expect((await getTeam(f.source.id, team))?.doc.projectIds).toEqual([]);
    const done = (await store.get<ProjectTransfer>('project-transfer', project.id))!.doc;
    expect(done).toMatchObject({ complete: true, ttl: 86400 });
    expect(done.abandoned).toBeUndefined();
    await expect(deleteProject(f.context, project.id, project.name)).rejects.toThrow('This project no longer exists.');
    // Running a completed transfer again changes nothing
    await runProjectTransfer(done, f.admin.id);
    expect((await getProject(f.target.id, project.id))?.id).toBe(project.id);
});

test('a transfer interrupted before the switch is given up later, and the project stays where it was', async () => {
    const f = await fixture();
    const { store, project } = f;
    const third = await createWorkspace(f.admin, 'Third');
    const codeFails: AppStore = { ...store, async replace(doc, etag) {
        if (doc.pk === projectRefPk(project.id)) throw new Error('Store unavailable');
        return store.replace(doc, etag);
    } };
    await expect(transferProject(f.context, project.id, f.target.id, project.name, codeFails)).rejects.toThrow('Store unavailable');
    // While the request could still be running, the sweep leaves it alone
    await sweepProjectTransfers();
    expect(await store.get(workspacePk(f.target.id), project.id)).not.toBeNull();

    // Long after the request ended, the sweep gives it up: the copy there goes, links and the project stay here
    const pending = (await store.get<ProjectTransfer>('project-transfer', project.id))!;
    await store.replace({ ...pending.doc, requestedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }, pending.etag);
    expect(await sweepProjectTransfers()).toEqual({ failed: 0 });
    expect(await store.get(workspacePk(f.target.id), project.id)).toBeNull();
    const here = (await getProject(f.source.id, project.id))!;
    expect(here.transfer).toBeUndefined();
    expect((await projectByPublicId(project.publicId))?.workspaceId).toBe(f.source.id);
    expect(await getVisibleProject(f.reviewer.context, project.id)).not.toBeNull();
    expect((await store.get<ProjectTransfer>('project-transfer', project.id))?.doc).toMatchObject({ complete: true, abandoned: true });
    const names = { people: new Map<string, string>(), invitations: new Map<string, string>(), teams: new Map<string, string>(), projects: new Map<string, string>() };
    const ended = (await accessEvents(store, f.target.id, project.id)).find(event => event.action === 'project.transfer-abandoned')!;
    expect(describeAccessEvent(ended, names).text).toBe('ended an unfinished transfer of Moving site');

    // A new transfer elsewhere goes through
    await transferProject(f.context, project.id, third.id, project.name);
    expect((await findProject(project.id))?.workspaceId).toBe(third.id);
    expect((await projectByPublicId(project.publicId))?.workspaceId).toBe(third.id);
    expect(await store.get(workspacePk(f.source.id), project.id)).toBeNull();
});

test('an interrupted transfer that a new one replaces is given up first', async () => {
    const f = await fixture();
    const { store, project } = f;
    const third = await createWorkspace(f.admin, 'Third');
    const codeFails: AppStore = { ...store, async replace(doc, etag) {
        if (doc.pk === projectRefPk(project.id)) throw new Error('Store unavailable');
        return store.replace(doc, etag);
    } };
    await expect(transferProject(f.context, project.id, f.target.id, project.name, codeFails)).rejects.toThrow('Store unavailable');
    const pending = (await store.get<ProjectTransfer>('project-transfer', project.id))!;
    await store.replace({ ...pending.doc, requestedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }, pending.etag);
    await transferProject(f.context, project.id, third.id, project.name);
    expect((await findProject(project.id))?.workspaceId).toBe(third.id);
    expect(await store.get(workspacePk(f.target.id), project.id)).toBeNull();
    expect(await store.get(workspacePk(f.source.id), project.id)).toBeNull();
});

/** An interrupted transfer to the fixture's target, as if its request ended an hour ago */
async function interruptedLongAgo(f: Awaited<ReturnType<typeof fixture>>) {
    const { store, project } = f;
    const codeFails: AppStore = { ...store, async replace(doc, etag) {
        if (doc.pk === projectRefPk(project.id)) throw new Error('Store unavailable');
        return store.replace(doc, etag);
    } };
    await expect(transferProject(f.context, project.id, f.target.id, project.name, codeFails)).rejects.toThrow('Store unavailable');
    await age(store, project.id);
}

async function age(store: AppStore, projectId: string) {
    const pending = (await store.get<ProjectTransfer>('project-transfer', projectId))!;
    await store.replace({ ...pending.doc, requestedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }, pending.etag);
}

test('a retry of an old interrupted transfer runs as a new request, so the sweep leaves it alone', async () => {
    const f = await fixture();
    const { store, project } = f;
    await interruptedLongAgo(f);
    // The sweep runs while the retry is about to switch the code
    let swept = false;
    const sweepMidway: AppStore = { ...store, async replace(doc, etag) {
        if (doc.pk === projectRefPk(project.id) && !swept) {
            swept = true;
            expect(await sweepProjectTransfers(store)).toEqual({ failed: 0 });
        }
        return store.replace(doc, etag);
    } };
    await transferProject(f.context, project.id, f.target.id, project.name, sweepMidway);
    expect(swept).toBe(true);
    expect((await findProject(project.id))?.workspaceId).toBe(f.target.id);
    expect((await projectByPublicId(project.publicId))?.workspaceId).toBe(f.target.id);
    expect((await store.get<ProjectTransfer>('project-transfer', project.id))?.doc).toMatchObject({ complete: true });
    expect((await store.get<ProjectTransfer>('project-transfer', project.id))?.doc.abandoned).toBeUndefined();
});

test('a run that a give-up overtakes stops before it points review links at the new workspace', async () => {
    const f = await fixture();
    const { store, project } = f;
    await interruptedLongAgo(f);
    // The retry is given up while it removes coding tool access (its own lease made old again)
    let overtaken = false;
    const giveUpMidway: AppStore = { ...store, async query(query) {
        if (query.type === 'mcp-credential' && !overtaken) {
            overtaken = true;
            await age(store, project.id);
            const pending = (await store.get<ProjectTransfer>('project-transfer', project.id))!.doc;
            expect(await settleProjectTransfer(pending, f.admin.id, store)).toBe(true);
        }
        return store.query(query);
    } };
    await expect(transferProject(f.context, project.id, f.target.id, project.name, giveUpMidway))
        .rejects.toThrow('The transfer was stopped before it finished. Try again.');
    expect(overtaken).toBe(true);
    expect((await findProject(project.id))?.workspaceId).toBe(f.source.id);
    expect((await projectByPublicId(project.publicId))?.workspaceId).toBe(f.source.id);
    expect(await store.get(workspacePk(f.target.id), project.id)).toBeNull();
    expect((await getProject(f.source.id, project.id))?.transfer).toBeUndefined();
    expect((await store.get<ProjectTransfer>('project-transfer', project.id))?.doc).toMatchObject({ complete: true, abandoned: true });
    // Even a public id left naming a workspace without the project opens it where its code is
    const ref = (await store.get<AppDoc & { workspaceId: string }>(`project-public:${project.publicId}`, project.publicId))!;
    await store.replace({ ...ref.doc, workspaceId: f.target.id }, ref.etag);
    expect((await findReviewProject(project.publicId))?.workspaceId).toBe(f.source.id);
    // A new attempt goes through
    await transferProject(f.context, project.id, f.target.id, project.name);
    expect((await findProject(project.id))?.workspaceId).toBe(f.target.id);
});

test('the sweep settles a transfer whose requester\'s account is gone, as uier', async () => {
    const f = await fixture();
    const { store, project } = f;
    const copyStays: AppStore = { ...store, async transact(operations) {
        if (operations.some(operation => operation.kind === 'delete' && operation.id === project.id)) throw new Error('Store unavailable');
        return store.transact(operations);
    } };
    await expect(transferProject(f.context, project.id, f.target.id, project.name, copyStays)).rejects.toThrow('Store unavailable');
    // A second project's transfer is given up in the same run
    const other = await createProject(f.context, { name: 'Second site', urls: ['https://second.example'] });
    const codeFails: AppStore = { ...store, async replace(doc, etag) {
        if (doc.pk === projectRefPk(other.id)) throw new Error('Store unavailable');
        return store.replace(doc, etag);
    } };
    await expect(transferProject(f.context, other.id, f.target.id, other.name, codeFails)).rejects.toThrow('Store unavailable');
    await age(store, other.id);
    await store.delete(userPk(f.admin.id), f.admin.id);

    expect(await sweepProjectTransfers()).toEqual({ failed: 0 });
    expect(await store.get(workspacePk(f.source.id), project.id)).toBeNull();
    expect((await getProject(f.target.id, project.id))?.transfer).toBeUndefined();
    expect(await store.get(workspacePk(f.target.id), other.id)).toBeNull();
    expect((await getProject(f.source.id, other.id))?.transfer).toBeUndefined();
    for (const id of [project.id, other.id])
        expect((await store.get<ProjectTransfer>('project-transfer', id))?.doc.complete).toBe(true);
    const names = { people: new Map<string, string>(), invitations: new Map<string, string>(), teams: new Map<string, string>(), projects: new Map<string, string>() };
    const out = (await accessEvents(store, f.source.id, project.id)).find(event => event.action === 'project.transferred-out')!;
    expect(out.actorId).toBe('system');
    expect(describeAccessEvent(out, names)).toMatchObject({ actor: 'uier', text: 'transferred Moving site to another workspace' });
});
