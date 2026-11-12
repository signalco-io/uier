import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject } from '../src/lib/app/model';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { listReviewComments } from '../src/lib/review/readRoutes';
import { persistProjectAccess } from './support/projectAccess';

const member = { kind: 'member', userId: 'u_paging_member', name: 'Member', isAdmin: false } as const;
const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (originalLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = originalLocal; });

// The toolbar's inbox loads the site's comments in pages as it scrolls: `?limit=` and `?before=<createdAt>|<id>`
test('the site list pages newest first by a keyset cursor', async () => {
    const project = { id: randomUUID().replaceAll('-', '').slice(0, 12), access: 'guests' } as DbProject;
    await persistProjectAccess(project, [member]);
    const store = getMemoryCommentsStore();
    const comment = (index: number, createdAt: string, extra: Partial<DbComment> = {}): DbComment => ({
        id: `comment_${String(index).padStart(2, '0')}_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id,
        path: `/page-${index}`, origin: project.urls[0], position: { type: 'page' }, authorId: `user:${member.userId}`, number: index,
        thread: { items: [{ id: 'first', text: `Comment ${index}`, authorId: `user:${member.userId}` }] }, createdAt, ...extra
    });
    // Two at the same time: the id decides between them, so neither is skipped or listed twice
    const comments = [
        comment(1, '2026-01-01T00:00:00.000Z'),
        comment(2, '2026-01-02T00:00:00.000Z'),
        comment(3, '2026-01-03T00:00:00.000Z'),
        comment(4, '2026-01-03T00:00:00.000Z'),
        comment(5, '2026-01-05T00:00:00.000Z'),
        comment(6, '2026-01-06T00:00:00.000Z', { archivedAt: '2026-01-07T00:00:00.000Z' })
    ];
    for (const item of comments) await store.create(item);
    const list = async (query: string) => await (await listReviewComments({ project, actor: member, siteOrigin: project.urls[0],
        request: new Request(`https://uier.io/api/review/${project.id}/comments?scope=site&archive=exclude${query}`) })).json() as { id: string; createdAt: string }[];
    const cursor = (item: { id: string; createdAt: string }) => `&before=${encodeURIComponent(`${item.createdAt}|${item.id}`)}`;

    const newest = [...comments.slice(0, 5)].sort((a, b) => b.createdAt!.localeCompare(a.createdAt!) || (a.id < b.id ? 1 : -1)).map(item => item.id);
    expect((await list('')).map(item => item.id)).toEqual(newest);
    const first = await list('&limit=2');
    expect(first.map(item => item.id)).toEqual(newest.slice(0, 2));
    const second = await list(`&limit=2${cursor(first.at(-1)!)}`);
    expect(second.map(item => item.id)).toEqual(newest.slice(2, 4));
    const third = await list(`&limit=2${cursor(second.at(-1)!)}`);
    expect(third.map(item => item.id)).toEqual(newest.slice(4));
    expect(await list(`&limit=2${cursor(third.at(-1)!)}`)).toEqual([]);

    // A comment added meanwhile is on the first page; the next pages stay where they were
    await store.create(comment(7, '2026-01-08T00:00:00.000Z'));
    expect((await list(`&limit=2${cursor(first.at(-1)!)}`)).map(item => item.id)).toEqual(newest.slice(2, 4));

    for (const query of ['&limit=0', '&limit=201', '&limit=1.5', '&before=nothing', `&before=${encodeURIComponent('not a date|comment_x')}`, '&before=2026-01-01T00:00:00.000Z|'])
        await expect(list(query), query).rejects.toMatchObject({ code: 'invalid_request' });
});
