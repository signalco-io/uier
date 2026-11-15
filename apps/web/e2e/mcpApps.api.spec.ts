import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { handleMcp } from '../src/lib/mcp/http';
import { THREAD_CARD_URI, THREAD_CARD_MIME } from '../src/lib/mcp/threadCard';
import { createMcpCredential, revokeMcpCredential } from '../src/lib/mcp/credentials';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import { createProject, updateProject } from '../src/lib/app/projects';
import { defaultStatusWorkflow } from '../src/lib/app/statusWorkflow';
import type { AppContext } from '../src/lib/app/context';
import { memberId, type DbMember } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import { memberActor } from '../src/lib/review/actor';
import { createProjectComment, replyToProjectComment, setProjectCommentPrivate, setProjectCommentWorkflowStatus } from '../src/lib/review/comments';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { getReadSequence } from '../src/lib/comments/readState';
import { parseScreenshot, type ParsedScreenshot } from '../src/lib/comments/screenshot';
import { pngImage } from './support/images';

const base = 'http://127.0.0.1:6514';
const originalEnv = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_COMMENTS_SECRET: process.env.UIER_COMMENTS_SECRET, UIER_BASE_URL: process.env.UIER_BASE_URL };
test.beforeAll(() => { Object.assign(process.env, { UIER_LOCAL: '1', UIER_COMMENTS_SECRET: 'mcp-card-test-secret-for-local-validation-only', UIER_BASE_URL: base }); });
test.afterAll(() => { for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

async function fixture() {
    const user = await findOrCreateUser(`mcp-card-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'Thread card test', urls: ['https://reviewed.example'] });
    const other = await createProject(context, { name: 'Not granted', urls: ['https://other.example'] });
    const actor = (await memberActor(project, user.id))!;
    const comment = await createProjectComment(new Request(base), project, actor, { origin: 'https://reviewed.example', path: '/pricing', kind: 'feedback', position: { type: 'page' }, text: 'The save button fails. <script>untrusted</script>', screenshot: parseScreenshot(pngImage) as ParsedScreenshot });
    return { user, context, project, other, actor, comment };
}

async function connect(token: string, modern = false) {
    // No UI capability: the same tool must remain useful in text-only clients.
    const client = new Client({ name: 'thread-card-test', version: '1.0.0' }, modern ? { versionNegotiation: { mode: 'auto' } } : {});
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: (input, init) => handleMcp(new Request(input, init), base, { emit: () => {} })
    }));
    return client;
}
function data(response: Awaited<ReturnType<Client['callTool']>>) { return response.structuredContent as Record<string, any>; }

for (const modern of [false, true]) {
    test(`thread card discovery and text fallback on ${modern ? '2026' : 'legacy'} MCP`, async () => {
        const f = await fixture();
        const { token } = await createMcpCredential(f.context, { name: 'Read-only card', projectIds: [f.project.id], scopes: ['feedback:read'], days: 7 });
        const client = await connect(token, modern);
        const args = { projectId: f.project.id, commentId: f.comment.id };
        try {
            const tools = (await client.listTools()).tools;
            expect(tools.find(tool => tool.name === 'show_feedback')).toMatchObject({
                annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
                _meta: { ui: { resourceUri: THREAD_CARD_URI } }
            });
            expect(tools.find(tool => tool.name === 'get_feedback')?._meta).toBeUndefined();
            expect((await client.listResources()).resources).toContainEqual(expect.objectContaining({ uri: THREAD_CARD_URI, mimeType: THREAD_CARD_MIME }));
            const resource = (await client.readResource({ uri: THREAD_CARD_URI })).contents[0]!;
            expect(resource).toMatchObject({ uri: THREAD_CARD_URI, mimeType: THREAD_CARD_MIME,
                _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } } } });
            expect('text' in resource && resource.text).toMatch(/<!doctype html>/i);
            const html = 'text' in resource ? resource.text : '';
            for (const secret of [token, f.comment.id, f.project.id, f.user.email, f.comment.thread.items[0]!.text])
                expect(html).not.toContain(secret);
            const before = await getCommentsStore().get(f.comment.domain, f.comment.id);
            const readBefore = await getReadSequence(f.comment.domain, `user:${f.user.id}`, f.comment.id);
            const shown = await client.callTool({ name: 'show_feedback', arguments: args });
            const ordinary = await client.callTool({ name: 'get_feedback', arguments: args });
            expect(shown.isError).not.toBe(true);
            expect(shown).toEqual(ordinary);
            expect(data(shown)).toMatchObject({ contentTrust: 'untrusted', context: { identity: args, status: 'open', links: { comment: expect.stringContaining(f.comment.id) } }, markdown: expect.any(String) });
            expect(shown.content).toEqual([{ type: 'text', text: JSON.stringify(shown.structuredContent) }]);
            expect(data(shown).screenshotResource).toBeUndefined();
            await expect(client.readResource({ uri: `uier://projects/${f.project.id}/feedback/${f.comment.id}/screenshot` })).rejects.toThrow();
            expect(await getCommentsStore().get(f.comment.domain, f.comment.id)).toEqual(before);
            expect(await getReadSequence(f.comment.domain, `user:${f.user.id}`, f.comment.id)).toEqual(readBefore);
        } finally { await client.close(); }
    });
}

test('card refresh gets current custom status and reply without write authority', async () => {
    const f = await fixture();
    const { token } = await createMcpCredential(f.context, { name: 'Read-only refresh', projectIds: [f.project.id], scopes: ['feedback:read'], days: 7 });
    const client = await connect(token);
    const args = { projectId: f.project.id, commentId: f.comment.id };
    try {
        expect(data(await client.callTool({ name: 'show_feedback', arguments: args })).context.stage).toBe('open');
        await updateProject(f.project.workspaceId, f.project.id, { statusWorkflow: { mode: 'replace', value: {
            ...structuredClone(defaultStatusWorkflow), statuses: [...defaultStatusWorkflow.statuses,
                { id: 'custom_approved', category: 'in-progress', label: 'Approved for work', description: 'Implementation approved.' }]
        } } });
        await setProjectCommentWorkflowStatus(f.project, f.actor, f.comment.id, 'custom_approved');
        await replyToProjectComment(new Request(base), f.project, f.actor, f.comment.id, { text: 'Latest reply from the reviewer.' });
        const fresh = data(await client.callTool({ name: 'get_feedback', arguments: args }));
        expect(fresh.workflowStatus).toMatchObject({ id: 'custom_approved', category: 'in-progress', label: 'Approved for work' });
        expect(fresh.context.stage).toBe('in-progress');
        expect(fresh.context.discussion.at(-1).text).toBe('Latest reply from the reviewer.');
        expect(data(await client.callTool({ name: 'set_feedback_status', arguments: { ...args, status: 'done', idempotencyKey: randomUUID() } })).error).toBe('forbidden');
    } finally { await client.close(); }
});

test('card reads recheck project grants, private visibility, membership and revocation', async () => {
    const f = await fixture();
    const reader = await findOrCreateUser(`card-reader-${randomUUID()}@example.com`);
    const member: DbMember = { ...f.context.member, id: memberId(reader.id), userId: reader.id, email: reader.email, role: 'commenter', projects: [f.project.id] };
    await getAppStore().create(member);
    const { token, credential } = await createMcpCredential({ ...f.context, user: reader, member, isAdmin: false },
        { name: 'Reader card', projectIds: [f.project.id], scopes: ['feedback:read'], days: 7 });
    const client = await connect(token);
    const args = { projectId: f.project.id, commentId: f.comment.id };
    const read = (name: string, input = args) => client.callTool({ name, arguments: input });
    try {
        const unreadBefore = await getReadSequence(f.comment.domain, `user:${reader.id}`, f.comment.id);
        expect((await read('show_feedback')).isError).not.toBe(true);
        expect(await getReadSequence(f.comment.domain, `user:${reader.id}`, f.comment.id)).toEqual(unreadBefore);
        expect(data(await read('show_feedback', { ...args, projectId: f.other.id })).error).toBe('not_found');
        await setProjectCommentPrivate(f.project, f.actor, f.comment.id, true);
        for (const tool of ['show_feedback', 'get_feedback']) expect(data(await read(tool)).error).toBe('not_found');
        await setProjectCommentPrivate(f.project, f.actor, f.comment.id, false);
        const membership = (await getAppStore().get<DbMember>(member.pk, member.id))!;
        await getAppStore().replace({ ...membership.doc, projects: [] }, membership.etag);
        for (const tool of ['show_feedback', 'get_feedback']) expect(data(await read(tool)).error).toBe('not_found');
        await getAppStore().replace(membership.doc, (await getAppStore().get(member.pk, member.id))!.etag);
        expect((await read('get_feedback')).isError).not.toBe(true);
        await revokeMcpCredential(reader.id, credential.id);
        await expect(read('show_feedback')).rejects.toThrow();
        await expect(client.readResource({ uri: THREAD_CARD_URI })).rejects.toThrow();
    } finally { await client.close(); }
});
