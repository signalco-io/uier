import { randomUUID } from 'node:crypto';
import type { Container } from '@azure/cosmos';
import { expect, test } from '@playwright/test';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject } from '../src/lib/app/model';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { createCosmosCommentsStore } from '../src/lib/repo/cosmosCommentsStore';
import { MAX_PROJECT_COMMENTS } from '../src/lib/review/comments';
import { listReviewComments } from '../src/lib/review/readRoutes';
import { persistProjectAccess } from './support/projectAccess';

const member = { kind: 'member', userId: 'u_paging_member', name: 'Member', isAdmin: false } as const;
const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (originalLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = originalLocal; });

type Listed = { id: string; createdAt: string };
type Page = { comments: Listed[]; next: string | null };

async function pagingProject() {
    const project = { id: randomUUID().replaceAll('-', '').slice(0, 12), access: 'guests' } as DbProject;
    await persistProjectAccess(project, [member]);
    const comment = (index: number, createdAt: string, extra: Partial<DbComment> = {}): DbComment => ({
        id: `comment_${String(index).padStart(4, '0')}_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id,
        path: `/page-${index % 3}`, origin: project.urls[0], position: { type: 'page' }, authorId: `user:${member.userId}`, number: index,
        thread: { items: [{ id: 'first', text: `Comment ${index}`, authorId: `user:${member.userId}` }] }, createdAt, ...extra
    });
    const get = async (query: string) => await (await listReviewComments({ project, actor: member, siteOrigin: project.urls[0],
        request: new Request(`https://uier.io/api/review/${project.id}/comments?${query}`) })).json() as unknown;
    return { project, comment, get, list: async (query: string) => await get(`scope=site&archive=exclude${query}`) as Page };
}
const after = (next: string | null) => `&before=${encodeURIComponent(next!)}`;
const newestFirst = (a: Listed, b: Listed) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? 1 : -1);

// The toolbar's inbox loads its lists in pages as it scrolls: `?limit=` and `?before=` answer `{ comments, next }`
test('a list pages newest first by a keyset cursor, with ties broken by id, and says where the next page starts', async () => {
    const { comment, list, get } = await pagingProject();
    const store = getMemoryCommentsStore();
    // Two at the same time: the id decides between them, so neither is skipped or listed twice
    const comments = [
        comment(1, '2026-01-01T00:00:00.000Z'),
        comment(2, '2026-01-02T00:00:00.000Z'),
        comment(3, '2026-01-03T00:00:00.000Z'),
        comment(4, '2026-01-03T00:00:00.000Z'),
        comment(5, '2026-01-05T00:00:00.000Z'),
        comment(6, '2026-01-06T00:00:00.000Z', { archivedAt: '2026-01-07T00:00:00.000Z' }),
        // Another reader's private thread is hidden in storage, before the limit
        comment(7, '2026-01-04T00:00:00.000Z', { private: true, authorId: 'user:u_someone_else' })
    ];
    for (const item of comments) await store.create(item);
    const newest = comments.slice(0, 5).map(item => ({ id: item.id, createdAt: item.createdAt! })).sort(newestFirst).map(item => item.id);

    // No paging parameters: the plain array, as before (ordered by time only)
    expect((await get('scope=site&archive=exclude') as Listed[]).map(item => item.id).sort()).toEqual([...newest].sort());

    const first = await list('&limit=2');
    expect(first.comments.map(item => item.id)).toEqual(newest.slice(0, 2));
    const second = await list(`&limit=2${after(first.next)}`);
    expect(second.comments.map(item => item.id)).toEqual(newest.slice(2, 4));
    const third = await list(`&limit=2${after(second.next)}`);
    expect(third).toMatchObject({ comments: [expect.objectContaining({ id: newest[4] })], next: null });

    // A comment added meanwhile is on the first page; the next pages stay where they were
    await store.create(comment(8, '2026-01-08T00:00:00.000Z'));
    expect((await list(`&limit=2${after(first.next)}`)).comments.map(item => item.id)).toEqual(newest.slice(2, 4));

    // One page's list pages too (This page in the inbox)
    const page = [comments[3]!.id, comments[0]!.id];
    expect(((await get('path=%2Fpage-1&archive=exclude&limit=200')) as Page)).toMatchObject({ comments: page.map(id => expect.objectContaining({ id })), next: null });

    for (const query of ['&limit=0', '&limit=201', '&limit=1.5', '&before=nothing', `&before=${encodeURIComponent('not a date|comment_x')}`, '&before=2026-01-01T00:00:00.000Z|'])
        await expect(list(query), query).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(get('scope=site&unread=true&limit=10')).rejects.toMatchObject({ code: 'invalid_request' });
});

test('paging reaches threads older than the newest records storage would window', async () => {
    const { comment, list } = await pagingProject();
    const store = getMemoryCommentsStore();
    const total = MAX_PROJECT_COMMENTS + 20;
    const start = Date.UTC(2025, 0, 1);
    for (let index = 0; index < total; index++) await store.create(comment(index, new Date(start + index * 60_000).toISOString()));
    const seen: string[] = [];
    let next: string | null = null;
    do {
        const page: Page = await list(`&limit=200${next ? after(next) : ''}`);
        seen.push(...page.comments.map(item => item.id));
        next = page.next;
    } while (next);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen.at(-1)).toMatch(/^comment_0000_/);
});

test('a page cut at the response size limit continues after the last thread it sent', async () => {
    const { comment, list } = await pagingProject();
    const store = getMemoryCommentsStore();
    // Long reply histories: about 50 KB each, so 30 of them are more than the 1 MB response
    const items = Array.from({ length: 50 }, (_, index) => ({ id: `item_${index}`, text: 'x'.repeat(1000), authorId: `user:${member.userId}` }));
    for (let index = 0; index < 30; index++)
        await store.create(comment(index, new Date(Date.UTC(2025, 5, 1) + index * 60_000).toISOString(), { thread: { items } }));
    const first = await list('&limit=30');
    expect(first.comments.length).toBeGreaterThan(0);
    expect(first.comments.length).toBeLessThan(30);
    expect(first.next).toBe(`${first.comments.at(-1)!.createdAt}|${first.comments.at(-1)!.id}`);
    const seen = [...first.comments];
    let next = first.next;
    while (next) {
        const page = await list(`&limit=30${after(next)}`);
        seen.push(...page.comments);
        next = page.next;
    }
    expect(new Set(seen.map(item => item.id)).size).toBe(30);
});

test('Cosmos applies the cursor, filters and visibility before TOP, and completes the last time by id', async () => {
    const captured: { query: string; parameters: { name: string; value: unknown }[] }[] = [];
    const doc = (id: string, createdAt: string) => ({ id, createdAt, domain: 'project:p_page', path: '/', _etag: 'x' });
    const results: unknown[][] = [
        [doc('comment_d', '2026-01-04T00:00:00.000Z'), doc('comment_b', '2026-01-03T00:00:00.000Z')],
        // Every record at the last time: `comment_c` was left out by TOP
        [doc('comment_c', '2026-01-03T00:00:00.000Z'), doc('comment_b', '2026-01-03T00:00:00.000Z')]
    ];
    const container = { id: 'comments', items: { query(input: (typeof captured)[number]) {
        captured.push(input);
        const resources = results.shift() ?? [];
        let pending = true;
        return { hasMoreResults: () => pending, async fetchNext() { pending = false; return { resources, requestCharge: 1 }; } };
    } } } as unknown as Container;
    const page = await createCosmosCommentsStore(() => container).listPage('project:p_page', {
        limit: 2, before: { createdAt: '2026-01-05T00:00:00.000Z', id: 'comment_e' }, archive: 'exclude', visibility: { authorId: 'user:u_reader' }
    });
    expect(page.map(comment => comment.id)).toEqual(['comment_d', 'comment_c']);
    expect(page[0]).not.toHaveProperty('_etag');
    const where = 'c.domain = @domain AND IS_STRING(c.path) AND IS_STRING(c.createdAt) AND (NOT (IS_BOOL(c.private) AND c.private = true) OR c.authorId = @readerId)'
        + ' AND NOT IS_STRING(c.archivedAt) AND (c.createdAt < @beforeAt OR (c.createdAt = @beforeAt AND c.id < @beforeId))';
    expect(captured[0]!.query).toBe(`SELECT TOP @limit * FROM c WHERE ${where} ORDER BY c.createdAt DESC`);
    expect(captured[1]!.query).toBe(`SELECT TOP @limit * FROM c WHERE ${where} AND c.createdAt = @tieAt ORDER BY c.id DESC`);
    expect(captured[1]!.parameters).toEqual(expect.arrayContaining([
        { name: '@beforeAt', value: '2026-01-05T00:00:00.000Z' }, { name: '@beforeId', value: 'comment_e' },
        { name: '@tieAt', value: '2026-01-03T00:00:00.000Z' }, { name: '@limit', value: 2 }, { name: '@readerId', value: 'user:u_reader' }
    ]));
});
