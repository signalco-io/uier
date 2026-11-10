import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { handleMcp } from '../src/lib/mcp/http';
import { authenticateMcp, createMcpCredential, listMcpCredentials, revokeMcpCredential, type McpCredentialCreation } from '../src/lib/mcp/credentials';
import { tokenScopes } from '../src/lib/mcp/scopes';
import { getAppStore } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import { createProject } from '../src/lib/app/projects';
import type { AppContext } from '../src/lib/app/context';
import type { McpRequestEvent } from '../src/lib/mcp/telemetry';
import { ApiError } from '../src/lib/comments/http';

const base = 'http://127.0.0.1:6518';
const env = { UIER_LOCAL: '1', UIER_COMMENTS_SECRET: 'mcp-token-test-secret-for-local-validation-only', UIER_BASE_URL: base };
const originalEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
test.beforeAll(() => Object.assign(process.env, env));
test.afterAll(() => { for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
} });

async function fixture(scopes: string[] = ['feedback:read', 'screenshots:read', 'feedback:assign', 'tokens:create']) {
    const user = await findOrCreateUser(`mint-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'Watcher project', urls: ['https://watch.example'] });
    const other = await createProject(context, { name: 'Excluded project', urls: ['https://other.example'] });
    const parent = await createMcpCredential(context, { name: 'Connected coding tool', projectIds: [project.id], scopes, days: 90 });
    const input = { name: 'Project watcher', workspaceId: project.workspaceId, projectIds: [project.id],
        scopes: ['feedback:read', 'screenshots:read', 'feedback:assign'], days: 30, idempotencyKey: randomUUID() };
    return { user, context, project, other, parent, input };
}
async function connect(token: string, emit: (event: McpRequestEvent) => void = () => {}) {
    const client = new Client({ name: 'access-token-api-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: async (input, init) => handleMcp(new Request(input, init), base, { emit })
    }));
    return client;
}
async function mint(client: Client, input: Record<string, unknown>) {
    return (await client.callTool({ name: 'create_access_token', arguments: input })).structuredContent as Record<string, any>;
}
const bearer = (token: string) => new Request(`${base}/api/mcp`, { headers: { Authorization: `Bearer ${token}` } });

test('MCP creates a named, bounded, revocable token, audits its connection and never logs or stores its secret', async () => {
    const f = await fixture();
    const events: McpRequestEvent[] = [];
    const client = await connect(f.parent.token, event => events.push(event));
    try {
        const tool = (await client.listTools()).tools.find(tool => tool.name === 'create_access_token')!;
        expect(tool.description).toContain('secret');
        expect(tool.description).toContain('never repeat');
        const start = Date.now();
        const created = await mint(client, f.input);
        expect(created.alreadyCreated).toBe(false);
        expect(created.token).toMatch(/^uier_mcp\./);
        expect(created.credential).toMatchObject({ name: f.input.name, projectIds: f.input.projectIds, scopes: f.input.scopes,
            createdBy: { id: f.parent.credential.id, kind: 'credential', name: 'Connected coding tool' } });
        expect(Date.parse(created.credential.expiresAt)).toBeGreaterThanOrEqual(start + 30 * 86400_000);
        expect(Date.parse(created.credential.expiresAt)).toBeLessThanOrEqual(Date.now() + 30 * 86400_000);
        expect((await listMcpCredentials(f.user.id)).find(doc => doc.id === created.credential.id)).toMatchObject(created.credential);
        const docs = await getAppStore().query({ type: 'mcp-credential', pk: f.parent.credential.pk });
        const audits = await getAppStore().query<McpCredentialCreation>({ type: 'mcp-credential-creation', pk: f.parent.credential.pk });
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({ credential: created.credential, ttl: 30 * 86400 });
        for (const text of [JSON.stringify([...docs, ...audits]), JSON.stringify(events)]) expect(text).not.toContain(created.token);
        expect(JSON.stringify(events)).not.toContain(f.input.name);
        expect(events.at(-1)?.calls).toEqual([expect.objectContaining({ name: 'create_access_token', outcome: 'success' })]);
        const child = await connect(created.token);
        try {
            const listed = (await child.callTool({ name: 'list_projects' })).structuredContent as any;
            expect(listed.items.map((project: { id: string }) => project.id)).toEqual([f.project.id]);
            expect((await mint(child, { ...f.input, idempotencyKey: randomUUID() })).error).toBe('forbidden');
            expect((await child.callTool({ name: 'list_feedback', arguments: { projectId: f.other.id } })).structuredContent).toMatchObject({ error: 'not_found' });
            // Tokens remain independently revocable in Account, as hand-made tokens do.
            await revokeMcpCredential(f.user.id, f.parent.credential.id);
            expect((await authenticateMcp(bearer(created.token))).scopes).toEqual(f.input.scopes);
            await revokeMcpCredential(f.user.id, created.credential.id);
            await expect(child.listTools()).rejects.toThrow();
            expect(await getAppStore().query({ type: 'mcp-credential-creation', pk: f.parent.credential.pk })).toHaveLength(1);
        } finally { await child.close(); }
    } finally { await client.close(); }
});

test('creation requires its explicit permission and cannot widen operations, project selection or live membership', async () => {
    const noPermission = await fixture(['feedback:read']);
    const denied = await connect(noPermission.parent.token);
    try { expect(await mint(denied, noPermission.input)).toMatchObject({ error: 'forbidden', message: 'This connection needs tokens:create.' }); }
    finally { await denied.close(); }
    const f = await fixture();
    const client = await connect(f.parent.token);
    try {
        expect(await mint(client, { ...f.input, scopes: ['feedback:read', 'feedback:reply'] })).toMatchObject({ error: 'forbidden' });
        for (const projectId of [f.other.id, 'missing00000'])
            expect(await mint(client, { ...f.input, projectIds: [projectId] })).toMatchObject({ error: 'not_found' });
        expect(await mint(client, { ...f.input, workspaceId: 'another-workspace' })).toMatchObject({ error: 'invalid_request' });
        const created = await mint(client, { ...f.input, days: 1 });
        const child = await connect(created.token);
        try {
            // Current membership gates both new issuance and use of the issued credential.
            await getAppStore().delete(f.context.member.pk, f.context.member.id);
            expect(await mint(client, { ...f.input, idempotencyKey: randomUUID() })).toMatchObject({ error: 'not_found' });
            expect((await child.callTool({ name: 'list_feedback', arguments: { projectId: f.project.id } })).structuredContent).toMatchObject({ error: 'not_found' });
        } finally { await child.close(); }
        expect(await listMcpCredentials(f.user.id)).toHaveLength(2);
    } finally { await client.close(); }
});

test('creation validates names, explicit project/operation choices, lifetime and retry keys before saving', async () => {
    const f = await fixture();
    const client = await connect(f.parent.token);
    try {
        const invalid = [
            ...['', ' ', 'x'.repeat(61), 'line\nbreak', 'hidden\u200bname'].map(name => ({ name })),
            ...[0, -1, 31, 90, 1.5, '30', null].map(days => ({ days })),
            ...[[], ['invalid'], Array(21).fill(f.project.id), [f.project.id, f.project.id], 'all'].map(projectIds => ({ projectIds })),
            ...[[], ['feedback:assign'], ['feedback:read', 'tokens:create'], ['feedback:read', 'feedback:read'], ['unknown']].map(scopes => ({ scopes })),
            { idempotencyKey: '' }, { idempotencyKey: 'x'.repeat(129) }, { extra: true }
        ];
        for (const patch of invalid) {
            const response = await client.callTool({ name: 'create_access_token', arguments: { ...f.input, ...patch } });
            expect(response.isError, JSON.stringify(patch)).toBe(true);
        }
        expect(await listMcpCredentials(f.user.id)).toHaveLength(1);
        expect(await getAppStore().query({ type: 'mcp-credential-creation', pk: f.parent.credential.pk })).toHaveLength(0);
        const short = await mint(client, { ...f.input, days: 1 });
        expect(Date.parse(short.credential.expiresAt) - Date.parse(short.credential.createdAt)).toBe(86400_000);
        const stored = (await getAppStore().get(f.parent.credential.pk, short.credential.id))!;
        expect(await getAppStore().replace({ ...stored.doc, expiresAt: new Date(Date.now() - 1000).toISOString() }, stored.etag)).toBe('ok');
        await expect(authenticateMcp(bearer(short.token))).rejects.toMatchObject({ status: 401 });
        expect(await listMcpCredentials(f.user.id)).toHaveLength(1);
    } finally { await client.close(); }
});

test('retries and concurrent calls issue and return one secret only; mismatched retry input conflicts', async () => {
    const f = await fixture();
    const client = await connect(f.parent.token);
    try {
        const results = await Promise.all(Array.from({ length: 4 }, () => mint(client, f.input)));
        const created = results.filter(value => value.token);
        expect(created).toHaveLength(1);
        expect(results.filter(value => value.alreadyCreated)).toHaveLength(3);
        expect(new Set(results.map(value => value.credential.id)).size).toBe(1);
        expect(await mint(client, f.input)).toMatchObject({ alreadyCreated: true, credential: created[0]!.credential });
        expect((await mint(client, f.input)).token).toBeUndefined();
        expect(await mint(client, { ...f.input, days: 7 })).toMatchObject({ error: 'conflict' });
        expect(await listMcpCredentials(f.user.id)).toHaveLength(2);
        expect(await getAppStore().query({ type: 'mcp-credential-creation', pk: f.parent.credential.pk })).toHaveLength(1);
    } finally { await client.close(); }
});

test('creation limits survive revocation, count per connection and account, and replays do not spend them', async () => {
    const f = await fixture();
    for (let connection = 0; connection < 3; connection++) {
        const parent = connection === 0 ? f.parent : await createMcpCredential(f.context, {
            name: `Other connection ${connection}`, projectIds: [f.project.id], scopes: ['feedback:read', 'tokens:create'], days: 30
        });
        const client = await connect(parent.token);
        try {
            for (let i = 0; i < (connection < 2 ? 5 : 0); i++) {
                const input = { ...f.input, scopes: ['feedback:read'], idempotencyKey: randomUUID() };
                const result = await mint(client, input);
                expect(result.token).toMatch(/^uier_mcp\./);
                await revokeMcpCredential(f.user.id, result.credential.id);
                expect(await mint(client, input)).toMatchObject({ alreadyCreated: true });
            }
            expect(await mint(client, { ...f.input, scopes: ['feedback:read'], idempotencyKey: randomUUID() }))
                .toMatchObject({ error: 'rate_limited', retryAfterSeconds: expect.any(Number) });
        } finally { await client.close(); }
    }
});

test('the 20-active-token cap is atomic across hand-made and MCP-created tokens', async () => {
    const f = await fixture();
    for (let i = 0; i < 18; i++) await createMcpCredential(f.context, { name: `Existing ${i}`, projectIds: [f.project.id], scopes: tokenScopes, days: 30 });
    const client = await connect(f.parent.token);
    try {
        const results = await Promise.all([
            mint(client, f.input),
            createMcpCredential(f.context, { name: 'Hand-made at limit', projectIds: [f.project.id], scopes: ['feedback:read'], days: 30 })
                .then(value => value, error => { if (error instanceof ApiError) return { error: error.code }; throw error; })
        ]);
        expect(results.filter(value => 'token' in value)).toHaveLength(1);
        expect(results.filter(value => 'error' in value)).toMatchObject([{ error: 'invalid_request' }]);
        expect(await listMcpCredentials(f.user.id)).toHaveLength(20);
    } finally { await client.close(); }
});

test('conflicting atomic saves leave neither a credential nor an audit receipt and can be retried', async () => {
    const f = await fixture();
    const client = await connect(f.parent.token);
    const store = getAppStore();
    const memory = (globalThis as typeof globalThis & {
        __uierAppMemoryStore: { partitions: Map<string, Map<string, { version: number }>> }
    }).__uierAppMemoryStore;
    const guard = memory.partitions.get(f.parent.credential.pk)!.get('mcp-credential-guard')!;
    let version = guard.version;
    // Change the version between the service's read and every conditional batch.
    Object.defineProperty(guard, 'version', { configurable: true, get: () => ++version });
    try {
        const failed = await mint(client, f.input);
        expect(failed).toMatchObject({ error: 'conflict' });
        expect(await listMcpCredentials(f.user.id)).toHaveLength(1);
        expect(await store.query({ type: 'mcp-credential-creation', pk: f.parent.credential.pk })).toHaveLength(0);
        Object.defineProperty(guard, 'version', { configurable: true, writable: true, value: version });
        expect((await mint(client, f.input)).token).toMatch(/^uier_mcp\./);
    } finally {
        Object.defineProperty(guard, 'version', { configurable: true, writable: true, value: version });
        await client.close();
    }
});


test('created token expiry is capped at the creating Account token expiry, including less than one day', async () => {
    const f = await fixture();
    const stored = (await getAppStore().get(f.parent.credential.pk, f.parent.credential.id))!;
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    await getAppStore().replace({ ...stored.doc, expiresAt }, stored.etag);
    const client = await connect(f.parent.token);
    try {
        const created = await mint(client, f.input);
        expect(created.credential.expiresAt).toBe(expiresAt);
        const token = (await getAppStore().get(f.parent.credential.pk, created.credential.id))!;
        expect(token.doc.ttl).toBeLessThanOrEqual(3600);
        expect(token.doc.ttl).toBeGreaterThan(0);
    } finally { await client.close(); }
});
