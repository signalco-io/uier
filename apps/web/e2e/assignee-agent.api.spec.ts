import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { inferAgentKind } from '@uier/toolbar/agents';
import { feedbackStage } from '@uier/toolbar/verification';
import { feedbackMarkdown } from '@uier/toolbar/feedback-context';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { projectCommentRouting } from '../src/lib/app/projectCommentRouting';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProjectComment, setProjectCommentAssignee, setProjectCommentPrivate, setProjectCommentStatus } from '../src/lib/review/comments';
import { changeFixVerification } from '../src/lib/review/fixVerification';
import { setProjectCommentAgent } from '../src/lib/review/assigneeAgent';
import { currentAssigneeAgent } from '../src/lib/review/assigneeAgentModel';
import { memberActor, type ProjectActor } from '../src/lib/review/actor';
import { participantNames, toReviewCommentDto } from '../src/lib/review/dto';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { threadActivity } from '../src/lib/comments/activity';
import { discoverThreadNotifications, processNotificationDelivery, type NotificationDelivery } from '../src/lib/notifications/delivery';
import { notificationPk } from '../src/lib/notifications/preferences';
import { createMcpCredential } from '../src/lib/mcp/credentials';
import type { McpScope } from '../src/lib/mcp/scopes';
import { handleMcp } from '../src/lib/mcp/http';
import type { EmailMessage } from '../src/lib/email/send';
import type { DbComment } from '../src/lib/db/schema';

const base = 'http://127.0.0.1:6516';
const originalEnv = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_COMMENTS_SECRET: process.env.UIER_COMMENTS_SECRET, UIER_BASE_URL: process.env.UIER_BASE_URL };
test.beforeAll(() => { Object.assign(process.env, { UIER_LOCAL: '1', UIER_COMMENTS_SECRET: 'agent-test-secret-for-local-validation-only', UIER_BASE_URL: base }); });
test.afterAll(() => { for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

const request = new Request(`${base}/api/review`);

/** An admin (owner), two commenters (a: the assignee, b: someone else) and a guest on one project */
async function fixture() {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = await findOrCreateUser(`agent-owner-${id}@example.com`);
    const a = await findOrCreateUser(`agent-a-${id}@example.com`);
    const b = await findOrCreateUser(`agent-b-${id}@example.com`);
    const workspaceId = `w_${owner.id}`;
    const old = '2026-01-01T00:00:00.000Z';
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: `Agents ${id}`, urls: ['https://reviewed.example'],
        status: 'active', access: 'guests', createdBy: owner.id, createdAt: old, updatedAt: old };
    await getAppStore().create(project);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    for (const [user, role] of [[owner, 'admin'], [a, 'commenter'], [b, 'commenter']] as const)
        await getAppStore().create<DbMember>({ type: 'member', id: memberId(user.id), pk: project.pk, workspaceId, userId: user.id, email: user.email, role, projects: 'all', createdAt: old });
    const admin = (await memberActor(project, owner.id))!;
    const assignee = (await memberActor(project, a.id))!;
    const other = (await memberActor(project, b.id))!;
    const guest: ProjectActor = { kind: 'guest', visitorId: 'agent-guest' };
    const comment = await createProjectComment(request, project, admin, { text: 'The checkout button overlaps the total.', origin: project.urls[0]!,
        path: '/checkout', pageStateVersion: 1, position: { type: 'page' }, kind: 'bug' });
    return { project, owner, a, b, admin, assignee, other, guest, comment };
}

async function stored(comment: DbComment) { return (await getCommentsStore().get(comment.domain, comment.id))!.comment; }

/** Runs notification discovery and delivery for the thread now, collecting the emails */
function mailer(f: Awaited<ReturnType<typeof fixture>>) {
    const sent: EmailMessage[] = [];
    const dispatch = async () => {
        await discoverThreadNotifications(f.project, await stored(f.comment));
        const deliveries = await getAppStore().query<NotificationDelivery>({ type: 'notification-delivery', pk: notificationPk(f.project.id) });
        for (const delivery of deliveries) await processNotificationDelivery(delivery, 'https://uier.io', async message => {
            sent.push(message); return { status: 'sent' };
        }, Date.now() + 30 * 60 * 1000);
    };
    return { sent, dispatch };
}

/** An MCP client of the assignee (`a`) with the given scopes */
async function mcpClient(f: Awaited<ReturnType<typeof fixture>>, name: string, scopes: McpScope[]) {
    const member = (await getAppStore().get<DbMember>(f.project.pk, memberId(f.a.id)))!.doc;
    const ownerContext = { user: f.a, member, workspace: { id: f.project.workspaceId }, isAdmin: false } as AppContext;
    const { token } = await createMcpCredential(ownerContext, { name, projectIds: [f.project.id], scopes, days: 7 });
    const client = new Client({ name: 'agent-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: async (input, init) => handleMcp(new Request(input, init), base, { emit: () => {} }) }));
    return client;
}

test('only the assignee chooses the agent working under them; a new assignee starts without one', async () => {
    const f = await fixture();
    const claude = { kind: 'claude' as const, sessionId: 'session-123', model: 'claude-opus-5-5', reasoning: 'high' };
    // Unassigned: nobody has an agent to choose yet, and assignToMe is MCP's explicit path
    await expect(setProjectCommentAgent(f.project, f.assignee, f.comment.id, claude)).rejects.toMatchObject({ code: 'forbidden', message: 'Assign this thread to yourself first.' });
    await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.a.id);

    // Guests, other members and admins never set or clear an agent under someone else
    await expect(setProjectCommentAgent(f.project, f.guest, f.comment.id, claude)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(setProjectCommentAgent(f.project, { kind: 'anonymous' }, f.comment.id, claude)).rejects.toMatchObject({ code: 'forbidden' });
    for (const actor of [f.other, f.admin]) {
        await expect(setProjectCommentAgent(f.project, actor, f.comment.id, claude)).rejects.toMatchObject({ code: 'forbidden', message: 'Only the assignee can choose the agent working under them.' });
        await expect(setProjectCommentAgent(f.project, actor, f.comment.id, null)).rejects.toMatchObject({ code: 'forbidden' });
        // assignToMe never takes a thread from its assignee
        await expect(setProjectCommentAgent(f.project, actor, f.comment.id, claude, { assignToMe: true })).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect((await stored(f.comment)).assigneeAgent).toBeUndefined();

    // Invalid input changes nothing
    for (const invalid of [{ kind: 'gpt' }, { kind: 'claude', sessionId: 'line\nbreak' }, { kind: 'claude', model: 'm'.repeat(101) },
        { kind: 'claude', sessionId: 's'.repeat(201) }, { kind: 'claude', extra: true }] as never[])
        await expect(setProjectCommentAgent(f.project, f.assignee, f.comment.id, invalid)).rejects.toMatchObject({ code: 'invalid_request' });
    // The reasoning level is short, one-line text in the agent's own words
    await expect(setProjectCommentAgent(f.project, f.assignee, f.comment.id, { kind: 'claude', reasoning: 'r'.repeat(33) }))
        .rejects.toMatchObject({ code: 'invalid_request', message: 'A reasoning level can be at most 32 characters.' });
    await expect(setProjectCommentAgent(f.project, f.assignee, f.comment.id, { kind: 'claude', reasoning: 'high\u202Elow' }))
        .rejects.toMatchObject({ code: 'invalid_request', message: 'A reasoning level must be plain text on one line.' });

    // The assignee sets one: activity, an agent event that names the assignee, never their connector
    const before = threadActivity(await stored(f.comment)).sequence;
    let saved = await setProjectCommentAgent(f.project, f.assignee, f.comment.id, claude);
    expect(saved.assigneeAgent).toMatchObject({ ...claude, assigneeId: f.a.id, setBy: f.a.id, setAt: expect.any(String) });
    expect(saved.assigneeAgent?.connector).toBeUndefined();
    expect(threadActivity(saved).sequence).toBe(before + 1);
    expect(saved.notificationEvents?.at(-1)).toMatchObject({ kind: 'agent', actorId: `user:${f.a.id}`, assigneeId: f.a.id, assigneeAgent: { kind: 'claude', sessionId: 'session-123', model: 'claude-opus-5-5', reasoning: 'high' } });
    // The same agent again is a no-op; blank details clear them
    expect(threadActivity(await setProjectCommentAgent(f.project, f.assignee, f.comment.id, claude)).sequence).toBe(before + 1);
    // A new reasoning level alone is a change
    const started = saved.assigneeAgent!.setAt;
    saved = await setProjectCommentAgent(f.project, f.assignee, f.comment.id, { ...claude, reasoning: ' max ' });
    // New details in the same session keep when the agent started (the avatars' card says since when it works)
    expect(saved.assigneeAgent).toMatchObject({ ...claude, reasoning: 'max', setAt: started });
    expect(threadActivity(saved).sequence).toBe(before + 2);
    saved = await setProjectCommentAgent(f.project, f.assignee, f.comment.id, { kind: 'codex', sessionId: '  ', model: '', reasoning: ' ' });
    expect(saved.assigneeAgent).toMatchObject({ kind: 'codex' });
    expect(saved.assigneeAgent).not.toHaveProperty('sessionId');
    expect(saved.assigneeAgent).not.toHaveProperty('model');
    expect(saved.assigneeAgent).not.toHaveProperty('reasoning');
    saved = await setProjectCommentAgent(f.project, f.assignee, f.comment.id, claude);

    // Members see the agent in every projection; guests never do
    const participants = await participantNames(f.project);
    expect(projectCommentRouting(saved, f.project, participants, `user:${f.a.id}`).assignee).toMatchObject({ id: f.a.id, agent: { ...claude, label: 'Claude' } });
    expect(toReviewCommentDto(saved, f.other, new Map(), [], 0, participants)?.assignee?.agent).toMatchObject({ kind: 'claude', label: 'Claude', model: 'claude-opus-5-5', reasoning: 'high', sessionId: 'session-123' });
    const guestDto = toReviewCommentDto(saved, f.guest, new Map(), [], 0, participants);
    expect(guestDto?.assignee?.name).toBeTruthy();
    expect(guestDto?.assignee).not.toHaveProperty('agent');
    const packet = await projectFeedbackExport(f.project, f.other, f.comment.id, undefined, base);
    expect(packet.context.assignee?.agent).toEqual({ kind: 'claude', label: 'Claude', model: 'claude-opus-5-5', reasoning: 'high', sessionId: 'session-123' });
    expect(packet.markdown).toContain('Agent: ` Claude ` · Model: ` claude-opus-5-5 ` · Reasoning: ` high ` · Session: ` session-123 `');
    // Agents saved before the reasoning level existed keep their packet line
    const { reasoning: _, ...withoutReasoning } = packet.context.assignee!.agent!;
    expect(feedbackMarkdown({ ...packet.context, assignee: { name: 'Ana', agent: withoutReasoning } })).toContain('Agent: ` Claude ` · Model: ` claude-opus-5-5 ` · Session: ` session-123 `');
    expect(feedbackMarkdown({ ...packet.context, assignee: { name: 'Ana' } })).not.toContain('Agent:');

    // A new assignee starts without an agent: the write records the assignment and the agent leaving
    saved = await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.b.id);
    expect(saved.assigneeAgent).toBeUndefined();
    const sequence = threadActivity(saved).sequence;
    expect(saved.notificationEvents?.filter(event => event.sequence === sequence).map(event => [event.kind, event.assigneeId, event.assigneeAgent])).toEqual([
        ['assignment', f.b.id, undefined], ['agent', f.a.id, null]]);
    // The previous assignee can no longer change it; the new one starts from none
    await expect(setProjectCommentAgent(f.project, f.assignee, f.comment.id, null)).rejects.toMatchObject({ code: 'forbidden' });
    expect(threadActivity(await setProjectCommentAgent(f.project, f.other, f.comment.id, null)).sequence).toBe(sequence);

    // An agent saved under an earlier assignee is never shown (defense in depth for older writes)
    const current = await getCommentsStore().get(f.comment.domain, f.comment.id);
    await getCommentsStore().replace({ ...current!.comment, assigneeAgent: { kind: 'cursor', assigneeId: f.a.id, setBy: f.a.id, setAt: new Date().toISOString() } }, current!.etag);
    const stale = await stored(f.comment);
    expect(currentAssigneeAgent(stale)).toBeUndefined();
    expect(projectCommentRouting(stale, f.project, participants, undefined).assignee).not.toHaveProperty('agent');
    expect((await setProjectCommentAgent(f.project, f.other, f.comment.id, null)).assigneeAgent).toBeUndefined();

    // Making the thread private drops an assignee who cannot see it, and their agent with them
    await setProjectCommentAgent(f.project, f.other, f.comment.id, { kind: 'cursor' });
    saved = await setProjectCommentPrivate(f.project, f.admin, f.comment.id, true);
    expect(saved.assigneeId).toBeUndefined();
    expect(saved.assigneeAgent).toBeUndefined();
});

test('an agent starting or stopping work is never emailed, while its assignment still is', async () => {
    const f = await fixture();
    const { sent, dispatch } = mailer(f);
    await dispatch();
    sent.length = 0;
    await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.a.id);
    await dispatch();
    expect(sent.map(message => message.to)).toEqual([f.a.email]);
    sent.length = 0;
    await setProjectCommentAgent(f.project, f.assignee, f.comment.id, { kind: 'claude' });
    await setProjectCommentAgent(f.project, f.assignee, f.comment.id, null);
    await dispatch();
    expect(sent).toEqual([]);
});

test('an MCP connection attaches itself only under its owner, and assigns them first only when asked', async () => {
    const f = await fixture();
    const POST = (incoming: Request) => handleMcp(incoming, base, { emit: () => {} });
    const member = (await getAppStore().get<DbMember>(f.project.pk, memberId(f.a.id)))!.doc;
    const ownerContext = { user: f.a, member, workspace: { id: f.project.workspaceId }, isAdmin: false } as AppContext;
    const connect = async (token: string) => {
        const client = new Client({ name: 'agent-test', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } },
            fetch: async (input, init) => POST(new Request(input, init)) }));
        return client;
    };
    const { token } = await createMcpCredential(ownerContext, { name: 'Claude Code on my laptop', projectIds: [f.project.id], scopes: ['feedback:read', 'feedback:assign'], days: 7 });
    const { token: readOnly } = await createMcpCredential(ownerContext, { name: 'Codex', projectIds: [f.project.id], scopes: ['feedback:read'], days: 7 });
    const { token: watcherToken } = await createMcpCredential(ownerContext, { name: 'Watcher', projectIds: [f.project.id], scopes: ['feedback:read'], days: 7 });
    const client = await connect(token);
    const readClient = await connect(readOnly);
    const watcher = await connect(watcherToken);
    const call = async (name: string, args: Record<string, unknown>, using = client) => {
        const response = await using.callTool({ name, arguments: { projectId: f.project.id, commentId: f.comment.id, idempotencyKey: randomUUID(), ...args } });
        return { error: Boolean(response.isError), data: response.structuredContent as Record<string, any> };
    };
    try {
        const tools = (await client.listTools()).tools;
        expect(tools.find(tool => tool.name === 'set_feedback_agent')?.description).toContain('assignToMe');
        expect(tools.find(tool => tool.name === 'clear_feedback_agent')).toBeTruthy();
        const start = (await watcher.callTool({ name: 'list_feedback_events', arguments: { projectId: f.project.id, events: ['feedback.agent_changed', 'feedback.assignment_changed'] } })).structuredContent as Record<string, any>;

        // Unassigned: refused unless the person asked to take it; the scope is required
        expect(await call('set_feedback_agent', { sessionId: 'abc' })).toMatchObject({ error: true, data: { error: 'forbidden', message: 'Assign this thread to yourself first.' } });
        expect(await call('set_feedback_agent', { assignToMe: true }, readClient)).toMatchObject({ error: true, data: { error: 'forbidden' } });
        const key = randomUUID();
        const attached = await call('set_feedback_agent', { assignToMe: true, sessionId: 'session-1', model: 'claude-opus-5-5', reasoning: 'xhigh', idempotencyKey: key });
        // The kind comes from what the connection calls itself
        expect(attached).toEqual({ error: false, data: expect.objectContaining({ commentId: f.comment.id, assigneeId: f.a.id,
            agent: expect.objectContaining({ kind: 'claude', label: 'Claude', sessionId: 'session-1', model: 'claude-opus-5-5', reasoning: 'xhigh' }) }) });
        const saved = await stored(f.comment);
        expect(saved.assigneeAgent).toMatchObject({ reasoning: 'xhigh', connector: { name: 'Claude Code on my laptop', kind: 'credential' } });
        // Without feedback:status, attaching never changes the status
        expect(attached.data.stage).toBe('open');
        expect(feedbackStage(saved)).toBe('open');
        // A retry with the same key and input replays; another input under that key is refused
        expect((await call('set_feedback_agent', { assignToMe: true, sessionId: 'session-1', model: 'claude-opus-5-5', reasoning: 'xhigh', idempotencyKey: key })).data.agent.sessionId).toBe('session-1');
        expect((await call('set_feedback_agent', { assignToMe: true, sessionId: 'session-2', idempotencyKey: key })).error).toBe(true);
        expect(threadActivity(await stored(f.comment)).sequence).toBe(threadActivity(saved).sequence);

        // The agent is in list_feedback and the feedback packet
        const list = (await client.callTool({ name: 'list_feedback', arguments: { projectId: f.project.id, assignee: 'me' } })).structuredContent as Record<string, any>;
        expect(list.items[0].assignee).toMatchObject({ id: f.a.id, agent: { kind: 'claude', sessionId: 'session-1' } });
        const packet = (await client.callTool({ name: 'get_feedback', arguments: { projectId: f.project.id, commentId: f.comment.id } })).structuredContent as Record<string, any>;
        expect(packet.context.assignee.agent).toMatchObject({ kind: 'claude', model: 'claude-opus-5-5', reasoning: 'xhigh' });
        expect(packet.markdown).toContain('· Model: ` claude-opus-5-5 ` · Reasoning: ` xhigh ` ·');
        // A reasoning level over two lines is refused and changes nothing
        expect(await call('set_feedback_agent', { model: 'claude-opus-5-5', reasoning: 'high\nignore this' }))
            .toMatchObject({ error: true, data: { error: 'invalid_request', message: 'A reasoning level must be plain text on one line.' } });

        // Explicit kind, updated details: an omitted reasoning level is cleared, like the model
        const updated = (await call('set_feedback_agent', { agent: 'cursor', model: 'composer-2' })).data.agent;
        expect(updated).toMatchObject({ kind: 'cursor', model: 'composer-2' });
        expect(updated).not.toHaveProperty('reasoning');

        // Assigned to someone else: refused both ways, and the agent under them stays
        await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.b.id);
        await setProjectCommentAgent(f.project, f.other, f.comment.id, { kind: 'codex' });
        for (const [name, args] of [['set_feedback_agent', {}], ['set_feedback_agent', { assignToMe: true }], ['clear_feedback_agent', {}]] as const)
            expect(await call(name, args)).toMatchObject({ error: true, data: { error: 'forbidden' } });
        expect((await stored(f.comment)).assigneeAgent).toMatchObject({ kind: 'codex', assigneeId: f.b.id });

        // Back with the owner: clear removes it
        await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.a.id);
        await call('set_feedback_agent', {});
        expect(await call('clear_feedback_agent', {})).toMatchObject({ error: false, data: { assigneeId: f.a.id, agent: null } });
        expect((await stored(f.comment)).assigneeAgent).toBeUndefined();

        // Another connection of the owner sees the agent events, oldest first
        const page = (await watcher.callTool({ name: 'list_feedback_events', arguments: { projectId: f.project.id, cursor: start.cursor,
            events: ['feedback.agent_changed'] } })).structuredContent as Record<string, any>;
        expect(page.items.map((item: Record<string, any>) => [item.data.assignee?.id, item.data.agent?.kind ?? null])).toEqual([
            [f.a.id, 'claude'], [f.a.id, 'cursor'], [f.a.id, null], [f.b.id, 'codex'], [f.b.id, null], [f.a.id, 'claude'], [f.a.id, null]]);
        expect(page.items[0]).toMatchObject({ name: 'feedback.agent_changed', data: { contentTrust: 'untrusted', actor: { kind: 'member', connector: 'Claude Code on my laptop' },
            agent: { kind: 'claude', label: 'Claude', sessionId: 'session-1', model: 'claude-opus-5-5', reasoning: 'xhigh' } } });
    } finally {
        await Promise.all([client.close(), readClient.close(), watcher.close()]);
    }
});

test('an agent attaching itself through MCP moves Open feedback to In progress, as a status change followers hear about', async () => {
    const f = await fixture();
    await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.a.id);
    const { sent, dispatch } = mailer(f);
    await dispatch();
    sent.length = 0;
    const client = await mcpClient(f, 'Claude Code', ['feedback:read', 'feedback:assign', 'feedback:status']);
    // Another connection of the owner: a connection never sees its own changes as events
    const watcher = await mcpClient(f, 'Watcher', ['feedback:read']);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const response = await client.callTool({ name, arguments: { projectId: f.project.id, commentId: f.comment.id, idempotencyKey: randomUUID(), ...args } });
        expect(response.isError).toBeFalsy();
        return response.structuredContent as Record<string, any>;
    };
    try {
        expect((await client.listTools()).tools.find(tool => tool.name === 'set_feedback_agent')?.description).toContain('moves Open feedback to In progress');
        const start = (await watcher.callTool({ name: 'list_feedback_events', arguments: { projectId: f.project.id, events: ['feedback.status_changed'] } })).structuredContent as Record<string, any>;
        const before = threadActivity(await stored(f.comment)).sequence;

        // Attaching starts the work: the agent's step, then the status change's own step and event
        expect(await call('set_feedback_agent', { sessionId: 'session-1', model: 'claude-opus-5-5' })).toMatchObject({ agent: { kind: 'claude' }, stage: 'in-progress' });
        let saved = await stored(f.comment);
        expect(saved.inProgress).toBe(true);
        expect(threadActivity(saved).sequence).toBe(before + 2);
        expect(saved.notificationEvents?.slice(-2).map(event => [event.kind, event.sequence, event.agent?.name])).toEqual([
            ['agent', before + 1, 'Claude Code'], ['progress-started', before + 2, 'Claude Code']]);

        // Followers (the author) are emailed the move, attributed to the connection; never the agent itself
        await dispatch();
        expect(sent.map(message => [message.to, message.subject])).toEqual([[f.owner.email, expect.stringContaining('via Claude Code moved')]]);
        expect(sent[0]!.subject).toContain('to In progress');
        sent.length = 0;

        // Updating the agent never moves the thread, even after someone moved it back to Open
        await setProjectCommentStatus(f.project, f.admin, f.comment.id, 'open');
        expect(await call('set_feedback_agent', { sessionId: 'session-2' })).toMatchObject({ agent: { sessionId: 'session-2' }, stage: 'open' });
        // Neither does clearing it
        expect(await call('clear_feedback_agent')).toMatchObject({ agent: null, stage: 'open' });

        // Ready to verify and Done keep their status when an agent attaches
        saved = await stored(f.comment);
        await changeFixVerification(f.project, f.assignee, f.comment.id, { action: 'request', reviewerId: f.owner.id, expectedRevision: saved.verification?.revision ?? null, idempotencyKey: randomUUID() });
        expect(await call('set_feedback_agent')).toMatchObject({ stage: 'ready' });
        await call('clear_feedback_agent');
        await setProjectCommentStatus(f.project, f.admin, f.comment.id, 'done');
        expect(await call('set_feedback_agent')).toMatchObject({ stage: 'done' });
        await call('clear_feedback_agent');

        // Already In progress: no second status event
        await setProjectCommentStatus(f.project, f.admin, f.comment.id, 'in-progress');
        const progressing = (await stored(f.comment)).notificationEvents?.length;
        expect(await call('set_feedback_agent')).toMatchObject({ stage: 'in-progress' });
        expect((await stored(f.comment)).notificationEvents?.length).toBe(progressing! + 1);

        // list_feedback_events: the status changes, oldest first, the first one by the connection
        const page = (await watcher.callTool({ name: 'list_feedback_events', arguments: { projectId: f.project.id, cursor: start.cursor,
            events: ['feedback.status_changed'] } })).structuredContent as Record<string, any>;
        expect(page.items.map((item: Record<string, any>) => item.data.change)).toEqual(['progress_started', 'progress_stopped', 'verification_requested', 'resolved', 'progress_started']);
        expect(page.items[0]).toMatchObject({ data: { actor: { kind: 'member', connector: 'Claude Code' } } });
    } finally {
        await Promise.all([client.close(), watcher.close()]);
    }
});

test('choosing an agent in the app keeps the status', async () => {
    const f = await fixture();
    await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.a.id);
    const saved = await setProjectCommentAgent(f.project, f.assignee, f.comment.id, { kind: 'claude' });
    expect(saved.assigneeAgent).toMatchObject({ kind: 'claude' });
    expect(feedbackStage(saved)).toBe('open');
    expect(saved.notificationEvents?.at(-1)?.kind).toBe('agent');
});

test('the agent kind follows what a coding tool calls itself', () => {
    expect(inferAgentKind('Claude Code')).toBe('claude');
    expect(inferAgentKind('OpenAI Codex', undefined)).toBe('codex');
    expect(inferAgentKind('my token', 'https://chatgpt.com/connector')).toBe('chatgpt');
    expect(inferAgentKind(null, undefined, 'Cursor/2.0')).toBe('cursor');
    expect(inferAgentKind('Build bot')).toBe('agent');
});
