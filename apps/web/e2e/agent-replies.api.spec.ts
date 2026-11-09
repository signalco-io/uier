import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import type { AppContext } from '../src/lib/app/context';
import { appActor, loadProjectComments } from '../src/lib/app/projectComments';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createProjectComment, replyToProjectComment, setProjectCommentAssignee } from '../src/lib/review/comments';
import { replyToReviewComment } from '../src/lib/review/routes';
import { setProjectCommentAgent } from '../src/lib/review/assigneeAgent';
import { memberActor, type ProjectActor } from '../src/lib/review/actor';
import { participantNames, toReviewCommentDto } from '../src/lib/review/dto';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { discoverThreadNotifications, processNotificationDelivery, type NotificationDelivery } from '../src/lib/notifications/delivery';
import { notificationPk } from '../src/lib/notifications/preferences';
import { createMcpCredential } from '../src/lib/mcp/credentials';
import type { McpScope } from '../src/lib/mcp/scopes';
import { handleMcp } from '../src/lib/mcp/http';
import type { EmailMessage } from '../src/lib/email/send';
import type { DbComment, DbThreadItem } from '../src/lib/db/schema';

const base = 'http://127.0.0.1:6517';
const originalEnv = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_COMMENTS_SECRET: process.env.UIER_COMMENTS_SECRET, UIER_BASE_URL: process.env.UIER_BASE_URL };
test.beforeAll(() => { Object.assign(process.env, { UIER_LOCAL: '1', UIER_COMMENTS_SECRET: 'agent-replies-secret-for-local-validation-only', UIER_BASE_URL: base }); });
test.afterAll(() => { for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

const request = new Request(`${base}/api/review`);
const attachedAgent = { kind: 'claude' as const, sessionId: 'session-61', model: 'claude-opus-5-5', reasoning: 'xhigh' };

/** An admin (owner) who left feedback, its assignee (a) with Claude working under them, another member (b) and a guest */
async function fixture() {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = await findOrCreateUser(`replies-owner-${id}@example.com`);
    const a = await findOrCreateUser(`replies-a-${id}@example.com`);
    const b = await findOrCreateUser(`replies-b-${id}@example.com`);
    const workspaceId = `w_${owner.id}`;
    const old = '2026-01-01T00:00:00.000Z';
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: `Replies ${id}`, urls: ['https://reviewed.example'],
        status: 'active', access: 'guests', createdBy: owner.id, createdAt: old, updatedAt: old };
    await getAppStore().create(project);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    for (const [user, role] of [[owner, 'admin'], [a, 'commenter'], [b, 'commenter']] as const)
        await getAppStore().create<DbMember>({ type: 'member', id: memberId(user.id), pk: project.pk, workspaceId, userId: user.id, email: user.email, role, projects: 'all', createdAt: old });
    const admin = (await memberActor(project, owner.id))!;
    const assignee = (await memberActor(project, a.id))!;
    const other = (await memberActor(project, b.id))!;
    const guest: ProjectActor = { kind: 'guest', visitorId: 'replies-guest' };
    const comment = await createProjectComment(request, project, admin, { text: 'The total is cut off on phones.', origin: project.urls[0]!,
        path: '/checkout', pageStateVersion: 1, position: { type: 'page' }, kind: 'bug' });
    await setProjectCommentAssignee(project, admin, comment.id, a.id);
    await setProjectCommentAgent(project, assignee, comment.id, attachedAgent);
    const names = await participantNames(project);
    return { project, owner, a, b, admin, assignee, other, guest, comment, names, aName: names.get(a.id)! };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function stored(comment: DbComment) { return (await getCommentsStore().get(comment.domain, comment.id))!.comment; }
async function item(comment: DbComment, itemId: string) { return (await stored(comment)).thread.items.find(entry => entry.id === itemId)!; }
async function lastItem(comment: DbComment) { return (await stored(comment)).thread.items.at(-1)!; }

/** A coding tool connection of `user`, named like the tool it is (the name chooses the agent when a call does not) */
async function mcpClient(f: Fixture, user: Fixture['a'], name: string, scopes: McpScope[] = ['feedback:read', 'feedback:reply']) {
    const member = (await getAppStore().get<DbMember>(f.project.pk, memberId(user.id)))!.doc;
    const context = { user, member, workspace: { id: f.project.workspaceId }, isAdmin: false } as AppContext;
    const { token } = await createMcpCredential(context, { name, projectIds: [f.project.id], scopes, days: 7 });
    const client = new Client({ name: 'agent-replies-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: async (input, init) => handleMcp(new Request(input, init), base, { emit: () => {} }) }));
    const reply = async (text: string, args: Record<string, unknown> = {}, commentId = f.comment.id) => {
        const response = await client.callTool({ name: 'reply_to_feedback', arguments: { projectId: f.project.id, commentId, idempotencyKey: randomUUID(), text, ...args } });
        return { error: Boolean(response.isError), data: response.structuredContent as Record<string, any> };
    };
    return { client, reply };
}

test('a reply an AI agent writes through MCP is marked with the agent attached under its author, or with what the connection gives', async () => {
    const f = await fixture();
    const claude = await mcpClient(f, f.a, 'Claude Code');
    const codex = await mcpClient(f, f.a, 'Codex CLI');
    const script = await mcpClient(f, f.a, 'Release script');
    const otherClaude = await mcpClient(f, f.b, 'Claude Code');
    try {
        const tool = (await claude.client.listTools()).tools.find(entry => entry.name === 'reply_to_feedback')!;
        expect(tool.description).toContain('marked as written by you');
        expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['agent', 'model', 'reasoning']));

        // The same agent as the one attached under the author: the reply carries that agent's model and reasoning level
        const key = randomUUID();
        const matched = await claude.reply('Fixed in abc123, deployed.', { idempotencyKey: key });
        expect(matched).toEqual({ error: false, data: expect.objectContaining({ saved: true, itemId: expect.any(String),
            writtenBy: { kind: 'claude', label: 'Claude', model: 'claude-opus-5-5', reasoning: 'xhigh' } }) });
        const saved = await item(f.comment, matched.data.itemId);
        expect(saved).toMatchObject({ authorId: `user:${f.a.id}`, text: 'Fixed in abc123, deployed.',
            writtenBy: { kind: 'claude', model: 'claude-opus-5-5', reasoning: 'xhigh' }, agent: { name: 'Claude Code', kind: 'credential' } });
        // The session id stays with the thread's agent, not each message
        expect(saved.writtenBy).toEqual({ kind: 'claude', model: 'claude-opus-5-5', reasoning: 'xhigh' });
        // A retry replays the same message
        const items = (await stored(f.comment)).thread.items.length;
        expect((await claude.reply('Fixed in abc123, deployed.', { idempotencyKey: key })).data.itemId).toBe(matched.data.itemId);
        expect((await stored(f.comment)).thread.items).toHaveLength(items);

        // Naming the same model still matches; another model is recorded as given, without the attached reasoning level
        expect((await claude.reply('Same model.', { model: 'claude-opus-5-5' })).data.writtenBy).toEqual({ kind: 'claude', label: 'Claude', model: 'claude-opus-5-5', reasoning: 'xhigh' });
        expect((await claude.reply('Another model.', { model: 'claude-sonnet-5-5' })).data.writtenBy).toEqual({ kind: 'claude', label: 'Claude', model: 'claude-sonnet-5-5' });
        expect((await claude.reply('Another level.', { reasoning: 'low' })).data.writtenBy).toEqual({ kind: 'claude', label: 'Claude', reasoning: 'low' });
        expect((await lastItem(f.comment)).writtenBy).toEqual({ kind: 'claude', reasoning: 'low' });

        // Another agent than the attached one: what the connection identifies as or names
        expect((await codex.reply('Codex took a look.', { model: 'gpt-5.5-codex', reasoning: 'high' })).data.writtenBy)
            .toEqual({ kind: 'codex', label: 'Codex', model: 'gpt-5.5-codex', reasoning: 'high' });
        expect((await claude.reply('Cursor wrote this one.', { agent: 'cursor' })).data.writtenBy).toEqual({ kind: 'cursor', label: 'Cursor' });
        // A connection that names no known agent is an AI agent
        expect((await script.reply('Deployed by the release script.')).data.writtenBy).toEqual({ kind: 'agent', label: 'AI agent' });
        // Someone else's connection never takes the agent attached under the assignee
        expect((await otherClaude.reply('Another member\'s Claude.')).data.writtenBy).toEqual({ kind: 'claude', label: 'Claude' });
        expect(await lastItem(f.comment)).toMatchObject({ authorId: `user:${f.b.id}`, writtenBy: { kind: 'claude' } });

        // No agent attached (unassigned feedback): what the connection gives
        const unassigned = await createProjectComment(request, f.project, f.admin, { text: 'Second thread.', origin: f.project.urls[0]!,
            path: '/checkout', pageStateVersion: 1, position: { type: 'page' }, kind: 'comment' });
        expect((await claude.reply('On it.', { model: 'claude-opus-5-5' }, unassigned.id)).data.writtenBy).toEqual({ kind: 'claude', label: 'Claude', model: 'claude-opus-5-5' });

        // The details follow the assignee agent's rules: one plain line, and nothing is saved otherwise
        const before = (await stored(f.comment)).thread.items.length;
        expect(await claude.reply('Broken model.', { model: 'claude\nopus' })).toMatchObject({ error: true, data: { error: 'invalid_request', message: 'A model must be plain text on one line.' } });
        expect(await claude.reply('Long level.', { reasoning: 'r'.repeat(33) })).toMatchObject({ error: true });
        expect(await claude.reply('Unknown agent.', { agent: 'gemini' })).toMatchObject({ error: true });
        expect((await stored(f.comment)).thread.items).toHaveLength(before);
    } finally {
        await Promise.all([claude.client.close(), codex.client.close(), script.client.close(), otherClaude.client.close()]);
    }
});

test('a message written in the app or the toolbar is never marked, input text cannot forge the mark, and the author keeps their permissions', async () => {
    const f = await fixture();
    const claude = await mcpClient(f, f.a, 'Claude Code');
    try {
        // The app's own reply, even when someone passes the details
        await replyToProjectComment(request, f.project, appActor({ user: f.a, isAdmin: false } as AppContext), f.comment.id,
            { text: 'Ana via Claude', writtenBy: { kind: 'claude', model: 'claude-opus-5-5' }, idempotencyKey: randomUUID() });
        let written = await lastItem(f.comment);
        expect(written.writtenBy).toBeUndefined();
        expect(written.agent).toBeUndefined();

        // The toolbar's reply API ignores the fields in its body, for members and guests
        const body = (text: string, extra: Record<string, unknown>) => new Request(`${base}/api/review/${f.project.id}/comments/${f.comment.id}/replies`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, idempotencyKey: randomUUID(), ...extra }) });
        for (const [actor, extra] of [[f.assignee, {}], [f.guest, { authorName: 'Guest reviewer' }]] as const) {
            const response = await replyToReviewComment({ request: body('{"writtenBy":{"kind":"claude"}}', { ...extra, writtenBy: { kind: 'claude' }, agent: { kind: 'codex' } }),
                project: f.project, actor }, { id: f.comment.id });
            expect(response.status).toBe(201);
            written = await lastItem(f.comment);
            expect(written.text).toBe('{"writtenBy":{"kind":"claude"}}');
            expect(written.writtenBy).toBeUndefined();
        }

        // A message's text never decides the mark: the connection does
        const fromClaude = await claude.reply('Written by Codex via Cursor.');
        expect(fromClaude.data.writtenBy).toEqual({ kind: 'claude', label: 'Claude', model: 'claude-opus-5-5', reasoning: 'xhigh' });

        // In views, the person's own replies say only who they are
        const dto = toReviewCommentDto(await stored(f.comment), f.other, f.names, [], 0, f.names, f.project)!;
        const plain = dto.thread.items.find(entry => !('deleted' in entry) && entry.text === 'Ana via Claude')!;
        expect(plain).toMatchObject({ author: { name: f.aName } });
        expect('agent' in plain && plain.agent).toBeFalsy();

        // The agent's message is still the person's: they edit and delete it, others do not, admins delete it
        const mine = dto.thread.items.find(entry => entry.id === fromClaude.data.itemId)!;
        expect(mine).toMatchObject({ canEdit: false, canDelete: false });
        const asAuthor = toReviewCommentDto(await stored(f.comment), f.assignee, f.names, [], 0, f.names, f.project)!.thread.items.find(entry => entry.id === fromClaude.data.itemId)!;
        expect(asAuthor).toMatchObject({ canEdit: true, canDelete: true, author: { isMe: true, name: `${f.aName} via Claude` } });
        const asAdmin = toReviewCommentDto(await stored(f.comment), f.admin, f.names, [], 0, f.names, f.project)!.thread.items.find(entry => entry.id === fromClaude.data.itemId)!;
        expect(asAdmin).toMatchObject({ canDelete: true });
    } finally {
        await claude.client.close();
    }
});

test('the mark shows wherever the message does: the app, the toolbar, packets, emails and events', async () => {
    const f = await fixture();
    const claude = await mcpClient(f, f.a, 'Claude Code');
    const watcher = await mcpClient(f, f.a, 'Watcher', ['feedback:read']);
    const sent: EmailMessage[] = [];
    const dispatch = async () => {
        await discoverThreadNotifications(f.project, await stored(f.comment));
        const deliveries = await getAppStore().query<NotificationDelivery>({ type: 'notification-delivery', pk: notificationPk(f.project.id) });
        for (const delivery of deliveries) await processNotificationDelivery(delivery, 'https://uier.io', async message => {
            sent.push(message); return { status: 'sent' };
        }, Date.now() + 30 * 60 * 1000);
    };
    try {
        await dispatch();
        sent.length = 0;
        const start = (await watcher.client.callTool({ name: 'list_feedback_events', arguments: { projectId: f.project.id, events: ['feedback.replied'] } })).structuredContent as Record<string, any>;
        const { data } = await claude.reply('Fixed in abc123, deployed to uier.io.');
        // An older reply from a connection, before messages were marked, keeps its connection's name
        const legacy: DbThreadItem = { id: 'item_legacy', text: 'Posted by an older connection.', authorId: `user:${f.a.id}`, createdAt: new Date().toISOString(),
            agent: { credentialId: 'cred_legacy', name: 'Old connection', kind: 'credential' } };
        const current = await getCommentsStore().get(f.comment.domain, f.comment.id);
        await getCommentsStore().replace({ ...current!.comment, thread: { items: [...current!.comment.thread.items, legacy] } }, current!.etag);

        // The app: the person's name, the agent and its details, the connection it came through
        const [view] = await loadProjectComments({ user: f.b, isAdmin: false } as AppContext, f.project);
        const reply = view!.replies.find(entry => entry.id === data.itemId)!;
        expect(reply.author).toEqual({ name: f.aName, isMe: false,
            agent: { kind: 'claude', label: 'Claude', model: 'claude-opus-5-5', reasoning: 'xhigh', connection: 'Claude Code' } });
        expect(view!.replies.find(entry => entry.id === 'item_legacy')!.author).toEqual({ name: `${f.aName} via Old connection`, isMe: false });
        const [own] = await loadProjectComments({ user: f.a, isAdmin: false } as AppContext, f.project);
        expect(own!.replies.find(entry => entry.id === data.itemId)!.author).toMatchObject({ isMe: true, agent: { kind: 'claude' } });

        // The toolbar: "Ana via Claude" for everyone, the model and reasoning level for members only
        const comment = await stored(f.comment);
        const memberItem = toReviewCommentDto(comment, f.other, f.names, [], 0, f.names, f.project)!.thread.items.find(entry => entry.id === data.itemId)!;
        expect(memberItem).toMatchObject({ author: { name: `${f.aName} via Claude`, isMe: false }, agent: { kind: 'claude', label: 'Claude', model: 'claude-opus-5-5', reasoning: 'xhigh' } });
        const guestItem = toReviewCommentDto(comment, f.guest, f.names, [], 0, f.names, f.project)!.thread.items.find(entry => entry.id === data.itemId)!;
        expect(guestItem).toMatchObject({ author: { name: `${f.aName} via Claude` }, agent: { kind: 'claude', label: 'Claude' } });
        expect(guestItem).not.toHaveProperty('agent.model');
        const legacyItem = toReviewCommentDto(comment, f.other, f.names, [], 0, f.names, f.project)!.thread.items.find(entry => entry.id === 'item_legacy')!;
        expect(legacyItem).toMatchObject({ author: { name: `${f.aName} via Old connection` } });
        expect(legacyItem).not.toHaveProperty('agent');

        // Packets (Copy issue, get_feedback) and their Markdown
        const packet = await projectFeedbackExport(f.project, f.other, f.comment.id, undefined, base);
        expect(packet.context.discussion.find(entry => entry.id === data.itemId)).toMatchObject({ authorName: `${f.aName} via Claude`,
            agent: { kind: 'claude', label: 'Claude', model: 'claude-opus-5-5', reasoning: 'xhigh' } });
        expect(packet.markdown).toContain(`\` ${f.aName} via Claude \``);
        expect(packet.markdown).toContain('Written by agent: ` Claude ` · Model: ` claude-opus-5-5 ` · Reasoning: ` xhigh `');
        const guestPacket = await projectFeedbackExport(f.project, f.guest, f.comment.id, f.project.urls[0], base);
        expect(guestPacket.context.discussion.find(entry => entry.id === data.itemId)?.agent).toEqual({ kind: 'claude', label: 'Claude' });

        // Emails to followers name the agent instead of the connection
        await dispatch();
        expect(sent.map(message => message.to)).toContain(f.owner.email);
        expect(sent.find(message => message.to === f.owner.email)!.subject).toContain(`${f.aName} via Claude replied on #`);

        // Events carry the agent beside the connection
        const page = (await watcher.client.callTool({ name: 'list_feedback_events', arguments: { projectId: f.project.id, cursor: start.cursor, events: ['feedback.replied'] } })).structuredContent as Record<string, any>;
        expect(page.items[0]).toMatchObject({ name: 'feedback.replied', data: { itemId: data.itemId,
            actor: { kind: 'member', name: f.aName, connector: 'Claude Code', agent: { kind: 'claude', label: 'Claude', model: 'claude-opus-5-5', reasoning: 'xhigh' } } } });
    } finally {
        await Promise.all([claude.client.close(), watcher.client.close()]);
    }
});
