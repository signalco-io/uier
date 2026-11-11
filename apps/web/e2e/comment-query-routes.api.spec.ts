import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const query = (path: string) => ({ version: 1, scope: { kind: 'public' }, collection: 'ordinary',
    location: { page: { kind: 'exact', path } }, order: [{ field: 'number', direction: 'desc' }], timezone: 'UTC' });

test('public query HTTP routes return compact pages, exact counts and options without creating a visitor on reads', async ({ playwright, baseURL }) => {
    const visitor = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Host: `query-${randomUUID()}.localhost` } });
    try {
        const cap = await visitor.get('/api/comments/query/capabilities');
        expect(cap.status()).toBe(200);
        expect(cap.headers()['set-cookie']).toBeUndefined();
        expect(cap.headers()['cache-control']).toBe('no-store');
        expect((await cap.json()).fields.map((field: { id: string }) => field.id)).not.toContain('browser');
        const path = `/queries/${randomUUID()}`;
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) {
            const response = await visitor.post('/api/comments', { data: { path, position: { type: 'page' }, text: `Searchable heading ${i} ${'x'.repeat(300)}` } });
            expect(response.status(), await response.text()).toBe(201);
            ids.push((await response.json()).id);
        }
        const first = await visitor.post('/api/comments/query', { data: { query: query(path), page: { size: 2 } } });
        expect(first.status(), await first.text()).toBe(200);
        const result = await first.json();
        expect(result.total).toBe(3);
        expect(result.items.map((item: { id: string }) => item.id)).toEqual([...ids].reverse().slice(0, 2));
        expect(result.items[0].excerpt).toHaveLength(240);
        for (const field of ['thread', 'position', 'history', 'assigneeAgent', 'device', 'authorId', 'queryMetadata']) expect(result.items[0]).not.toHaveProperty(field);
        const next = await visitor.post('/api/comments/query', { data: { query: query(path), page: { size: 2, cursor: result.nextCursor } } });
        expect(next.status(), await next.text()).toBe(200);
        expect((await next.json()).items.map((item: { id: string }) => item.id)).toEqual([ids[0]]);
        const counts = await visitor.post('/api/comments/query/counts', { data: { query: query(path), facets: ['status'] } });
        expect(counts.status(), await counts.text()).toBe(200);
        expect(await counts.json()).toMatchObject({ total: 3, facets: { status: [{ value: 'open', count: 3 }] } });
        const options = await visitor.post('/api/comments/query/options', { data: { query: query(path), field: 'priority' } });
        expect(options.status(), await options.text()).toBe(200);
        expect(await options.json()).toMatchObject({ options: [{ value: 'normal', count: 3 }], nextOffset: null });
    } finally { await visitor.dispose(); }
});

test('query HTTP boundaries reject forged scopes, hidden fields, malformed expressions, stale cursors and cross-site cookie access', async ({ request }) => {
    const base = query(`/queries/${randomUUID()}`);
    for (const [override, status] of [
        [{ scope: { kind: 'workspace', workspaceId: 'not-yours' } }, 400],
        [{ where: { field: 'browser', operator: 'isAnyOf', value: ['Safari'] } }, 403],
        [{ where: { any: [{ field: 'not-a-field', operator: 'is', value: true }] } }, 400],
        [{ order: [{ field: 'browser', direction: 'asc' }] }, 403]
    ] as const) {
        const response = await request.post('/api/comments/query', { data: { query: { ...base, ...override } } });
        expect(response.status(), await response.text()).toBe(status);
    }
    const invalid = await request.post('/api/comments/query', { data: { query: base, page: { cursor: 'forged.signature' } } });
    expect(invalid.status()).toBe(400);
    const malformed = await request.post('/api/comments/query', { data: '{', headers: { 'Content-Type': 'application/json' } });
    expect(malformed.status()).toBe(400);
    const unsigned = await request.post('/api/projects/abcdefghijkl/comments/query', { data: { query: base } });
    expect(unsigned.status()).toBe(401);
    expect(unsigned.headers()['cache-control']).toBe('private, no-store');
    const foreign = await request.post('/api/workspaces/abcdefghijkl/comments/query', { data: { query: base }, headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' } });
    expect(foreign.status()).toBe(403);
});
