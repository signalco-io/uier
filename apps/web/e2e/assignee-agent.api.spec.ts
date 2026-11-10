import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { agentSessionLink, inferAgentKind } from '@uier/toolbar/agents';
import { feedbackStage } from '@uier/toolbar/verification';
import { feedbackMarkdown } from '@uier/toolbar/feedback-context';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { projectCommentRouting } from '../src/lib/app/projectCommentRouting';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProjectComment, setProjectCommentAssignee, setProjectCommentAssignees, setProjectCommentPrivate, setProjectCommentStatus } from '../src/lib/review/comments';
import { changeFixVerification } from '../src/lib/review/fixVerification';
import { setProjectCommentAgent, setProjectCommentAgentWorking } from '../src/lib/review/assigneeAgent';
import { assignedAgents, assignedUserIds } from '../src/lib/review/assignments';
import { eventMatches, mcpEventId } from '../src/lib/mcp/events/catalog';
import { loadMyWork } from '../src/lib/app/myWork';
import { agentView, currentAssigneeAgent } from '../src/lib/review/assigneeAgentModel';
import { memberActor, type ProjectActor } from '../src/lib/review/actor';
import { participantNames, toReviewCommentDto } from '../src/lib/review/dto';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { commentRevision } from '../src/lib/review/commentRevision';
import { commitChangeSubmission, submission } from '../src/lib/comments/submissions';
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
async function mcpClient(f: Awaited<ReturnType<typeof fixture>>, name: string, scopes: McpScope[], user = f.a) {
    const member = (await getAppStore().get<DbMember>(f.project.pk, memberId(user.id)))!.doc;
    const ownerContext = { user, member, workspace: { id: f.project.workspaceId }, isAdmin: false } as AppContext;
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
    expect(feedbackMarkdown({ ...packet.context, assignees: undefined, assignee: { name: 'Ana', agent: withoutReasoning } })).toContain('Agent: ` Claude ` · Model: ` claude-opus-5-5 ` · Session: ` session-123 `');
    expect(feedbackMarkdown({ ...packet.context, assignees: undefined, assignee: { name: 'Ana' } })).not.toContain('Agent:');

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

test('desktop session links use a strict route allowlist and stay member-only through attachment edits', async () => {
    const id = '019a0000-1234-5678-9abc-0123456789ab';
    const t3 = 't3-thread://v2/73899553-410d-4b7f-a173-b59773911f2b/thread:delegated-task:command%3Amcp%3A812c3e72-da4d-4c13-9164-67b13508acd6%3Adelegate-task%3Aum-uier00000002-g190-fix-1';
    for (const [url, app] of [[t3, 'T3 Code'], [`t3-thread://v2/local-env/${id}`, 'T3 Code'], [`codex://threads/${id}`, 'Codex'], [`claude://claude.ai/chat/${id}`, 'Claude']])
        expect(agentSessionLink(url)).toEqual({ url, app });
    const invalid = ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/session', 'https://claude.ai/chat/' + id,
        't3-thread://v2//thread', 't3-thread://v2/env/thread/extra', 't3-thread://v2/env/../thread',
        't3-thread://v2/env/%74hread', 't3-thread://user@v2/env/thread', 't3-thread://v2:123/env/thread',
        't3-thread://v2/env/thread?command=run', 't3-thread://v2/env/thread#other', t3 + '\n', ' ' + t3,
        t3 + '\u200b', t3.replace('73899553-410d-4b7f-a173-b59773911f2b', 'a'.repeat(201)), 't3-thread://v2/env/' + 'a'.repeat(600),
        ...['%2F', '%0A', '%2E%2E', '%', '%3a'].map(encoded => `t3-thread://v2/env/thread${encoded}`),
        `t3-thread://v2/env/t${'%3A'.repeat(170)}`,
        't3-thread://v2/env%3Aother/thread', `codex://threads/${id}%3A`, `claude://claude.ai/chat/${id}%3A`,
        'codex://threads/new', 'codex://settings', `codex://threads/${id}?prompt=run`, `codex://threads/${id}/`,
        `claude://claude.ai.evil/chat/${id}`, `claude://claudexai/chat/${id}`, `claude://claude.ai/chat/${id}#x`,
        `claude://code/${id}`, 'claude://code/new', `claude://cowork/${id}`, `claude://claude.ai/project/${id}`];
    const f = await fixture();
    await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.a.id);
    for (const sessionUrl of invalid) {
        expect(agentSessionLink(sessionUrl), sessionUrl).toBeUndefined();
        await expect(setProjectCommentAgent(f.project, f.assignee, f.comment.id, { kind: 'claude', sessionUrl }))
            .rejects.toMatchObject({ code: 'invalid_request' });
    }
    const actor = { ...f.assignee, agent: { credentialId: 'desktop-link-test', name: 'T3 Code', kind: 'credential' as const } } as ProjectActor;
    const key = randomUUID();
    const input = { kind: 'claude' as const, sessionId: 'session', sessionUrl: t3 };
    let saved = await setProjectCommentAgent(f.project, actor, f.comment.id, input, { idempotencyKey: key });
    expect(saved.assigneeAgent).toMatchObject(input);
    expect((await setProjectCommentAgent(f.project, actor, f.comment.id, input, { idempotencyKey: key })).assigneeAgent).toEqual(saved.assigneeAgent);
    await expect(setProjectCommentAgent(f.project, actor, f.comment.id, { ...input, sessionUrl: `codex://threads/${id}` }, { idempotencyKey: key }))
        .rejects.toMatchObject({ code: 'conflict' });
    saved = await setProjectCommentAgentWorking(f.project, actor, f.comment.id, { working: true, sessionId: 'session' }, randomUUID());
    const { setAt, workingUntil } = saved.assigneeAgent!;
    const sequence = threadActivity(saved).sequence;
    expect(threadActivity(await setProjectCommentAgent(f.project, actor, f.comment.id, input)).sequence).toBe(sequence);
    saved = await setProjectCommentAgent(f.project, actor, f.comment.id, { ...input, sessionUrl: `codex://threads/${id}` });
    expect(saved.assigneeAgent).toMatchObject({ sessionUrl: `codex://threads/${id}`, setAt, workingUntil });
    expect(threadActivity(saved).sequence).toBe(sequence + 1);
    expect(saved.history?.at(-1)?.action).toBe('agent-updated');
    const participants = await participantNames(f.project);
    expect(projectCommentRouting(saved, f.project, participants, undefined).assignee?.agent?.sessionUrl).toBe(`codex://threads/${id}`);
    expect(toReviewCommentDto(saved, f.other, new Map(), [], 0, participants)?.assignees?.[0]?.agents?.[0]?.sessionUrl).toBe(`codex://threads/${id}`);
    const guest = toReviewCommentDto(saved, f.guest, new Map(), [], 0, participants);
    expect(JSON.stringify(guest)).not.toContain('sessionUrl');
    expect(JSON.stringify(guest)).not.toContain(id);
    const packet = await projectFeedbackExport(f.project, f.other, f.comment.id, undefined, base);
    expect(packet.context.assignees?.[0]?.agents?.[0]?.sessionUrl).toBe(`codex://threads/${id}`);
    expect(packet.context.assignee?.agent?.sessionUrl).toBe(`codex://threads/${id}`);
    expect(packet.markdown).toContain(`codex://threads/${id}`);
    expect(agentView({ ...saved.assigneeAgent!, sessionUrl: 'javascript:alert(1)' })).not.toHaveProperty('sessionUrl');
    for (const sessionUrl of ['', undefined]) {
        saved = await setProjectCommentAgent(f.project, actor, f.comment.id, { ...input, sessionUrl });
        expect(saved.assigneeAgent).not.toHaveProperty('sessionUrl');
        expect(saved.assigneeAgent).toMatchObject({ setAt, workingUntil });
    }
    // Multiple attachments keep independent session URLs; no old link is inferred for an id-only agent.
    saved = await setProjectCommentAgent(f.project, actor, f.comment.id, input, { add: true, idempotencyKey: randomUUID() });
    expect(assignedAgents(saved).map(agent => agent.sessionUrl)).toEqual([undefined, t3]);
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
        const attached = await call('set_feedback_agent', { assignToMe: true, sessionId: 'session-1', sessionUrl: 't3-thread://v2/local-env/thread-1', model: 'claude-opus-5-5', reasoning: 'xhigh', idempotencyKey: key });
        // The kind comes from what the connection calls itself
        expect(attached).toEqual({ error: false, data: expect.objectContaining({ commentId: f.comment.id, assigneeId: f.a.id,
            agent: expect.objectContaining({ kind: 'claude', label: 'Claude', sessionUrl: 't3-thread://v2/local-env/thread-1', sessionId: 'session-1', model: 'claude-opus-5-5', reasoning: 'xhigh' }) }) });
        const saved = await stored(f.comment);
        expect(saved.assigneeAgent).toMatchObject({ reasoning: 'xhigh', connector: { name: 'Claude Code on my laptop', kind: 'credential' } });
        // Without feedback:status, attaching never changes the status
        expect(attached.data.stage).toBe('open');
        expect(feedbackStage(saved)).toBe('open');
        // A retry with the same key and input replays; another input under that key is refused
        expect((await call('set_feedback_agent', { assignToMe: true, sessionId: 'session-1', sessionUrl: 't3-thread://v2/local-env/thread-1', model: 'claude-opus-5-5', reasoning: 'xhigh', idempotencyKey: key })).data.agent.sessionId).toBe('session-1');
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

        expect(await call('set_feedback_agent', { sessionUrl: 'javascript:alert(1)' })).toMatchObject({ error: true });

        // Explicit kind, updated details: an omitted reasoning level is cleared, like the model
        const updated = (await call('set_feedback_agent', { agent: 'cursor', model: 'composer-2' })).data.agent;
        expect(updated).toMatchObject({ kind: 'cursor', model: 'composer-2' });
        expect(updated).not.toHaveProperty('reasoning');
        expect(updated).not.toHaveProperty('sessionUrl');

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

test('MCP working leases expire, renew and clear without status, unread, integration or notification changes', async () => {
    const f = await fixture();
    const client = await mcpClient(f, 'Claude Code', ['feedback:read', 'feedback:assign']);
    const otherConnection = await mcpClient(f, 'Another Claude session', ['feedback:read', 'feedback:assign']);
    const readOnly = await mcpClient(f, 'Read only', ['feedback:read']);
    const call = async (name: string, args: Record<string, unknown>, using = client) => {
        const response = await using.callTool({ name, arguments: { projectId: f.project.id, commentId: f.comment.id, idempotencyKey: randomUUID(), ...args } });
        return { error: Boolean(response.isError), data: response.structuredContent as Record<string, any> };
    };
    const working = (args: Record<string, unknown> = {}, using = client) => call('set_feedback_agent_working', { working: true, sessionId: 'working-session', ...args }, using);
    try {
        const tool = (await client.listTools()).tools.find(tool => tool.name === 'set_feedback_agent_working')!;
        expect(tool.description).toContain('five-minute lease');
        expect(tool.description).toContain('never changes here');
        expect(tool.inputSchema.required).toContain('working');
        expect(await working()).toMatchObject({ error: true, data: { error: 'forbidden' } });
        expect(await call('set_feedback_agent', { assignToMe: true, sessionId: 'working-session' })).toMatchObject({ error: false, data: { stage: 'open' } });
        const before = await stored(f.comment);
        const revision = (await getCommentsStore().listRealtime(f.comment.domain)).find(row => row.id === f.comment.id)!.revision;
        expect(await working({}, readOnly)).toMatchObject({ error: true, data: { error: 'forbidden' } });
        expect(await working({}, otherConnection)).toMatchObject({ error: true, data: { error: 'conflict' } });
        expect(await working({ sessionId: 'stale-session' })).toMatchObject({ error: true, data: { error: 'conflict' } });
        expect(await working({ sessionId: undefined })).toMatchObject({ error: true, data: { error: 'conflict' } });
        expect(await working({ working: 'yes' })).toMatchObject({ error: true });
        const key = randomUUID();
        const started = await working({ idempotencyKey: key });
        expect(started).toMatchObject({ error: false, data: { stage: 'open', agent: { kind: 'claude', workingUntil: expect.any(String) } } });
        const until = started.data.agent.workingUntil;
        expect(Date.parse(until) - Date.now()).toBeGreaterThan(290_000);
        expect(Date.parse(until) - Date.now()).toBeLessThanOrEqual(300_000);
        expect((await working({ idempotencyKey: key })).data.agent.workingUntil).toBe(until);
        expect(await working({ working: false, idempotencyKey: key })).toMatchObject({ error: true, data: { error: 'conflict' } });
        const active = await stored(f.comment);
        expect(threadActivity(active)).toEqual(threadActivity(before));
        expect(active.notificationEvents).toEqual(before.notificationEvents);
        expect(active.syncVersion).toBe(before.syncVersion);
        expect(active.updatedAt).toBe(before.updatedAt);
        expect(commentRevision(active)).toBe(commentRevision(before));
        expect((await getCommentsStore().listRealtime(f.comment.domain)).find(row => row.id === f.comment.id)!.revision).not.toBe(revision);
        const participants = await participantNames(f.project);
        expect(projectCommentRouting(active, f.project, participants, `user:${f.a.id}`).assignee?.agent?.workingUntil).toBe(until);
        expect(toReviewCommentDto(active, f.assignee, new Map(), [], 0, participants)?.assignee?.agent?.workingUntil).toBe(until);
        expect(toReviewCommentDto(active, f.guest, new Map(), [], 0, participants)?.assignee).not.toHaveProperty('agent');
        const list = (await client.callTool({ name: 'list_feedback', arguments: { projectId: f.project.id } })).structuredContent as Record<string, any>;
        expect(list.items[0].assignee.agent.workingUntil).toBe(until);
        const { sent, dispatch } = mailer(f);
        await dispatch(); // existing assignment may send mail, the lease has no event
        sent.length = 0;
        const renewed = await working();
        expect(Date.parse(renewed.data.agent.workingUntil)).toBeGreaterThan(Date.parse(until));
        await dispatch();
        expect(sent).toEqual([]);
        expect(await working({ working: false })).toMatchObject({ error: false, data: { stage: 'open', agent: { kind: 'claude' } } });
        expect((await stored(f.comment)).assigneeAgent?.workingUntil).toBeUndefined();
        // Replaying a previous start cannot undo a clear or extend an old lease.
        expect((await working({ idempotencyKey: key })).data.agent).not.toHaveProperty('workingUntil');
        await working();
        const expired = await stored(f.comment);
        const entry = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
        await getCommentsStore().replace({ ...expired, assigneeAgent: { ...expired.assigneeAgent!, workingUntil: new Date(Date.now() - 1).toISOString() }, assigneeAgents: expired.assigneeAgents!.map(agent => ({ ...agent, workingUntil: new Date(Date.now() - 1).toISOString() })) }, entry.etag);
        const expiredList = (await client.callTool({ name: 'list_feedback', arguments: { projectId: f.project.id } })).structuredContent as Record<string, any>;
        expect(expiredList.items[0].assignee.agent).not.toHaveProperty('workingUntil');
        expect(expiredList.items[0].assignee.agent.kind).toBe('claude');
        expect((await working()).data.agent.workingUntil).toBeTruthy();
        // Same session details retain the lease; replacing a session ends it and refuses late stop/renewal.
        await call('set_feedback_agent', { sessionId: 'working-session', model: 'claude-opus-5-5' });
        expect((await stored(f.comment)).assigneeAgent?.workingUntil).toBeTruthy();
        await call('set_feedback_agent', { sessionId: 'new-session' });
        expect((await stored(f.comment)).assigneeAgent?.workingUntil).toBeUndefined();
        expect(await working({ working: false })).toMatchObject({ error: true, data: { error: 'conflict' } });
        await working({ sessionId: 'new-session' });
        // A different connection with identical details replaces the attachment and ends its lease too.
        await call('set_feedback_agent', { agent: 'claude', sessionId: 'new-session' }, otherConnection);
        expect((await stored(f.comment)).assigneeAgent?.workingUntil).toBeUndefined();
        expect(await working({ sessionId: 'new-session' })).toMatchObject({ error: true, data: { error: 'conflict' } });
        await working({ sessionId: 'new-session' }, otherConnection);
        await call('clear_feedback_agent', {}, otherConnection);
        expect((await stored(f.comment)).assigneeAgent).toBeUndefined();
        expect(await working({ sessionId: 'new-session' }, otherConnection)).toMatchObject({ error: true, data: { error: 'conflict' } });
        // None of the four stages is changed by presence start or stop.
        for (const stage of ['open', 'in-progress', 'done', 'ready'] as const) {
            if (stage === 'ready') {
                const saved = await stored(f.comment);
                await changeFixVerification(f.project, f.assignee, f.comment.id, { action: 'request', reviewerId: f.owner.id, expectedRevision: saved.verification?.revision ?? null, idempotencyKey: randomUUID() });
            } else await setProjectCommentStatus(f.project, f.admin, f.comment.id, stage);
            await call('set_feedback_agent', { sessionId: 'working-session' });
            expect((await working()).data.stage).toBe(stage);
            expect((await working({ working: false })).data.stage).toBe(stage);
        }
        await working();
        await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.b.id);
        expect((await stored(f.comment)).assigneeAgent).toBeUndefined();
        expect(await working()).toMatchObject({ error: true, data: { error: 'forbidden' } });
    } finally { await Promise.all([client.close(), otherConnection.close(), readOnly.close()]); }
});


test('working presence rechecks the attachment after a conditional-write conflict and ends on lost private access', async () => {
    const f = await fixture();
    const actor = { ...f.assignee, agent: { credentialId: 'fixture-connector', name: 'Codex', kind: 'credential' as const } };
    const input = { working: true, sessionId: 'first-session' };
    await setProjectCommentAssignee(f.project, f.admin, f.comment.id, f.a.id);
    await setProjectCommentAgent(f.project, actor, f.comment.id, { kind: 'codex', sessionId: 'first-session' });
    for (const forbidden of [f.guest, f.other, f.admin, { kind: 'anonymous' } as ProjectActor])
        await expect(setProjectCommentAgentWorking(f.project, forbidden, f.comment.id, input, randomUUID())).rejects.toMatchObject({ code: 'forbidden' });
    await expect(setProjectCommentAgentWorking(f.project, actor, f.comment.id, { working: 'yes' } as never, randomUUID())).rejects.toMatchObject({ code: 'invalid_request' });
    const store = getCommentsStore();
    let raced = false;
    const conflictStore = { ...store, commitSubmission: async (...args: Parameters<typeof store.commitSubmission>) => {
        if (!raced) {
            raced = true;
            await setProjectCommentAgent(f.project, actor, f.comment.id, { kind: 'codex', sessionId: 'replacement-session' });
        }
        return store.commitSubmission(...args);
    } };
    await expect(setProjectCommentAgentWorking(f.project, actor, f.comment.id, input, randomUUID(), conflictStore)).rejects.toMatchObject({ code: 'conflict' });
    expect((await stored(f.comment)).assigneeAgent).toMatchObject({ sessionId: 'replacement-session' });
    expect((await stored(f.comment)).assigneeAgent?.workingUntil).toBeUndefined();
    await setProjectCommentAgentWorking(f.project, actor, f.comment.id, { working: true, sessionId: 'replacement-session' }, randomUUID());
    const saved = await setProjectCommentPrivate(f.project, f.admin, f.comment.id, true);
    expect(saved.assigneeId).toBeUndefined();
    expect(saved.assigneeAgent).toBeUndefined();
    await expect(setProjectCommentAgentWorking(f.project, actor, f.comment.id, { working: false, sessionId: 'replacement-session' }, randomUUID()))
        .rejects.toMatchObject({ code: 'not_found' });
});

test('legacy assignments read without migration; membership changes retain each remaining person and their agents', async () => {
    const f = await fixture();
    const entry = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
    const legacy = { ...entry.comment, assigneeId: f.a.id, assigneeAgent: { kind: 'claude' as const, assigneeId: f.a.id, setBy: f.a.id, setAt: '2026-01-01T00:00:00.000Z', sessionId: 'legacy' } };
    await getCommentsStore().replace(legacy, entry.etag);
    const names = await participantNames(f.project);
    expect(projectCommentRouting(legacy, f.project, names, undefined).assignees).toMatchObject([{ id: f.a.id, agents: [{ kind: 'claude', sessionId: 'legacy' }] }]);
    expect(toReviewCommentDto(legacy, f.other, names, [], 0, names)?.assignees).toMatchObject([{ id: f.a.id, agents: [{ kind: 'claude' }] }]);
    const current = await setProjectCommentAssignees(f.project, f.admin, f.comment.id, [f.b.id], 'add');
    expect(assignedUserIds(current)).toEqual([f.a.id, f.b.id]);
    expect(eventMatches('feedback.assignment_changed', { projectId: f.project.id, assignee: 'me' }, current.notificationEvents!.at(-1)!, f.comment.id, f.a.id)).toBe(false);
    expect(eventMatches('feedback.assignment_changed', { projectId: f.project.id, assignee: 'me' }, current.notificationEvents!.at(-1)!, f.comment.id, f.b.id)).toBe(true);
    expect(assignedAgents(current)).toMatchObject([{ assigneeId: f.a.id, sessionId: 'legacy' }]);
    await setProjectCommentAgent(f.project, f.other, f.comment.id, { kind: 'cursor', sessionId: 'b' });
    await setProjectCommentAgent(f.project, f.assignee, f.comment.id, { kind: 'codex', sessionId: 'second' }, { add: true, idempotencyKey: randomUUID() });
    let saved = await stored(f.comment);
    expect(assignedAgents(saved).map(agent => [agent.assigneeId, agent.kind])).toEqual([[f.a.id, 'claude'], [f.b.id, 'cursor'], [f.a.id, 'codex']]);
    const routing = projectCommentRouting(saved, f.project, names, undefined);
    expect(routing.assignees.map(person => person.agents.map(agent => agent.kind))).toEqual([['claude', 'codex'], ['cursor']]);
    const guest = toReviewCommentDto(saved, f.guest, names, [], 0, names)!;
    expect(guest.assignees).toHaveLength(2);
    for (const person of guest.assignees!) {
        expect(person).not.toHaveProperty('id'); expect(person).not.toHaveProperty('agent'); expect(person).not.toHaveProperty('agents');
    }
    const packet = await projectFeedbackExport(f.project, f.other, f.comment.id, undefined, base);
    expect(packet.context.assignees?.map(person => person.agents?.map(agent => agent.kind))).toEqual([['claude', 'codex'], ['cursor']]);
    expect(packet.markdown).toContain('Session: ` legacy `');
    expect(packet.markdown).toContain('Session: ` second `');
    const member = (await getAppStore().get<DbMember>(f.project.pk, memberId(f.b.id)))!.doc;
    const work = await loadMyWork({ user: f.b, member, workspace: { id: f.project.workspaceId }, isAdmin: false } as AppContext);
    expect(work.assigned.map(item => item.comment.id)).toContain(f.comment.id);
    saved = await setProjectCommentAssignees(f.project, f.admin, f.comment.id, [f.a.id], 'remove');
    expect(assignedUserIds(saved)).toEqual([f.b.id]);
    expect(assignedAgents(saved)).toMatchObject([{ assigneeId: f.b.id, kind: 'cursor' }]);
    expect(saved.notificationEvents?.slice(-2).map(event => [event.kind, event.assigneeId, event.assigneeAgent])).toEqual([
        ['agent', f.a.id, null], ['agent', f.a.id, null]]);
    const removals = saved.notificationEvents!.slice(-2);
    expect(new Set(removals.map(event => mcpEventId(f.project.id, saved.id, event, 'feedback.agent_changed'))).size).toBe(2);
    // Private visibility removes only those who lose access; the admin keeps their agents.
    await setProjectCommentAssignees(f.project, f.admin, f.comment.id, [f.owner.id], 'add');
    await setProjectCommentAgent(f.project, f.admin, f.comment.id, { kind: 'codex' });
    saved = await setProjectCommentPrivate(f.project, f.admin, f.comment.id, true);
    expect(assignedUserIds(saved)).toEqual([f.owner.id]);
    expect(assignedAgents(saved)).toMatchObject([{ assigneeId: f.owner.id, kind: 'codex' }]);
});

test('atomic concurrent assignment and agent additions survive retries; changes notify only the people added or removed', async () => {
    const f = await fixture();
    const { sent, dispatch } = mailer(f);
    await dispatch(); sent.length = 0;
    await Promise.all([f.a.id, f.b.id].map(id => setProjectCommentAssignees(f.project, f.admin, f.comment.id, [id], 'add', randomUUID())));
    expect(new Set(assignedUserIds(await stored(f.comment)))).toEqual(new Set([f.a.id, f.b.id]));
    await dispatch();
    expect(sent.map(message => message.to).sort()).toEqual([f.a.email, f.b.email].sort());
    expect(sent.every(message => message.subject.includes('assigned') && message.text.includes('to you'))).toBe(true);
    sent.length = 0;
    await Promise.all(['one', 'two'].map(sessionId => setProjectCommentAgent(f.project, f.assignee, f.comment.id, { kind: 'claude', sessionId }, { add: true, idempotencyKey: randomUUID() })));
    expect(assignedAgents(await stored(f.comment)).map(agent => agent.sessionId).sort()).toEqual(['one', 'two']);
    await dispatch(); expect(sent).toEqual([]);
    await setProjectCommentAssignees(f.project, f.admin, f.comment.id, [f.a.id], 'remove');
    await dispatch();
    expect(sent.map(message => message.to)).toEqual([f.a.email]);
    expect(sent[0]!.subject).toContain('unassigned');
    expect(assignedUserIds(await stored(f.comment))).toEqual([f.b.id]);
    for (const actor of [f.guest, { kind: 'anonymous' } as ProjectActor])
        await expect(setProjectCommentAssignees(f.project, actor, f.comment.id, [f.a.id], 'add')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(setProjectCommentAssignees(f.project, f.admin, f.comment.id, [f.a.id, f.a.id])).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(setProjectCommentAssignees(f.project, f.admin, f.comment.id, ['user_missing'])).rejects.toMatchObject({ code: 'invalid_request' });
});

test('MCP multiple assignees and agent ids isolate each person, attachment and working lease while single calls still work', async () => {
    const f = await fixture();
    const a = await mcpClient(f, 'Codex', ['feedback:read', 'feedback:assign']);
    const b = await mcpClient(f, 'Claude', ['feedback:read', 'feedback:assign'], f.b);
    const otherConnection = await mcpClient(f, 'Other Codex', ['feedback:read', 'feedback:assign']);
    const watcher = await mcpClient(f, 'Watcher', ['feedback:read']);
    const call = async (client: Client, name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: { projectId: f.project.id, commentId: f.comment.id, idempotencyKey: randomUUID(), ...args } });
        return { error: Boolean(response.isError), data: response.structuredContent as Record<string, any> };
    };
    try {
        // Legacy assignment replaces all; arrays can add or remove without dropping other people.
        expect(await call(a, 'assign_feedback', { assigneeId: f.a.id })).toMatchObject({ error: false });
        expect(await call(a, 'assign_feedback', { assigneeIds: [f.b.id], mode: 'add' })).toMatchObject({ error: false, data: { assigneeIds: [f.a.id, f.b.id] } });
        expect(await call(a, 'assign_feedback', { assigneeId: f.a.id, assigneeIds: [] })).toMatchObject({ error: true, data: { error: 'invalid_request' } });
        const first = (await call(a, 'set_feedback_agent', { sessionId: 'a-one' })).data.agent;
        const addKey = randomUUID();
        const second = (await call(a, 'set_feedback_agent', { agent: 'cursor', sessionId: 'a-two', add: true, idempotencyKey: addKey })).data.agent;
        expect(first.id).not.toBe(second.id);
        expect((await call(a, 'set_feedback_agent', { agent: 'cursor', sessionId: 'a-two', add: true, idempotencyKey: addKey })).data.agents).toHaveLength(2);
        const bAgent = (await call(b, 'set_feedback_agent', { sessionId: 'b-one' })).data.agent;
        expect((await call(b, 'set_feedback_agent', { agentId: first.id })).error).toBe(true);
        expect((await call(b, 'clear_feedback_agent', { agentId: first.id })).error).toBe(true);
        expect((await call(b, 'set_feedback_agent_working', { agentId: first.id, sessionId: 'a-one', working: true })).error).toBe(true);
        const before = await stored(f.comment);
        const revision = commentRevision(before);
        const aLease = await call(a, 'set_feedback_agent_working', { agentId: second.id, sessionId: 'a-two', working: true });
        expect(aLease).toMatchObject({ error: false, data: { agent: { id: second.id, workingUntil: expect.any(String) } } });
        expect(await call(b, 'set_feedback_agent_working', { sessionId: 'b-one', working: true })).toMatchObject({ error: false });
        expect(await call(otherConnection, 'set_feedback_agent_working', { agentId: second.id, sessionId: 'a-two', working: false })).toMatchObject({ error: true, data: { error: 'conflict' } });
        let saved = await stored(f.comment);
        expect(commentRevision(saved)).toBe(revision);
        expect(threadActivity(saved)).toEqual(threadActivity(before));
        expect(saved.notificationEvents).toEqual(before.notificationEvents);
        expect(assignedAgents(saved).filter(agent => agent.workingUntil)).toHaveLength(2);
        // Two connections may report the same session name: a legacy working call still returns its own attachment.
        const parallel = (await call(otherConnection, 'set_feedback_agent', { add: true, sessionId: 'a-one' })).data.agent;
        expect(await call(otherConnection, 'set_feedback_agent_working', { sessionId: ' a-one ', working: true }))
            .toMatchObject({ error: false, data: { agent: { id: parallel.id, workingUntil: expect.any(String) } } });
        await call(otherConnection, 'clear_feedback_agent', { agentId: parallel.id });
        // List filters include a later assignee, including 'me'.
        for (const [client, assignee] of [[a, f.b.id], [b, 'me']] as const) {
            const result = await client.callTool({ name: 'list_feedback', arguments: { projectId: f.project.id, assignee } });
            const data = result.structuredContent as Record<string, any>;
            expect(data.items[0].assignees.map((person: any) => person.id)).toEqual([f.a.id, f.b.id]);
        }
        expect(await call(a, 'clear_feedback_agent', { agentId: second.id })).toMatchObject({ error: false, data: { agent: null, agents: [{ id: first.id }] } });
        saved = await stored(f.comment);
        expect(assignedAgents(saved).find(agent => agent.id === bAgent.id)?.workingUntil).toBeTruthy();
        expect(await call(a, 'set_feedback_agent_working', { agentId: second.id, sessionId: 'a-two', working: true })).toMatchObject({ error: true, data: { error: 'conflict' } });
        // Default calls on the later assignee affect only their first agent.
        expect(await call(b, 'clear_feedback_agent', {})).toMatchObject({ error: false, data: { agent: null } });
        expect(assignedAgents(await stored(f.comment)).map(agent => agent.id)).toEqual([first.id]);
        const start = (await watcher.callTool({ name: 'list_feedback_events', arguments: { projectId: f.project.id, events: ['feedback.assignment_changed'] } })).structuredContent as Record<string, any>;
        await call(a, 'assign_feedback', { assigneeIds: [f.b.id], mode: 'remove' });
        await call(a, 'assign_feedback', { assigneeIds: [f.a.id], mode: 'remove' });
        const events = (await watcher.callTool({ name: 'list_feedback_events', arguments: { projectId: f.project.id, cursor: start.cursor, events: ['feedback.assignment_changed'] } })).structuredContent as Record<string, any>;
        const removal = (await stored(f.comment)).notificationEvents!.filter(event => event.kind === 'assignment').at(-1)!;
        expect(eventMatches('feedback.assignment_changed', { projectId: f.project.id, assignee: 'me' }, removal, f.comment.id, f.a.id)).toBe(false);
        expect(events.items.at(-1).data).toMatchObject({ assignees: [], previousAssigneeIds: [f.a.id] });
        expect(await call(a, 'assign_feedback', { assigneeId: f.b.id })).toMatchObject({ error: false, data: { assigneeIds: [f.b.id] } });
        expect(assignedAgents(await stored(f.comment))).toEqual([]);
    } finally { await Promise.all([a.close(), b.close(), otherConnection.close(), watcher.close()]); }
});


test('legacy assignment and agent receipts still replay after the multi-assignee change, and legacy leases do not migrate content', async () => {
    const f = await fixture();
    const store = getCommentsStore();
    const key = randomUUID();
    const actorId = `user:${f.a.id}`;
    await commitChangeSubmission(store, submission(f.comment.domain, actorId, key, { operation: 'assignment', id: f.comment.id, assigneeId: f.a.id })!, f.comment.id,
        async () => {}, async comment => ({ ...comment, assigneeId: f.a.id }));
    const replay = await setProjectCommentAssignee(f.project, f.assignee, f.comment.id, f.a.id, key);
    expect(replay.assigneeIds).toBeUndefined();
    const agentKey = randomUUID();
    const desired = { kind: 'codex' as const, sessionId: 'legacy-session' };
    const connector = { credentialId: 'legacy-connection', name: 'Codex' };
    await commitChangeSubmission(store, submission(f.comment.domain, actorId, agentKey, { operation: 'agent', id: f.comment.id, agent: desired, assignToMe: false })!, f.comment.id,
        async () => {}, async comment => ({ ...comment, assigneeAgent: { ...desired, assigneeId: f.a.id, setBy: f.a.id, setAt: '2026-01-01T00:00:00.000Z', connector } }));
    const actor = { ...f.assignee, agent: connector };
    const attached = await setProjectCommentAgent(f.project, actor, f.comment.id, desired, { idempotencyKey: agentKey });
    expect(attached.assigneeAgents).toBeUndefined();
    const working = await setProjectCommentAgentWorking(f.project, actor, f.comment.id, { working: true, sessionId: 'legacy-session' }, randomUUID());
    expect(working.assigneeAgent?.workingUntil).toBeTruthy();
    expect(working.assigneeIds).toBeUndefined();
    expect(working.assigneeAgents).toBeUndefined();
    expect(commentRevision(working)).toBe(commentRevision(attached));
    expect(threadActivity(working)).toEqual(threadActivity(attached));
});
