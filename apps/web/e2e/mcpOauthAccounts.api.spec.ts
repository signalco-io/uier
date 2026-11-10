import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { AppContext } from '../src/lib/app/context';
import { memberId, workspacePk, type DbMember, type DbUser, type DbWorkspace } from '../src/lib/app/model';
import { createProject } from '../src/lib/app/projects';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import { authenticateMcp, currentMcpConnection, mcpProject, removeProjectFromMcpAccess } from '../src/lib/mcp/credentials';
import { handleMcp } from '../src/lib/mcp/http';
import { approvalSchema, approveAuthorization, getPendingAuthorization, startAuthorization } from '../src/lib/mcp/oauth/authorize';
import { registerClient } from '../src/lib/mcp/oauth/clients';
import { connectedAppView } from '../src/lib/mcp/oauth/connectedApps';
import { getGrant, listAccessibleWorkspaces, revokeConnectedApp, type AgentAccess } from '../src/lib/mcp/oauth/grants';
import { exchangeCode, refreshTokens } from '../src/lib/mcp/oauth/tokens';
import type { McpScope } from '../src/lib/mcp/scopes';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { memberActor } from '../src/lib/review/actor';
import { createProjectComment, setProjectCommentAssignee, setProjectCommentPrivate } from '../src/lib/review/comments';
import { pollProjectEvents } from '../src/lib/mcp/events/feed';

const base = 'http://127.0.0.1:6526';
const resource = `${base}/api/mcp`;
const originalEnv = Object.fromEntries(['UIER_LOCAL', 'UIER_COMMENTS_SECRET', 'UIER_BASE_URL', 'UIER_MCP_OAUTH', 'VERCEL']
    .map(key => [key, process.env[key]]));
test.beforeAll(() => {
    Object.assign(process.env, { UIER_LOCAL: '1', UIER_COMMENTS_SECRET: 'mcp-accounts-test-secret-for-local-validation-only', UIER_BASE_URL: base });
    delete process.env.UIER_MCP_OAUTH;
    delete process.env.VERCEL;
});
test.afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});

type AccountChoice = { userId: string; access: AgentAccess };
const selected = (workspaceId: string, ...projects: string[]): AgentAccess => ({ kind: 'selected', workspaces: [{ workspaceId, projects }] });
const bearer = (token: string) => new Request(resource, { headers: { Authorization: `Bearer ${token}` } });

async function person(label: string) {
    const user = await findOrCreateUser(`mcp-accounts-${label}-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: `${label} project`, urls: ['https://reviewed.example'] });
    const other = await createProject(context, { name: `${label} excluded project`, urls: ['https://other.example'] });
    const actor = (await memberActor(project, user.id))!;
    const comment = await createProjectComment(new Request(base), project, actor, {
        origin: 'https://reviewed.example', path: '/', kind: 'feedback', position: { type: 'page' }, text: `${label} feedback`
    });
    return { user, member, context, project, other, actor, comment };
}

async function begin(scopes: McpScope[] = ['feedback:read']) {
    const redirectUri = 'http://127.0.0.1:43123/callback';
    const client = await registerClient({ client_name: 'Multi-account test', redirect_uris: [redirectUri] });
    const verifier = randomBytes(32).toString('base64url');
    const outcome = await startAuthorization(new URLSearchParams({
        response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
        code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        resource, scope: scopes.join(' ')
    }), base);
    if (outcome.kind !== 'consent') throw new Error(`Expected consent, got ${outcome.kind}`);
    return { requestId: outcome.requestId, clientId: client.client_id, redirectUri, verifier, scopes };
}

async function authorize(owner: DbUser, accounts: AccountChoice[], users: DbUser[], scopes: McpScope[] = ['feedback:read']) {
    const flow = await begin(scopes);
    const callback = new URL(await approveAuthorization(owner, flow.requestId, {
        accounts, scopes, name: 'Multi-account test'
    }, base, users));
    const tokens = await exchangeCode(new URLSearchParams({
        grant_type: 'authorization_code', code: callback.searchParams.get('code')!, code_verifier: flow.verifier,
        client_id: flow.clientId, redirect_uri: flow.redirectUri, resource
    }), base);
    const identity = await authenticateMcp(bearer(tokens.access_token), base);
    return { ...flow, tokens, identity };
}

async function connect(token: string) {
    const client = new Client({ name: 'multi-account-regression', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: async (input, init) => handleMcp(new Request(input, init), base, { emit: () => {} })
    }));
    return client;
}
function data(result: Awaited<ReturnType<Client['callTool']>>) { return result.structuredContent as Record<string, any>; }
const tool = async (client: Client, name: string, args: Record<string, unknown>) => data(await client.callTool({ name, arguments: args }));

test('consent rejects unproven accounts and invalid per-account access without consuming the request', async () => {
    const a = await person('consent-owner');
    const b = await person('consent-other');
    const flow = await begin();
    const approval = { accounts: [{ userId: b.user.id, access: { kind: 'all' } }], scopes: flow.scopes, name: 'Account proof' };
    await expect(approveAuthorization(a.user, flow.requestId, approval, base)).rejects.toMatchObject({ code: 'access_denied' });
    expect(await getPendingAuthorization(flow.requestId)).not.toBeNull();
    await expect(approveAuthorization(a.user, flow.requestId, {
        ...approval, accounts: [{ userId: b.user.id, access: selected(a.project.workspaceId, a.project.id) }]
    }, base, [a.user, b.user])).rejects.toMatchObject({ code: 'access_denied' });
    expect(await getPendingAuthorization(flow.requestId)).not.toBeNull();
    expect(approvalSchema.safeParse({ ...approval, accounts: [] }).success).toBe(false);
    expect(approvalSchema.safeParse({ ...approval, accounts: [approval.accounts[0], approval.accounts[0]] }).success).toBe(false);
    expect(new URL(await approveAuthorization(a.user, flow.requestId, approval, base, [a.user, b.user])).searchParams.get('code')).toMatch(/^uier_code\./);
});

test('one authorization reaches only selected profiles and projects and keeps those choices on refresh', async () => {
    const a = await person('selected-owner');
    const b = await person('selected-other');
    const c = await person('unselected');
    const accounts = [
        { userId: a.user.id, access: selected(a.project.workspaceId, a.project.id) },
        { userId: b.user.id, access: selected(b.project.workspaceId, b.project.id) }
    ];
    const app = await authorize(a.user, accounts, [a.user, b.user, c.user]);
    expect((await getGrant(a.user.id, app.identity.connection.id))?.doc.accounts).toEqual(accounts);
    expect((await mcpProject(app.identity, a.project.id)).actor).toMatchObject({ userId: a.user.id });
    expect((await mcpProject(app.identity, b.project.id)).actor).toMatchObject({ userId: b.user.id });
    for (const id of [a.other.id, b.other.id, c.project.id])
        await expect(mcpProject(app.identity, id)).rejects.toMatchObject({ status: 404 });
    const client = await connect(app.tokens.access_token);
    try {
        const listed = await tool(client, 'list_projects', { limit: 25 });
        expect(listed.items.map((project: { id: string }) => project.id).sort()).toEqual([a.project.id, b.project.id].sort());
        expect(listed.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: a.project.id, account: { id: a.user.id, name: a.user.name, email: a.user.email } }),
            expect.objectContaining({ id: b.project.id, account: { id: b.user.id, name: b.user.name, email: b.user.email } })
        ]));
        const filtered = await tool(client, 'list_projects', { workspaceId: b.project.workspaceId });
        expect(filtered.items.map((project: { id: string }) => project.id)).toEqual([b.project.id]);
        const laterPage = await tool(client, 'list_projects', { cursor: 1001 });
        expect(laterPage.error).toBeUndefined();
        expect(laterPage.items).toEqual([]);
    } finally { await client.close(); }
    const refreshed = await refreshTokens(new URLSearchParams({
        grant_type: 'refresh_token', client_id: app.clientId, refresh_token: app.tokens.refresh_token, resource
    }), base);
    const identity = await authenticateMcp(bearer(refreshed.access_token), base);
    expect(identity.accounts?.map(({ user, access }) => ({ userId: user.id, access }))).toEqual(accounts);
    expect((await mcpProject(identity, b.project.id)).actor).toMatchObject({ userId: b.user.id });
    expect(await currentMcpConnection(a.user.id, identity.connection.id, 'oauth')).toMatchObject({
        accounts: [{ user: { id: a.user.id } }, { user: { id: b.user.id } }]
    });
    await revokeConnectedApp(a.user.id, identity.connection.id);
    await expect(authenticateMcp(bearer(refreshed.access_token), base)).rejects.toMatchObject({ status: 401 });
});

test('secondary-profile replies, me filters and agent attachments use that profile', async () => {
    const a = await person('acting-owner');
    const b = await person('acting-other');
    const app = await authorize(a.user, [
        { userId: a.user.id, access: { kind: 'all' } }, { userId: b.user.id, access: { kind: 'all' } }
    ], [a.user, b.user], ['feedback:read', 'feedback:reply', 'feedback:assign', 'feedback:status']);
    const client = await connect(app.tokens.access_token);
    try {
        const args = { projectId: b.project.id, commentId: b.comment.id };
        const reply = await tool(client, 'reply_to_feedback', { ...args, text: 'A reply from the selected profile', idempotencyKey: randomUUID() });
        expect(reply.error).toBeUndefined();
        expect(reply.actingAs).toMatchObject({ userId: b.user.id, name: b.user.name });
        expect((await getCommentsStore().get(b.comment.domain, b.comment.id))?.comment.thread.items.at(-1)).toMatchObject({
            authorId: `user:${b.user.id}`, agent: { credentialId: app.identity.connection.id, kind: 'oauth' }
        });
        const attachment = await tool(client, 'set_feedback_agent', {
            ...args, agent: 'codex', sessionId: 'secondary-session', assignToMe: true, idempotencyKey: randomUUID()
        });
        expect(attachment.error).toBeUndefined();
        expect(attachment).toMatchObject({ actingAs: { userId: b.user.id }, assigneeId: b.user.id, assigneeIds: [b.user.id] });
        const assigned = await tool(client, 'list_feedback', { projectId: b.project.id, assignee: 'me' });
        expect(assigned.items.map((item: { id: string }) => item.id)).toContain(b.comment.id);
        const working = await tool(client, 'set_feedback_agent_working', {
            ...args, sessionId: 'secondary-session', working: true, idempotencyKey: randomUUID()
        });
        expect(working.error).toBeUndefined();
        expect(working).toMatchObject({ actingAs: { userId: b.user.id }, assigneeId: b.user.id });
        expect(working.agent).not.toBeNull();
        const cleared = await tool(client, 'clear_feedback_agent', { ...args, idempotencyKey: randomUUID() });
        expect(cleared.error).toBeUndefined();
        expect(cleared).toMatchObject({ actingAs: { userId: b.user.id }, agents: [] });
    } finally { await client.close(); }
});

test('the manager can exclude their profile and create a token for a selected secondary profile', async () => {
    const a = await person('excluded-owner');
    const b = await person('included-other');
    const app = await authorize(a.user, [{ userId: b.user.id, access: selected(b.project.workspaceId, b.project.id) }],
        [a.user, b.user], ['feedback:read', 'feedback:reply', 'tokens:create']);
    await expect(mcpProject(app.identity, a.project.id)).rejects.toMatchObject({ status: 404 });
    const client = await connect(app.tokens.access_token);
    try {
        const listed = await tool(client, 'list_projects', {});
        expect(listed.items.map((project: { id: string }) => project.id)).toEqual([b.project.id]);
        const created = await tool(client, 'create_access_token', {
            name: 'Secondary watcher', workspaceId: b.project.workspaceId, projectIds: [b.project.id], scopes: ['feedback:read', 'feedback:reply'],
            days: 7, idempotencyKey: randomUUID()
        });
        expect(created.error).toBeUndefined();
        expect(created.token).toMatch(/^uier_mcp\./);
        const watcher = await authenticateMcp(bearer(created.token), base);
        expect((await mcpProject(watcher, b.project.id)).actor).toMatchObject({ userId: b.user.id });
        await expect(mcpProject(watcher, a.project.id)).rejects.toMatchObject({ status: 404 });
        await expect(mcpProject(watcher, b.other.id)).rejects.toMatchObject({ status: 404 });
        const watcherClient = await connect(created.token);
        try {
            const reply = await tool(watcherClient, 'reply_to_feedback', {
                projectId: b.project.id, commentId: b.comment.id, text: 'The watcher uses the selected profile', idempotencyKey: randomUUID()
            });
            expect(reply).toMatchObject({ actingAs: { userId: b.user.id }, saved: true });
        } finally { await watcherClient.close(); }
        const narrowed = await refreshTokens(new URLSearchParams({
            grant_type: 'refresh_token', client_id: app.clientId, refresh_token: app.tokens.refresh_token, resource, scope: 'feedback:read'
        }), base);
        const identity = await authenticateMcp(bearer(narrowed.access_token), base);
        expect((await mcpProject(identity, b.project.id)).actor).toMatchObject({ userId: b.user.id });
        await expect(mcpProject(identity, b.project.id, 'feedback:reply')).rejects.toMatchObject({ status: 403 });
        await revokeConnectedApp(a.user.id, identity.connection.id, true);
        await expect(authenticateMcp(bearer(created.token), base)).rejects.toMatchObject({ status: 401 });
    } finally { await client.close(); }
});

test('secondary-profile permissions remain live and removal does not revoke other selected profiles', async () => {
    const a = await person('live-owner');
    const b = await person('live-other');
    const app = await authorize(a.user, [
        { userId: a.user.id, access: { kind: 'all' } }, { userId: b.user.id, access: { kind: 'all' } }
    ], [a.user, b.user]);
    const store = getAppStore();
    const membership = (await store.get<DbMember>(workspacePk(b.project.workspaceId), memberId(b.user.id)))!;
    expect(await store.replace({ ...membership.doc, role: 'commenter' }, membership.etag)).toBe('ok');
    expect((await mcpProject(app.identity, b.project.id)).actor).toMatchObject({ userId: b.user.id, isAdmin: false });
    await store.delete(membership.doc.pk, membership.doc.id);
    await expect(mcpProject(app.identity, b.project.id)).rejects.toMatchObject({ status: 404 });
    expect((await mcpProject(app.identity, a.project.id)).actor).toMatchObject({ userId: a.user.id });
    const client = await connect(app.tokens.access_token);
    try {
        expect((await tool(client, 'list_projects', { workspaceId: b.project.workspaceId })).items).toEqual([]);
    } finally { await client.close(); }
});

test('overlapping profiles use one deterministic actor without combining private or admin access', async () => {
    const a = await person('overlap-owner');
    const b = await person('overlap-admin');
    const member: DbMember = {
        type: 'member', id: memberId(a.user.id), pk: workspacePk(b.project.workspaceId), workspaceId: b.project.workspaceId,
        userId: a.user.id, email: a.user.email, role: 'commenter', projects: 'all', createdAt: new Date().toISOString()
    };
    expect(await getAppStore().create(member)).toBe(true);
    await setProjectCommentPrivate(b.project, b.actor, b.comment.id, true);
    // Owner wins even when the submitted account list puts the other profile first.
    const app = await authorize(a.user, [
        { userId: b.user.id, access: { kind: 'all' } }, { userId: a.user.id, access: { kind: 'all' } }
    ], [a.user, b.user]);
    expect((await mcpProject(app.identity, b.project.id)).actor).toMatchObject({ userId: a.user.id, isAdmin: false });
    const client = await connect(app.tokens.access_token);
    try {
        const listed = await tool(client, 'list_projects', { workspaceId: b.project.workspaceId });
        expect(listed.items.filter((project: { id: string }) => project.id === b.project.id)).toHaveLength(1);
        const result = await client.callTool({ name: 'get_feedback', arguments: { projectId: b.project.id, commentId: b.comment.id } });
        expect(result.isError).toBe(true);
        expect(data(result).error).toBe('not_found');
    } finally { await client.close(); }
});

test('truncated discovery reports the same acting profile as project tools for a shared project', async () => {
    const a = await person('truncated-owner');
    const b = await person('truncated-secondary');
    const store = getAppStore();
    const start = Date.now() - 60_000;
    // These empty memberships fill the managing account's discovery window before the shared workspace.
    for (let index = 0; index < 51; index++) {
        const workspaceId = `w_accounts_bound_${randomUUID().replace(/-/g, '')}`;
        const createdAt = new Date(start + index).toISOString();
        const workspace: DbWorkspace = { type: 'workspace', id: workspaceId, pk: workspacePk(workspaceId),
            name: `Earlier workspace ${index}`, createdBy: a.user.id, createdAt };
        const member: DbMember = { type: 'member', id: memberId(a.user.id), pk: workspace.pk, workspaceId,
            userId: a.user.id, email: a.user.email, role: 'admin', projects: 'all', createdAt };
        expect(await store.create(workspace)).toBe(true);
        expect(await store.create(member)).toBe(true);
    }
    const shared: DbMember = { type: 'member', id: memberId(a.user.id), pk: workspacePk(b.project.workspaceId),
        workspaceId: b.project.workspaceId, userId: a.user.id, email: a.user.email, role: 'commenter', projects: 'all',
        createdAt: new Date().toISOString() };
    expect(await store.create(shared)).toBe(true);
    const accessible = await listAccessibleWorkspaces(a.user.id, a.user.email);
    expect(accessible.truncated).toBe(true);
    expect(accessible.workspaces.some(entry => entry.workspace.id === b.project.workspaceId)).toBe(false);
    const app = await authorize(a.user, [
        { userId: a.user.id, access: { kind: 'all' } },
        { userId: b.user.id, access: selected(b.project.workspaceId, b.project.id) }
    ], [a.user, b.user]);
    const actingUser = (await mcpProject(app.identity, b.project.id)).user;
    expect(actingUser.id).toBe(a.user.id);
    const account = { id: actingUser.id, name: actingUser.name, email: actingUser.email };
    const client = await connect(app.tokens.access_token);
    try {
        const unfiltered = await tool(client, 'list_projects', { limit: 25 });
        expect(unfiltered.truncated).toBe(true);
        expect(unfiltered.items).toEqual([expect.objectContaining({ id: b.project.id, account })]);
        const filtered = await tool(client, 'list_projects', { workspaceId: b.project.workspaceId });
        expect(filtered.truncated).toBeUndefined();
        expect(filtered.items.find((project: { id: string }) => project.id === b.project.id)).toMatchObject({ account });
        const feedback = await tool(client, 'get_feedback', { projectId: b.project.id, commentId: b.comment.id });
        expect(feedback.actingAs).toMatchObject({ userId: actingUser.id, name: actingUser.name });
    } finally { await client.close(); }
});

test('event polling matches me against the selected project profile', async () => {
    const a = await person('events-owner');
    const b = await person('events-other');
    const app = await authorize(a.user, [{ userId: b.user.id, access: { kind: 'all' } }], [a.user, b.user]);
    const { project, actor } = await mcpProject(app.identity, b.project.id);
    const now = Date.now();
    const first = await pollProjectEvents({ identity: app.identity, project, actor, names: ['feedback.assignment_changed'],
        args: { assignee: 'me' }, cursor: null, maxEvents: 20, now });
    await setProjectCommentAssignee(project, b.actor, b.comment.id, b.user.id, randomUUID());
    const next = await pollProjectEvents({ identity: app.identity, project, actor, names: ['feedback.assignment_changed'],
        args: { assignee: 'me' }, cursor: first.cursor, maxEvents: 20, now: now + 1000 });
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toMatchObject({ name: 'feedback.assignment_changed', data: { projectId: b.project.id, assignee: { id: b.user.id } } });
});

test('project removal prunes only its account selection and the final project revokes the connection', async () => {
    const a = await person('deletion-owner');
    const b = await person('deletion-other');
    const remaining = { userId: a.user.id, access: selected(a.project.workspaceId, a.project.id) };
    const app = await authorize(a.user, [remaining, { userId: b.user.id, access: selected(b.project.workspaceId, b.project.id) }], [a.user, b.user]);
    await removeProjectFromMcpAccess(b.project.workspaceId, b.project.id);
    expect((await getGrant(a.user.id, app.identity.connection.id))?.doc.accounts).toEqual([remaining]);
    const refreshed = await refreshTokens(new URLSearchParams({
        grant_type: 'refresh_token', client_id: app.clientId, refresh_token: app.tokens.refresh_token, resource
    }), base);
    const identity = await authenticateMcp(bearer(refreshed.access_token), base);
    expect(identity.accounts?.map(({ user, access }) => ({ userId: user.id, access }))).toEqual([remaining]);
    expect((await mcpProject(identity, a.project.id)).actor).toMatchObject({ userId: a.user.id });
    await expect(mcpProject(identity, b.project.id)).rejects.toMatchObject({ status: 404 });
    await removeProjectFromMcpAccess(a.project.workspaceId, a.project.id);
    expect(await getGrant(a.user.id, app.identity.connection.id)).toBeNull();
    await expect(authenticateMcp(bearer(refreshed.access_token), base)).rejects.toMatchObject({ status: 401 });
});

test('connected app details show secondary account metadata only while its browser session is verified', async () => {
    const a = await person('metadata-owner');
    const b = await person('metadata-secondary');
    const app = await authorize(a.user, [
        { userId: a.user.id, access: selected(a.project.workspaceId, a.project.id) },
        { userId: b.user.id, access: selected(b.project.workspaceId, b.project.id) }
    ], [a.user, b.user]);
    const grant = (await getGrant(a.user.id, app.identity.connection.id))!.doc;
    const [accessibleA, accessibleB] = await Promise.all([
        listAccessibleWorkspaces(a.user.id, a.user.email), listAccessibleWorkspaces(b.user.id, b.user.email)
    ]);
    const owner = { userId: a.user.id, email: a.user.email, workspaces: accessibleA.workspaces };
    const secondary = { userId: b.user.id, email: b.user.email, workspaces: accessibleB.workspaces };
    const visible = connectedAppView(grant, accessibleA.workspaces, [owner, secondary]);
    expect(visible.access).toMatchObject({ summary: '2 accounts', accounts: [{ label: a.user.email }, { label: b.user.email }] });
    expect(JSON.stringify(visible)).toContain(b.project.name);
    const redacted = connectedAppView(grant, accessibleA.workspaces, [owner]);
    expect(redacted.access).toMatchObject({ summary: '2 accounts', accounts: [{ label: a.user.email }, { label: 'Another account' }] });
    expect(JSON.stringify(redacted)).not.toContain(b.user.email);
    expect(JSON.stringify(redacted)).not.toContain(b.project.name);
});
