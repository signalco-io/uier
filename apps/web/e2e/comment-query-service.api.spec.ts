import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { parseQuery, type QueryDocument } from '@uier/comments-query';
import { executeQuery, queryFacets, queryOptions, queryRow, capabilities, type QueryExecutionContext } from '../src/lib/commentQuery/service';
import { markThreadRead } from '../src/lib/comments/readState';
import type { DbComment } from '../src/lib/db/schema';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { getAppStore } from '../src/lib/app/store';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

function context(domain: string, userId = 'viewer'): QueryExecutionContext {
    return { scope: { kind: 'public' }, sources: [{ domain, actor: { kind: 'member', userId, name: 'Reviewer', isAdmin: false } }] };
}
function query(fields: Partial<QueryDocument> = {}) {
    return parseQuery({ version: 1, scope: { kind: 'public' }, collection: 'ordinary', timezone: 'UTC', ...fields });
}
function record(domain: string, id: string, fields: Partial<DbComment> = {}): DbComment {
    return { id, domain, path: '/page', position: { type: 'page' }, authorId: 'user:other',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        thread: { items: [{ id: 'first', text: 'Checkout is broken', authorId: 'user:other' }] }, ...fields };
}
async function cleanup(domain: string) {
    const store = getCommentsStore();
    for (const row of await store.queryCandidates(domain)) {
        const current = await store.get(domain, row.id);
        if (current) await store.delete(domain, row.id, current.etag);
    }
    const app = getAppStore();
    for (const receipt of await app.query({ type: 'review-read', where: { domain } })) await app.delete(receipt.pk, receipt.id);
}

test('full query and exact facets find old matches beyond a thousand visible and private newer rows', async () => {
    const domain = `service-query-${randomUUID()}`, store = getCommentsStore();
    try {
        // The newest-window list endpoint cannot satisfy this query; the candidate source must
        // apply privacy and selection to the whole partition before pagination and totals.
        for (let index = 0; index < 1101; index++) {
            await store.create(record(domain, `new-${index}`, { number: index + 2, path: '/new', private: index % 2 === 0 }));
        }
        await store.create(record(domain, 'old-match', { number: 1, path: '/old', createdAt: '2020-01-01T00:00:00Z', priority: 'high' }));
        await store.create(record(domain, 'hidden-match', { number: 9999, path: '/old', priority: 'urgent', private: true }));
        const request = query({ where: { field: 'page', operator: 'isPage', value: '/old' } });
        const result = await executeQuery(request, context(domain));
        expect(result.total).toBe(1);
        expect(result.items.map(item => item.id)).toEqual(['old-match']);
        expect(result.nextCursor).toBeNull();
        const facets = await queryFacets(request, context(domain), ['priority', 'status']);
        expect(facets.total).toBe(1);
        expect(facets.facets).toEqual({ priority: [{ value: 'high', count: 1 }], status: [{ value: 'open', count: 1 }] });
        const ordinary = await executeQuery(query(), context(domain), { size: 100 });
        expect(ordinary.total).toBe(551);
        expect(ordinary.items.every(item => !item.private)).toBe(true);
    } finally { await cleanup(domain); }
});

test('nested OR and NOT combine with authoritative per-reviewer unread receipts', async () => {
    const domain = `service-query-${randomUUID()}`, store = getCommentsStore();
    const records = [
        record(domain, 'unread', { priority: 'urgent', activity: { sequence: 2, byActor: { 'user:other': 2 } } }),
        record(domain, 'already-read', { priority: 'normal', activity: { sequence: 1, byActor: { 'user:other': 1 } } }),
        record(domain, 'own-activity', { priority: 'urgent', authorId: 'user:viewer', activity: { sequence: 1, byActor: { 'user:viewer': 1 } } }),
        record(domain, 'excluded-low', { priority: 'low', activity: { sequence: 1, byActor: { 'user:other': 1 } } })
    ];
    try {
        for (const row of records) await store.create(row);
        await markThreadRead(records[1]!, 'user:viewer', 1);
        const request = query({ where: { all: [
            { field: 'unread', operator: 'is', value: true },
            { any: [{ field: 'priority', operator: 'isAnyOf', value: ['urgent'] }, { field: 'text', operator: 'contains', value: 'Checkout' }] },
            { not: { field: 'priority', operator: 'isAnyOf', value: ['low'] } }
        ] } });
        expect((await executeQuery(request, context(domain))).items.map(item => item.id)).toEqual(['unread']);
        expect((await queryFacets(request, context(domain), ['priority'])).facets.priority).toEqual([{ value: 'urgent', count: 1 }]);
        await markThreadRead(records[0]!, 'user:viewer', 2);
        expect((await executeQuery(request, context(domain))).total).toBe(0);
        // Another member's read state remains independent of the viewer's acknowledgement.
        expect((await executeQuery(request, context(domain, 'someone-else'))).total).toBe(3);
    } finally { await cleanup(domain); }
});

test('live keyset cursors are stable across deletion and bound to the query and reviewer', async () => {
    const domain = `service-query-${randomUUID()}`, store = getCommentsStore();
    try {
        for (let index = 1; index <= 5; index++) await store.create(record(domain, `row-${index}`, { number: index }));
        const request = query({ order: [{ field: 'number', direction: 'asc' }] });
        const first = await executeQuery(request, context(domain), { size: 2 });
        expect(first.items.map(item => item.id)).toEqual(['row-1', 'row-2']);
        expect(first.nextCursor).toBeTruthy();
        const cursor = first.nextCursor!;
        await expect(executeQuery(request, context(domain, 'different-viewer'), { cursor })).rejects.toThrow(/different query/);
        await expect(executeQuery(query({ order: [{ field: 'number', direction: 'desc' }] }), context(domain), { cursor })).rejects.toThrow(/different query/);
        await expect(executeQuery(request, context(domain), { cursor: `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}` })).rejects.toThrow(/Invalid query cursor/);
        const removed = (await store.get(domain, 'row-1'))!;
        await store.delete(domain, 'row-1', removed.etag);
        const second = await executeQuery(request, context(domain), { size: 2, cursor });
        expect(second.items.map(item => item.id)).toEqual(['row-3', 'row-4']);
        expect(second.total).toBe(4);
        expect(second.evaluationTime).toBe(first.evaluationTime);
        const last = await executeQuery(request, context(domain), { size: 2, cursor: second.nextCursor! });
        expect(last.items.map(item => item.id)).toEqual(['row-5']);
        expect(last.nextCursor).toBeNull();
    } finally { await cleanup(domain); }
});

test('query summaries and facet counts exclude private data and heavy server records', async () => {
    const domain = `service-query-${randomUUID()}`, store = getCommentsStore();
    try {
        await store.create(record(domain, 'summary', {
            priority: 'high', device: { browser: 'Sensitive device', windowSize: [1000, 700] },
            screenshot: { contentType: 'image/png', width: 20, height: 10, bytes: 999999 },
            history: [{ hidden: 'audit-secret' }] as unknown as DbComment['history'],
            assigneeId: 'assignee-secret', assigneeAgent: { kind: 'codex', assigneeId: 'assignee-secret', setBy: 'member', setAt: 'now',
                sessionId: 'session-secret', connector: { name: 'client', credentialId: 'credential-secret' } },
            thread: { items: [{ id: 'first', text: 'Visible excerpt', authorId: 'user:author-secret', agent: { name: 'tool', credentialId: 'message-secret' } }] }
        }));
        await store.create(record(domain, 'hidden', { private: true, priority: 'urgent' }));
        const response = await executeQuery(query(), context(domain));
        expect(response.total).toBe(1);
        expect(capabilities(context(domain).sources).facetable).not.toContain('author');
        expect(capabilities(context(domain).sources).facetable).not.toContain('openedBy');
        expect(response.items[0]).toMatchObject({ id: 'summary', excerpt: 'Visible excerpt', priority: 'high', screenshot: true });
        expect(JSON.stringify(response)).not.toMatch(/audit-secret|assignee-secret|session-secret|credential-secret|message-secret|author-secret|Sensitive device|999999|queryMetadata|"thread"|"device"/);
        expect((await queryFacets(query(), context(domain), ['priority'])).facets.priority).toEqual([{ value: 'high', count: 1 }]);
        await expect(queryFacets(query(), context(domain), ['browser'])).rejects.toThrow(/unavailable/);
        await expect(queryFacets(query(), context(domain), ['text'])).rejects.toThrow(/unavailable/);
        await expect(queryFacets(query(), context(domain), ['title'])).rejects.toThrow(/unavailable/);
    } finally { await cleanup(domain); }
});


test('options search matches display labels and guest fix-link filters respect source visibility', async () => {
    const domain = `service-query-${randomUUID()}`, store = getCommentsStore();
    const project = { verificationEnabled: true, id: 'project-options', name: 'Checkout redesign', workspaceId: 'unused', urls: ['https://live.example', 'https://preview.example'], access: 'guests' } as import('../src/lib/app/model').DbProject;
    try {
        await store.create(record(domain, 'options', { origin: 'https://live.example', verification: { id: 'fix', revision: 'v1', requester: 'user:a', reviewer: 'user:b', requestedAt: '2026-01-01T00:00:00Z', outcome: 'pending', fixUrl: 'https://preview.example/fix' } }));
        // Display labels for semantic enums are searchable even though they differ from IDs.
        const request = query();
        const options = await queryOptions(request, context(domain), 'status', 'Ready to verify');
        expect(options.options).toEqual([{ value: 'ready', label: 'Ready to verify', count: 1 }]);
        const projectContext = { ...context(domain), sources: [{ ...context(domain).sources[0]!, project }] };
        expect((await queryOptions(request, projectContext, 'project', 'Checkout redesign')).options).toEqual([{ value: 'project-options', label: 'Checkout redesign', count: 1 }]);
        const candidate = (await store.queryCandidates(domain))[0]!;
        const guest = queryRow(candidate, { domain, project, actor: { kind: 'guest', visitorId: 'guest' } }, false, 0);
        const member = queryRow(candidate, { domain, project, actor: { kind: 'member', userId: 'viewer', name: 'Viewer', isAdmin: false } }, false, 0);
        expect(guest.record.fields.fixLink).toBe(false);
        expect(member.record.fields.fixLink).toBe(true);
        expect(guest.record.fields.kind).toBe('comment');
    } finally { await cleanup(domain); }
});


test('rotating guest IDs cannot bypass the normalized network query budget', async () => {
    const { enforceQueryReadLimits } = await import('../src/lib/commentQuery/limits');
    const { rateLimitIpBucket, limitWindow } = await import('../src/lib/comments/rateLimits');
    const { keyedHash } = await import('../src/lib/comments/environment');
    const request = new Request('https://uier.io/api/comments/query', { headers: { 'x-forwarded-for': `2001:db8:${randomUUID().slice(0,4)}::1` } });
    const bucket = rateLimitIpBucket(request)!;
    // Pre-fill the durable bucket to its edge, independent of the spoofable guest identifier.
    const limit = { key: `comment-query-network:${bucket}`, windowSeconds: 60 };
    const counter = limitWindow(limit as Parameters<typeof limitWindow>[0]);
    for (let i = 0; i < 600; i++) await getCommentsStore().incrementCounter('app', counter.id, 600, 360);
    await expect(enforceQueryReadLimits(request, [{ domain: 'one', actor: { kind: 'guest', visitorId: keyedHash('test', randomUUID()) } }])).rejects.toThrow(/Wait a moment/);
    await expect(enforceQueryReadLimits(request, [{ domain: 'another', actor: { kind: 'guest', visitorId: keyedHash('test', randomUUID()) } }])).rejects.toThrow(/Wait a moment/);
});


test('configured groups, removed origins and unknown sources retain exact environment matches', async () => {
    const domain = `service-query-${randomUUID()}`, store = getCommentsStore();
    const project = { id: 'env-project', workspaceId: 'unused', name: 'Environments', urls: ['https://live.example', 'https://preview.example'],
        environments: [{ origin: 'https://live.example', label: 'Live', group: 'Production' }], access: 'guests' } as import('../src/lib/app/model').DbProject;
    try {
        for (const [id, origin] of [['live', 'https://live.example'], ['preview', 'https://preview.example'], ['removed', 'https://old.example'], ['unknown', undefined]] as const)
            await store.create(record(domain, id, { origin }));
        const execution = { ...context(domain), sources: [{ ...context(domain).sources[0]!, project }] };
        const selected = await executeQuery(query({ location: { environmentIds: ['group:Production', 'removed'] } }), execution);
        expect(selected.items.map(item => item.id).sort()).toEqual(['live', 'removed']);
        const unknown = await executeQuery(query({ location: { environmentIds: ['unknown'] } }), execution);
        expect(unknown.items.map(item => item.id)).toEqual(['unknown']);
        const current = await executeQuery(query({ location: { environmentIds: ['current'] } }), { ...execution, currentEnvironment: 'origin:https://preview.example' });
        expect(current.items.map(item => item.id)).toEqual(['preview']);
    } finally { await cleanup(domain); }
});
