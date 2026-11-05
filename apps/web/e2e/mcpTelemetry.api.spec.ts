import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { handleMcp } from '../src/lib/mcp/http';
import { mcpRequestEventSchema, type McpRequestEvent } from '../src/lib/mcp/telemetry';
import { createMcpCredential } from '../src/lib/mcp/credentials';
import type { McpScope } from '../src/lib/mcp/scopes';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import { createProject } from '../src/lib/app/projects';
import type { AppContext } from '../src/lib/app/context';
import { createProjectComment } from '../src/lib/review/comments';
import { memberActor } from '../src/lib/review/actor';

const originalEnv = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_COMMENTS_SECRET: process.env.UIER_COMMENTS_SECRET, UIER_BASE_URL: process.env.UIER_BASE_URL };
const base = 'http://127.0.0.1:6515';
test.beforeAll(() => { Object.assign(process.env, { UIER_LOCAL: '1', UIER_COMMENTS_SECRET: 'mcp-telemetry-secret-for-local-validation-only', UIER_BASE_URL: base }); });
test.afterAll(() => { for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

async function fixture(scopes: McpScope[] = ['feedback:read']) {
    const user = await findOrCreateUser(`mcp-log-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'PRIVATE_PROJECT_NAME', urls: ['https://reviewed.example'] });
    const actor = (await memberActor(project, user.id))!;
    const comment = await createProjectComment(new Request(base), project, actor, { origin: 'https://reviewed.example', path: '/pricing', kind: 'feedback',
        position: { type: 'page' }, text: 'PRIVATE_FEEDBACK_TEXT is broken' });
    const { token, credential } = await createMcpCredential(context, { name: 'PRIVATE_CONNECTION_NAME', projectIds: [project.id], scopes, days: 7 });
    return { user, project, comment, token, credential };
}
function recorder() {
    const events: McpRequestEvent[] = [];
    return { events, handle: (request: Request, deadlineMs = 25_000) => handleMcp(request, base, { deadlineMs, emit: event => events.push(event) }) };
}
async function connect(token: string, handle: (request: Request) => Promise<Response>) {
    const client = new Client({ name: 'telemetry-test-client', version: '1.2.3' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } }, fetch: async (input, init) => handle(new Request(input, init)) }));
    return client;
}
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(`${base}/api/mcp`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
const toolCalls = (events: McpRequestEvent[]) => events.flatMap(event => event.calls)
    .filter(call => !['initialize', 'notifications/initialized'].includes(call.method));
function expectNothingPrivate(events: McpRequestEvent[], f: Awaited<ReturnType<typeof fixture>>, ...values: string[]) {
    for (const event of events) expect(mcpRequestEventSchema.safeParse(event).success).toBe(true);
    const logged = JSON.stringify(events);
    for (const value of ['PRIVATE', f.project.id, f.comment.id, f.token, f.user.id, f.user.email, f.credential.id, ...values])
        expect(logged).not.toContain(value);
}

test('each request logs its calls, outcomes, argument shapes and result sizes without content or identifiers', async () => {
    const f = await fixture();
    const { events, handle } = recorder();
    const client = await connect(f.token, handle);
    try {
        expect((await client.callTool({ name: 'list_feedback', arguments: { projectId: f.project.id, search: 'broken', status: 'open', limit: 5 } })).isError).toBeFalsy();
        expect((await client.callTool({ name: 'get_feedback', arguments: { projectId: f.project.id, commentId: f.comment.id } })).isError).toBeFalsy();
        await client.callTool({ name: 'get_feedback_batch', arguments: { projectId: f.project.id, commentIds: [f.comment.id, 'missing_comment'] } });
    } finally { await client.close(); }
    expectNothingPrivate(events, f, 'broken', 'missing_comment');

    const initialize = events.find(event => event.calls[0]?.method === 'initialize');
    expect(initialize).toMatchObject({ event: 'mcp_request', version: 1, environment: 'local', httpMethod: 'POST', status: 200, outcome: 'handled',
        client: { name: 'telemetry-test-client', version: '1.2.3' }, protocolVersion: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        connection: { kind: 'credential', scopes: ['feedback:read'], access: 'selected' } });
    expect(events.find(event => event.calls[0]?.method === 'notifications/initialized')?.calls).toEqual([{ method: 'notifications/initialized', outcome: 'accepted' }]);
    // A keyed reference ties every request of one connection together.
    expect(new Set(events.map(event => event.connection?.ref))).toEqual(new Set([initialize!.connection!.ref]));
    expect(new Set(events.map(event => event.connection?.user))).toEqual(new Set([initialize!.connection!.user]));

    const [list, read, batch] = toolCalls(events);
    expect(list).toEqual({ method: 'tools/call', name: 'list_feedback', outcome: 'success',
        arguments: { projectId: { type: 'string', length: 12 }, search: { type: 'string', length: 6 }, status: 'open', limit: 5 },
        result: { bytes: expect.any(Number), items: 1, more: false } });
    expect(read).toMatchObject({ name: 'get_feedback', outcome: 'success', arguments: { commentId: { type: 'string', length: f.comment.id.length } } });
    expect(read!.result!.bytes).toBeGreaterThan(100);
    expect(batch).toMatchObject({ name: 'get_feedback_batch', outcome: 'success', arguments: { commentIds: { type: 'array', length: 2 } },
        result: { items: 2, remaining: 0, itemErrors: { not_found: 1 } } });
});

test('failed calls record why they failed: arguments, scopes, access, unknown names and protocol errors', async () => {
    const f = await fixture();
    const { events, handle } = recorder();
    const client = await connect(f.token, handle);
    try {
        await client.callTool({ name: 'list_feedback', arguments: { projectId: f.project.id, limit: 100, query: 'PRIVATE_SEARCH' } });
        await client.callTool({ name: 'get_feedback', arguments: { projectId: f.project.id, comment_id: f.comment.id } });
        await client.callTool({ name: 'reply_to_feedback', arguments: { projectId: f.project.id, commentId: f.comment.id, text: 'PRIVATE_REPLY', idempotencyKey: randomUUID() } });
        await client.callTool({ name: 'get_feedback', arguments: { projectId: 'zzzzzzzzzzzz', commentId: f.comment.id } });
        await client.callTool({ name: 'create_feedback', arguments: { text: 'PRIVATE_SEARCH' } });
        await expect(client.getPrompt({ name: 'summarize-feedback', arguments: {} })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
        await expect(client.getPrompt({ name: 'triage-feedback', arguments: { projectId: 'zzzzzzzzzzzz' } })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
        await expect(client.readResource({ uri: 'uier://PRIVATE_SEARCH' })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    } finally { await client.close(); }
    expectNothingPrivate(events, f);
    const projectId = { type: 'string', length: 12 };
    const calls = toolCalls(events);
    expect(calls).toHaveLength(8);
    expect(calls[0]).toEqual({ method: 'tools/call', name: 'list_feedback', outcome: 'tool_error', error: 'invalid_arguments',
        arguments: { projectId, limit: 100 }, unknownArguments: ['query'], result: { bytes: expect.any(Number) },
        issues: expect.arrayContaining([{ path: 'limit', code: 'too_big' }, { path: '', code: 'unrecognized_keys' }]) });
    expect(calls[1]).toMatchObject({ name: 'get_feedback', outcome: 'tool_error', error: 'invalid_arguments', unknownArguments: ['comment_id'],
        issues: [{ path: 'commentId', code: 'invalid_type' }] });
    expect(calls[2]).toMatchObject({ name: 'reply_to_feedback', outcome: 'tool_error', error: 'forbidden', missingScope: 'feedback:reply',
        arguments: { projectId, text: { type: 'string', length: 13 }, idempotencyKey: { type: 'string', length: 36 } } });
    expect(calls[3]).toMatchObject({ name: 'get_feedback', outcome: 'tool_error', error: 'not_found' });
    expect(calls[4]).toEqual({ method: 'tools/call', name: 'unknown', requestedName: 'create_feedback', outcome: 'tool_error', error: 'unknown_tool',
        result: { bytes: expect.any(Number) } });
    expect(calls[5]).toEqual({ method: 'prompts/get', name: 'unknown', requestedName: 'summarize-feedback', outcome: 'error',
        rpcError: ErrorCode.InvalidParams, error: 'unknown_prompt' });
    expect(calls[6]).toEqual({ method: 'prompts/get', name: 'triage-feedback', arguments: { projectId }, outcome: 'error',
        rpcError: ErrorCode.InvalidParams, error: 'not_found' });
    expect(calls[7]).toEqual({ method: 'resources/read', name: 'unknown', outcome: 'error', rpcError: ErrorCode.InvalidParams, error: 'unknown_resource' });
});

test('rejected requests log the reason before and after authentication', async () => {
    const f = await fixture();
    const { events, handle } = recorder();
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await handle(post(list))).status).toBe(401);
    expect((await handle(post(list, { Authorization: `Bearer uier_mcp.PRIVATE.${'x'.repeat(32)}` }))).status).toBe(401);
    expect((await handle(post(list, { Authorization: `Bearer ${f.token}`, Origin: 'https://other.example' }))).status).toBe(403);
    expect((await handle(new Request(`${base}/api/mcp`, { headers: { Authorization: `Bearer ${f.token}` } }))).status).toBe(405);
    expect((await handle(post({ jsonrpc: '2.0', id: 2, method: 'prompts/get', params: { name: 'triage-feedback', arguments: { projectId: 42 } } },
        { Authorization: `Bearer ${f.token}` }))).status).toBe(400);
    expect((await handle(post(list, { Authorization: `Bearer ${f.token}`, Accept: 'text/html' }))).status).toBe(406);
    expectNothingPrivate(events, f);
    expect(events.map(({ httpMethod, status, outcome, error, authentication, connection }) => ({ httpMethod, status, outcome, error, authentication, connected: Boolean(connection) }))).toEqual([
        { httpMethod: 'POST', status: 401, outcome: 'rejected', error: 'sign_in_required', authentication: 'missing', connected: false },
        { httpMethod: 'POST', status: 401, outcome: 'rejected', error: 'sign_in_required', authentication: 'invalid', connected: false },
        { httpMethod: 'POST', status: 403, outcome: 'rejected', error: 'forbidden', connected: false },
        { httpMethod: 'GET', status: 405, outcome: 'rejected', error: 'method_not_allowed', connected: true },
        { httpMethod: 'POST', status: 400, outcome: 'rejected', error: 'invalid_request', connected: true },
        { httpMethod: 'POST', status: 406, outcome: 'rejected', error: 'transport_error', connected: true },
    ]);
    // Bodies are read only after authentication; a rejected prompt still names what it asked for.
    expect(events.slice(0, 4).every(event => event.calls.length === 0)).toBe(true);
    expect(events[4]!.calls).toEqual([{ method: 'prompts/get', name: 'triage-feedback', arguments: { projectId: { type: 'number' } }, outcome: 'unanswered' }]);
});

test('unexpected failures, deadlines and a failing log sink leave responses unchanged', async () => {
    const f = await fixture();
    const { events, handle } = recorder();
    const client = await connect(f.token, handle);
    const memory = (globalThis as typeof globalThis & { __uierCommentsMemoryStore2: { domains: Map<string, Map<string, { document: unknown }>> } }).__uierCommentsMemoryStore2;
    const entry = memory.domains.get(f.comment.domain)!.get(f.comment.id)!;
    const document = entry.document;
    Object.defineProperty(entry, 'document', { configurable: true, get() { throw new TypeError('PRIVATE database diagnostics'); } });
    try {
        const failed = await client.callTool({ name: 'get_feedback', arguments: { projectId: f.project.id, commentId: f.comment.id } });
        expect(failed.isError).toBe(true);
    } finally {
        Object.defineProperty(entry, 'document', { configurable: true, writable: true, value: document });
        await client.close();
    }
    expect(toolCalls(events)).toEqual([{ method: 'tools/call', name: 'get_feedback', arguments: expect.any(Object), outcome: 'tool_error',
        error: 'server_error', failure: { name: 'TypeError', frames: expect.arrayContaining([expect.stringMatching(/:\d+:\d+\)?$/)]) },
        result: { bytes: expect.any(Number) } }]);

    const originalHandle = WebStandardStreamableHTTPServerTransport.prototype.handleRequest;
    WebStandardStreamableHTTPServerTransport.prototype.handleRequest = async () => new Promise<Response>(() => {});
    try {
        expect((await handle(post({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { Authorization: `Bearer ${f.token}` }), 20)).status).toBe(504);
    } finally { WebStandardStreamableHTTPServerTransport.prototype.handleRequest = originalHandle; }
    expect(events.at(-1)).toMatchObject({ status: 504, outcome: 'interrupted', error: 'timeout', calls: [{ method: 'tools/list', outcome: 'unanswered' }] });
    expectNothingPrivate(events, f);

    const response = await handleMcp(post({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, { Authorization: `Bearer ${f.token}` }), base,
        { emit: () => { throw new Error('log sink unavailable'); } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(0);
});
