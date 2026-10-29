import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAppStore, createCosmosAppStore, createMemoryAppStore, type AppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getMember, getWorkspace } from '../src/lib/app/workspaces';
import { createProject, listVisibleProjects } from '../src/lib/app/projects';
import { hasProjectAccess, loadWorkspaceAccess, projectAccessSources } from '../src/lib/app/access';
import {
    bulkTeamMembership,
    changeTeamState,
    getTeam,
    removeAllProjectMemberAccess,
    saveTeam,
    setTeamProjects,
    updateMemberAccess
} from '../src/lib/app/teams';
import { memberActor, resolveActor, REVIEW_TOKEN_TTL_SECONDS } from '../src/lib/review/actor';
import {
    createProjectComment,
    getProjectComment,
    replyToProjectComment,
    setProjectCommentAssignee,
    setProjectCommentPrivate
} from '../src/lib/review/comments';
import { markProjectThreadsRead } from '../src/lib/review/bulkRead';
import { participantNames } from '../src/lib/review/dto';
import { createMcpCredential, authenticateMcp, mcpProject } from '../src/lib/mcp/credentials';
import { acceptInvitation, getInvitation, removeMember } from '../src/lib/app/invitations';
import {
    discoverThreadNotifications,
    processNotificationDelivery,
    type NotificationDelivery
} from '../src/lib/notifications/delivery';
import { notificationPk } from '../src/lib/notifications/preferences';
import { signToken, randomToken, sha256Hex } from '../src/lib/app/tokens';
import {
    memberId,
    workspacePk,
    type DbMember,
    type DbTeam,
    type DbInvitation,
    type DbInvitationToken,
    type DbAccessEvent
} from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProjectPolicy';
import { parseActionInput } from '../src/lib/app/validation';
import {
    bulkTeamsActionSchema,
    memberAccessActionSchema,
    projectTeamActionSchema,
    teamProjectsActionSchema,
    teamStateActionSchema
} from '../src/components/app/teams/actionSchemas';

test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
    process.env.UIER_COMMENTS_SECRET ??= 'teams-local-test-secret-for-authorization-only';
});

async function fixture() {
    const admin = await findOrCreateUser(`teams-admin-${randomUUID()}@example.com`),
        member = await ensureOwnWorkspace(admin);
    const workspace = (await getWorkspace(member.workspaceId))!;
    const context: AppContext = { user: admin, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
    const a = await createProject(context, { name: 'Alpha', urls: ['https://alpha.example'] }),
        b = await createProject(context, { name: 'Beta', urls: ['https://beta.example'] });
    const user = await findOrCreateUser(`teams-external-${randomUUID()}@example.com`);
    const person: DbMember = {
        ...member,
        id: memberId(user.id),
        userId: user.id,
        email: user.email,
        role: 'commenter',
        projects: [],
        relationship: 'external'
    };
    await getAppStore().create(person);
    const design = await saveTeam(context, { name: 'Design' }),
        qa = await saveTeam(context, { name: 'QA' });
    await setTeamProjects(context, design, [a.id, b.id]);
    await setTeamProjects(context, qa, [a.id]);
    return { context, user, person, a, b, design, qa, store: getAppStore() };
}

async function invitation(f: Awaited<ReturnType<typeof fixture>>, overrides: Partial<DbInvitation> = {}) {
    const token = randomToken(),
        tokenHash = sha256Hex(token);
    const doc: DbInvitation = {
        type: 'invitation',
        id: `invitation_${randomUUID()}`,
        pk: f.context.workspace.pk,
        workspaceId: f.context.workspace.id,
        email: f.user.email,
        invitedBy: f.context.user.id,
        role: 'commenter',
        projects: [],
        teamIds: [f.design],
        tokenHash,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        ...overrides
    };
    await f.store.create(doc);
    await f.store.create<DbInvitationToken>({
        type: 'invitation-token',
        id: tokenHash,
        pk: `invitation:${tokenHash}`,
        workspaceId: doc.workspaceId,
        invitationId: doc.id,
        ttl: 86_400
    });
    return token;
}

test('team action schemas reject forged positional values before selectors or booleans are used', () => {
    const teamId = `team_${'t'.repeat(21)}`;
    const cases = [
        [teamProjectsActionSchema, { id: teamId, projects: ['abcdef123456'], revision: 1 }],
        [teamStateActionSchema, { id: teamId, state: 'archived', revision: 1 }],
        [memberAccessActionSchema, { userId: 'u_member', update: { projects: [], teamIds: [] }, revision: 1 }],
        [projectTeamActionSchema, { teamId, projectId: 'abcdef123456', add: false, revision: 1 }],
        [bulkTeamsActionSchema, { userIds: ['u_member'], teamIds: [teamId], mode: 'add', revision: 1 }]
    ] as const;
    for (const [schema, valid] of cases) {
        expect(parseActionInput(schema, valid)).toEqual(valid);
        for (const field of Object.keys(valid))
            for (const value of [{}, null])
                expect(() => parseActionInput(schema, { ...valid, [field]: value })).toThrow('Check the request');
    }
});

test('effective grants are additive, workspace scoped and backward compatible', async () => {
    const f = await fixture(),
        access = await loadWorkspaceAccess(f.context.workspace.id);
    const can = (change: Partial<DbMember>) => hasProjectAccess(access, { ...f.person, ...change }, f.a);
    expect(can({})).toBe(false);
    expect(can({ projects: [f.a.id] })).toBe(true);
    expect(can({ teamIds: [f.design] })).toBe(true);
    expect(can({ teamIds: [f.design, f.qa] })).toBe(true);
    expect(can({ projects: [f.a.id], teamIds: [f.design] })).toBe(true);
    expect(can({ projects: 'all' })).toBe(true);
    expect(can({ role: 'admin' })).toBe(true);
    expect(can({ teamIds: ['team_unknown'] })).toBe(false);
    expect(can({ workspaceId: 'foreign', role: 'admin' })).toBe(false);
    expect(projectAccessSources(access, { ...f.person, projects: [f.a.id], teamIds: [f.design, f.qa] }, f.a)).toEqual([
        'Direct access',
        'Via Design',
        'Via QA'
    ]);
    await updateMemberAccess(f.context, f.user.id, {
        projects: [],
        teamIds: [f.design, f.qa],
        relationship: 'external'
    });
    await bulkTeamMembership(
        f.context,
        [f.user.id],
        [f.design],
        'remove',
        (await getWorkspace(f.context.workspace.id))!.accessRevision!
    );
    expect((await getMember(f.context.workspace.id, f.user.id))?.projects).toEqual([]);
    expect(await memberActor(f.a, f.user.id)).toMatchObject({ kind: 'member', isAdmin: false });
    expect(await memberActor(f.b, f.user.id)).toBeNull();
    await changeTeamState(f.context, f.qa, 'archived');
    expect(await memberActor(f.a, f.user.id)).toBeNull();
    await changeTeamState(f.context, f.qa, 'active');
    expect((await getTeam(f.context.workspace.id, f.qa))?.doc.projectIds).toEqual([]);
    expect(await memberActor(f.a, f.user.id)).toBeNull();
});

test('team-only app, token, participant, read, private-thread and MCP boundaries revoke without token expiry', async () => {
    const f = await fixture();
    await updateMemberAccess(f.context, f.user.id, { projects: [], teamIds: [f.design] });
    const person = (await getMember(f.context.workspace.id, f.user.id))!;
    const context = { ...f.context, user: f.user, member: person, isAdmin: false };
    expect((await listVisibleProjects(context)).map((project) => project.id).sort()).toEqual([f.a.id, f.b.id].sort());
    const actor = (await memberActor(f.a, f.user.id))!,
        owner = (await memberActor(f.a, f.context.user.id))!;
    const privateComment = await createProjectComment(new Request('http://127.0.0.1'), f.a, owner, {
        text: 'Private evidence',
        origin: f.a.urls[0]!,
        path: '/',
        kind: 'feedback',
        position: { type: 'page' }
    });
    await setProjectCommentPrivate(f.a, owner, privateComment.id, true);
    await expect(getProjectComment(f.a, actor, privateComment.id)).rejects.toMatchObject({ status: 404 });
    expect((await participantNames(f.a)).has(f.user.id)).toBe(true);
    const comment = await createProjectComment(new Request('http://127.0.0.1'), f.a, actor, {
        text: 'Team feedback',
        origin: f.a.urls[0]!,
        path: '/',
        kind: 'feedback',
        position: { type: 'page' }
    });
    await markProjectThreadsRead(f.a, actor, { threads: [{ id: comment.id, sequence: 1 }] });
    const token = signToken('review', { uid: f.user.id, pid: f.a.id }, REVIEW_TOKEN_TTL_SECONDS);
    const request = new Request('http://127.0.0.1', { headers: { authorization: `Bearer ${token}` } });
    expect(await resolveActor(request, f.a)).toMatchObject({ kind: 'member' });
    const credential = await createMcpCredential(context, {
        name: 'Alpha only',
        projectIds: [f.a.id],
        scopes: ['feedback:read'],
        days: 30
    });
    const identity = (await authenticateMcp(
        new Request('http://127.0.0.1', { headers: { authorization: `Bearer ${credential.token}` } })
    ))!;
    expect((await mcpProject(identity, f.a.id)).project.id).toBe(f.a.id);
    await expect(mcpProject(identity, f.b.id)).rejects.toThrow();
    await updateMemberAccess(f.context, f.user.id, { projects: [], teamIds: [] });
    expect(await resolveActor(request, f.a)).toEqual({ kind: 'anonymous' });
    expect((await participantNames(f.a)).has(f.user.id)).toBe(false);
    await expect(
        replyToProjectComment(new Request('http://127.0.0.1'), f.a, actor, comment.id, { text: 'Stale actor' })
    ).rejects.toThrow();
    await expect(markProjectThreadsRead(f.a, actor, { threads: [{ id: comment.id, sequence: 1 }] })).rejects.toThrow();
    await expect(setProjectCommentAssignee(f.a, owner, comment.id, f.user.id)).rejects.toThrow();
    await expect(mcpProject(identity, f.a.id)).rejects.toThrow();
});

test('concurrent normalized names, membership changes and offboarding cannot lose or recreate access', async () => {
    const f = await fixture();
    const names = await Promise.allSettled([' Sales ', 'sales', 'SALES'].map((name) => saveTeam(f.context, { name })));
    expect(names.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const renames = await Promise.allSettled([
        saveTeam(f.context, { id: f.design, name: 'Shared' }),
        saveTeam(f.context, { id: f.qa, name: 'shared' })
    ]);
    expect(renames.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await updateMemberAccess(f.context, f.user.id, { projects: [f.b.id], teamIds: [] });
    const revision = (await getWorkspace(f.context.workspace.id))!.accessRevision!;
    const updates = await Promise.all([
        bulkTeamMembership(f.context, [f.user.id], [f.design], 'add', revision),
        bulkTeamMembership(f.context, [f.user.id], [f.qa], 'add', revision)
    ]);
    expect(updates.flat().filter((result) => result.ok)).toHaveLength(1);
    expect((await getMember(f.context.workspace.id, f.user.id))?.projects).toEqual([f.b.id]);
    await Promise.allSettled([
        removeMember(f.context, f.user.id),
        bulkTeamMembership(
            f.context,
            [f.user.id],
            [f.qa],
            'add',
            (await getWorkspace(f.context.workspace.id))!.accessRevision!
        )
    ]);
    expect(await getMember(f.context.workspace.id, f.user.id)).toBeNull();
    expect(await memberActor(f.a, f.user.id)).toBeNull();
});

test('invitation acceptance is single-use, additive and uses current teams; archive and offboarding invalidate old links', async () => {
    const f = await fixture();
    await updateMemberAccess(f.context, f.user.id, { projects: [f.b.id], teamIds: [f.qa] });
    const token = await invitation(f);
    const results = await Promise.all([acceptInvitation(token), acceptInvitation(token)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await getMember(f.context.workspace.id, f.user.id)).toMatchObject({
        projects: [f.b.id],
        teamIds: expect.arrayContaining([f.qa, f.design]),
        role: 'commenter'
    });
    const archived = await invitation(f);
    await changeTeamState(f.context, f.design, 'archived');
    expect(await getInvitation(archived)).toBeNull();
    await changeTeamState(f.context, f.design, 'active');
    expect(await getInvitation(archived)).toBeNull();
    const removed = await invitation(f, { teamIds: [], projects: [f.a.id] });
    await removeMember(f.context, f.user.id);
    expect(await acceptInvitation(removed)).toBeNull();
    expect(await getMember(f.context.workspace.id, f.user.id)).toBeNull();
    const replacement = await invitation(f, { teamIds: [f.qa], recipientGeneration: 1 });
    expect(await acceptInvitation(replacement)).toBeTruthy();
    expect((await getMember(f.context.workspace.id, f.user.id))?.teamIds).toEqual([f.qa]);
});

test('archived memberships remain referenced when relationship or direct grants change', async () => {
    const f = await fixture();
    await updateMemberAccess(f.context, f.user.id, { projects: [], teamIds: [f.design] });
    await changeTeamState(f.context, f.design, 'archived');
    await updateMemberAccess(f.context, f.user.id, {
        projects: [f.a.id],
        teamIds: [f.design],
        relationship: 'internal'
    });
    expect(await getMember(f.context.workspace.id, f.user.id)).toMatchObject({
        teamIds: [f.design],
        relationship: 'internal'
    });
    await changeTeamState(f.context, f.design, 'active');
    expect(await memberActor(f.b, f.user.id)).toBeNull();
});

test('issuing-admin removal and an archive racing acceptance cannot activate stale team grants', async () => {
    const f = await fixture();
    const issuer = await findOrCreateUser(`issuer-${randomUUID()}@example.com`);
    await f.store.create<DbMember>({
        ...f.context.member,
        id: memberId(issuer.id),
        userId: issuer.id,
        email: issuer.email
    });
    const token = await invitation(f, { invitedBy: issuer.id });
    await removeMember(f.context, issuer.id);
    expect(await acceptInvitation(token)).toBeNull();
    const racing = await invitation(f);
    await Promise.allSettled([acceptInvitation(racing), changeTeamState(f.context, f.design, 'archived')]);
    expect(await memberActor(f.a, f.user.id)).toBeNull();
    const staleRevision = (await getWorkspace(f.context.workspace.id))!.accessRevision!;
    await saveTeam(f.context, { name: 'New configuration' });
    const result = await bulkTeamMembership(f.context, [f.user.id], [f.qa], 'add', staleRevision);
    expect(result).toEqual([{ userId: f.user.id, ok: false, error: expect.stringContaining('preview') }]);
});

test('remove-all access rejects blanket grants and removes granting memberships without copying projects', async () => {
    const f = await fixture();
    await updateMemberAccess(f.context, f.user.id, { projects: [f.a.id], teamIds: [f.design, f.qa] });
    await removeAllProjectMemberAccess(
        f.context,
        f.user.id,
        f.a.id,
        (await getWorkspace(f.context.workspace.id))!.accessRevision!
    );
    expect(await getMember(f.context.workspace.id, f.user.id)).toMatchObject({ projects: [], teamIds: [] });
    await updateMemberAccess(f.context, f.user.id, { projects: 'all', teamIds: [] });
    await expect(
        removeAllProjectMemberAccess(
            f.context,
            f.user.id,
            f.a.id,
            (await getWorkspace(f.context.workspace.id))!.accessRevision!
        )
    ).rejects.toThrow('all-project grant');
    await expect(
        saveTeam(
            { ...f.context, workspace: { ...f.context.workspace, id: PUBLIC_WORKSPACE_ID } },
            { name: 'Public admins' }
        )
    ).rejects.toThrow('automatically');
    await expect(setTeamProjects(f.context, f.design, ['abcdefgh1234'])).rejects.toThrow('unavailable');
});

test('overlapping teams deliver once and queued notification loses eligibility after final grant removal', async () => {
    const f = await fixture();
    await updateMemberAccess(f.context, f.user.id, { projects: [], teamIds: [f.design, f.qa] });
    const owner = (await memberActor(f.a, f.context.user.id))!;
    const comment = await createProjectComment(new Request('http://127.0.0.1'), f.a, owner, {
        text: '@Review check this',
        mentions: [{ userId: f.user.id, start: 0, end: 7 }],
        origin: f.a.urls[0]!,
        path: '/',
        kind: 'feedback',
        position: { type: 'page' }
    });
    await discoverThreadNotifications(f.a, comment);
    const deliveries = await f.store.query<NotificationDelivery>({
        type: 'notification-delivery',
        pk: notificationPk(f.a.id),
        where: { userId: f.user.id }
    });
    expect(deliveries).toHaveLength(1);
    await updateMemberAccess(f.context, f.user.id, { projects: [], teamIds: [] });
    let sends = 0;
    await processNotificationDelivery(
        deliveries[0]!,
        'https://uier.io',
        async () => {
            sends++;
            return { status: 'sent' };
        },
        Date.now() + 600_000
    );
    expect(sends).toBe(0);
});

async function transactionContract(store: AppStore) {
    const pk = `workspace:teams-transaction-${randomUUID()}`;
    const doc = { type: 'team-test', pk, id: 'grant', value: 1 };
    try {
        expect(
            await store.transact([
                { kind: 'create', doc },
                { kind: 'create', doc: { type: 'access-event', pk, id: 'created' } }
            ])
        ).toBe(true);
        const stored = (await store.get<typeof doc>(pk, 'grant'))!;
        expect(
            await store.transact([
                { kind: 'replace', doc: { ...doc, value: 9 }, etag: stored.etag },
                { kind: 'create', doc: { type: 'access-event', pk, id: 'created' } }
            ])
        ).toBe(false);
        expect((await store.get<typeof doc>(pk, 'grant'))!.doc.value).toBe(1);
        expect(
            await store.transact([
                { kind: 'delete', pk, id: 'missing', etag: stored.etag },
                { kind: 'create', doc: { type: 'access-event', pk, id: 'failed' } }
            ])
        ).toBe(false);
        expect(
            await store.transact([
                { kind: 'replace', doc: { ...doc, value: 2 }, etag: 'stale' },
                { kind: 'create', doc: { type: 'access-event', pk, id: 'failed' } }
            ])
        ).toBe(false);
        expect(await store.get(pk, 'failed')).toBeNull();
        expect((await store.get<typeof doc>(pk, 'grant'))!.doc.value).toBe(1);
        expect(
            await store.transact([
                { kind: 'replace', doc: { ...doc, value: 2 }, etag: stored.etag },
                { kind: 'create', doc: { type: 'access-event', pk, id: 'updated' } }
            ])
        ).toBe(true);
        const updated = (await store.get<typeof doc>(pk, 'grant'))!;
        expect(
            await store.transact([
                { kind: 'delete', pk, id: 'grant', etag: updated.etag },
                { kind: 'create', doc: { type: 'access-event', pk, id: 'deleted' } }
            ])
        ).toBe(true);
        expect(await store.get(pk, 'grant')).toBeNull();
    } finally {
        for (const id of ['grant', 'created', 'failed', 'updated', 'deleted']) await store.delete(pk, id);
    }
}
test('memory conditional batch rolls back grant and audit together', async () => {
    await transactionContract(createMemoryAppStore());
});

test('real Cosmos conditional batch and independent-client revocation readback', async ({}, testInfo) => {
    test.skip(
        !process.env.UIER_COSMOS_TEST_ENDPOINT && !process.env.UIER_COSMOS_TEST_CONNECTION_STRING,
        'Opt-in preview Cosmos integration check; see docs/teams-and-access.md.'
    );
    test.setTimeout(60_000);
    const { CosmosClient } = await import('@azure/cosmos');
    const { AzureCliCredential } = await import('@azure/identity');
    const client = () =>
        process.env.UIER_COSMOS_TEST_CONNECTION_STRING
            ? new CosmosClient(process.env.UIER_COSMOS_TEST_CONNECTION_STRING)
            : new CosmosClient({
                  endpoint: process.env.UIER_COSMOS_TEST_ENDPOINT!,
                  aadCredentials: new AzureCliCredential(),
                  connectionPolicy: { enableEndpointDiscovery: false }
              });
    const first = client(),
        second = client();
    // Deliberately fixed to the existing preview container. Never infer or accept production.
    const store = createCosmosAppStore(() => first.database('uierdata').container('app-preview'));
    const reader = createCosmosAppStore(() => second.database('uierdata').container('app-preview'));
    await transactionContract(store);
    const workspaceId = `teams-propagation-${randomUUID()}`,
        pk = workspacePk(workspaceId),
        id = `team_${'r'.repeat(21)}`;
    const team: DbTeam = {
        type: 'team',
        id,
        pk,
        workspaceId,
        name: 'Readback fixture',
        nameKey: 'readback fixture',
        state: 'active',
        projectIds: ['abcdef123456'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'test',
        updatedBy: 'test'
    };
    try {
        await store.create(team);
        const current = (await store.get<DbTeam>(pk, id))!;
        await store.transact([
            { kind: 'replace', doc: { ...team, state: 'archived', projectIds: [] }, etag: current.etag }
        ]);
        const start = performance.now();
        await expect
            .poll(async () => (await loadWorkspaceAccess(workspaceId, reader)).teams.length, { timeout: 5000 })
            .toBe(0);
        const measurement = {
            elapsedMs: performance.now() - start,
            configuredConsistency: 'Session',
            guarantee: 'Observed sample only; no cross-session propagation guarantee.'
        };
        console.log('Cosmos independent-client readback', JSON.stringify(measurement));
        await testInfo.attach('cosmos-independent-readback.json', {
            body: JSON.stringify(measurement),
            contentType: 'application/json'
        });
    } finally {
        await store.delete(pk, id);
        first.dispose();
        second.dispose();
    }
});

test('100 teams and 1000 projects use one bounded workspace team query with no truncation', async ({}, testInfo) => {
    const f = await fixture(),
        workspaceId = f.context.workspace.id;
    for (const id of [f.design, f.qa]) await changeTeamState(f.context, id, 'deleted');
    const teams: string[] = [];
    for (let i = 0; i < 100; i++) {
        const id = `team_${String(i).padStart(21, '0')}`;
        teams.push(id);
        await f.store.create<DbTeam>({
            type: 'team',
            id,
            pk: workspacePk(workspaceId),
            workspaceId,
            name: `Team ${i}`,
            nameKey: `team ${i}`,
            state: 'active',
            projectIds: Array.from({ length: 200 }, (_, j) => `p${i * 10 + j}`),
            createdBy: f.context.user.id,
            updatedBy: f.context.user.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
    let queries = 0;
    const counted: AppStore = {
        ...f.store,
        query: async (query) => {
            queries++;
            expect(query.pk).toBe(workspacePk(workspaceId));
            expect(query.limit).toBe(101);
            return f.store.query(query);
        }
    };
    const start = performance.now(),
        snapshot = await loadWorkspaceAccess(workspaceId, counted),
        loadedMs = performance.now() - start;
    const member = { ...f.person, teamIds: teams.slice(0, 50) };
    const projects = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, workspaceId }));
    const resolveStart = performance.now(),
        visible = projects.filter((project) => hasProjectAccess(snapshot, member, project)),
        resolveMs = performance.now() - resolveStart;
    const directStart = performance.now();
    projects.filter((project) => hasProjectAccess({ workspaceId, teams: [] }, { ...member, projects: 'all' }, project));
    const directMs = performance.now() - directStart;
    expect(queries).toBe(1);
    expect(snapshot.teams).toHaveLength(100);
    expect(visible.length).toBeGreaterThan(500);
    const measurement = { teams: 100, projects: 1000, queries, loadedMs, resolveMs, directMs };
    console.log('Team authorization measurement', JSON.stringify(measurement));
    await testInfo.attach('team-authorization-performance.json', {
        body: JSON.stringify(measurement),
        contentType: 'application/json'
    });
    const events = await f.store.query<DbAccessEvent>({ type: 'access-event', pk: workspacePk(workspaceId) });
    expect(events.every((event) => event.ttl === 180 * 86400 && !JSON.stringify(event).includes('tokenHash'))).toBe(
        true
    );
});
