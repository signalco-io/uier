import { randomUUID } from 'node:crypto';
import type { Container } from '@azure/cosmos';
import { expect, test } from '@playwright/test';
import type { DbComment } from '../src/lib/db/schema';
import { PUBLIC_PROJECT_PARTITION } from '../src/lib/comments/publicProject';
import { createCosmosCommentsStore } from '../src/lib/repo/cosmosCommentsStore';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { matchesVisibility } from '../src/lib/repo/visibilityFilter';
import { canSeeComment, commentVisibilityFilter } from '../src/lib/review/comments';
import type { ProjectActor } from '../src/lib/review/actor';

// The sidebar's Recent activity (uier #32): one aggregate per project, counting only threads the member can see.

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

const admin: ProjectActor = { kind: 'member', userId: 'u_admin', name: 'Admin', isAdmin: true };
const author: ProjectActor = { kind: 'member', userId: 'u_author', name: 'Author', isAdmin: false };
const other: ProjectActor = { kind: 'member', userId: 'u_other', name: 'Other', isAdmin: false };

function comment(domain: string, id: string, fields: Partial<DbComment> = {}): DbComment {
    return {
        id, domain, path: '/', position: { type: 'page' }, number: 1, resolved: false,
        thread: { items: [{ id: `item_${id}`, text: 'Hi', createdAt: '2026-11-01T10:00:00.000Z' }] },
        createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
        ...fields
    };
}

test('the storage filter sees exactly the threads canSeeComment shows', () => {
    const domains = ['project:p_sidebar', PUBLIC_PROJECT_PARTITION];
    const paths = ['/', '/pricing', '/app', '/app/projects', '/app?tab=1', '/app#top', '/apples', '/application'];
    for (const domain of domains)
        for (const path of paths)
            for (const isPrivate of [undefined, false, true])
                for (const authorId of [undefined, 'user:u_author', 'user:u_other', 'guest-visitor']) {
                    const thread = comment(domain, 'c', { path, private: isPrivate, authorId });
                    for (const actor of [admin, author, other])
                        expect(matchesVisibility(thread, commentVisibilityFilter(domain, actor)), JSON.stringify({ domain, path, isPrivate, authorId, actor: actor.kind === 'member' && actor.userId }))
                            .toBe(canSeeComment(thread, actor));
                }
});

test('the newest visible change is the latest activity; hidden threads, other partitions and other documents never count', async () => {
    const store = getMemoryCommentsStore();
    const domain = `project:sidebar-${randomUUID()}`;
    expect(await store.latestActivity(domain)).toBeUndefined();
    await store.create(comment(domain, 'comment_open', { authorId: 'user:u_other', updatedAt: '2026-11-03T09:00:00.000Z' }));
    await store.create(comment(domain, 'comment_private', { authorId: 'user:u_other', private: true, updatedAt: '2026-11-07T09:00:00.000Z' }));
    await store.create(comment(domain, 'comment_own_private', { authorId: 'user:u_author', private: true, updatedAt: '2026-11-05T09:00:00.000Z' }));
    // From before `updatedAt`: never written since, it does not count
    await store.create(comment(domain, 'comment_legacy', { updatedAt: undefined, createdAt: '2026-11-08T09:00:00.000Z' }));
    await store.create(comment(`project:other-${randomUUID()}`, 'comment_elsewhere', { updatedAt: '2026-11-09T09:00:00.000Z' }));
    await store.nextCommentNumber(domain);

    expect(await store.latestActivity(domain, commentVisibilityFilter(domain, admin))).toBe('2026-11-07T09:00:00.000Z');
    expect(await store.latestActivity(domain, commentVisibilityFilter(domain, author))).toBe('2026-11-05T09:00:00.000Z');
    expect(await store.latestActivity(domain, commentVisibilityFilter(domain, other))).toBe('2026-11-07T09:00:00.000Z');
    expect(await store.latestActivity(domain, { authorId: 'user:u_nobody' })).toBe('2026-11-03T09:00:00.000Z');
});

test('Cosmos reads one scalar in the project partition, with the visibility in the query', async () => {
    const captured: { input: { query: string; parameters: { name: string; value: unknown }[] }; options: unknown }[] = [];
    const results: unknown[][] = [['2026-11-07T09:00:00.000Z'], []];
    const container = { id: 'comments-preview', items: { query(input: (typeof captured)[number]['input'], options: unknown) {
        captured.push({ input, options });
        const resources = results.shift() ?? [];
        let pending = true;
        return { hasMoreResults: () => pending, async fetchNext() { pending = false; return { resources, requestCharge: 2.9 }; } };
    } } } as unknown as Container;
    const store = createCosmosCommentsStore(() => container);

    // Admins: every thread of the partition
    expect(await store.latestActivity('project:p_sidebar')).toBe('2026-11-07T09:00:00.000Z');
    expect(captured[0]?.options).toEqual({ partitionKey: 'project:p_sidebar' });
    expect(captured[0]?.input.query).toBe('SELECT VALUE MAX(c.updatedAt) FROM c WHERE c.domain = @domain AND IS_STRING(c.path) AND IS_STRING(c.updatedAt)');
    expect(captured[0]?.input.parameters).toEqual([{ name: '@domain', value: 'project:p_sidebar' }]);

    // Everyone else on uier's public project: not private, not its app pages, or their own; nothing visible yet
    expect(await store.latestActivity(PUBLIC_PROJECT_PARTITION, commentVisibilityFilter(PUBLIC_PROJECT_PARTITION, other))).toBeUndefined();
    expect(captured[1]?.input.query).toBe('SELECT VALUE MAX(c.updatedAt) FROM c WHERE c.domain = @domain AND IS_STRING(c.path) AND IS_STRING(c.updatedAt)'
        + ' AND (NOT (IS_BOOL(c.private) AND c.private = true OR c.path = @privatePath OR STARTSWITH(c.path, @privatePath0)'
        + ' OR STARTSWITH(c.path, @privatePath1) OR STARTSWITH(c.path, @privatePath2)) OR c.authorId = @readerId)');
    expect(captured[1]?.input.parameters).toEqual([
        { name: '@domain', value: PUBLIC_PROJECT_PARTITION },
        { name: '@privatePath', value: '/app' },
        { name: '@privatePath0', value: '/app/' },
        { name: '@privatePath1', value: '/app?' },
        { name: '@privatePath2', value: '/app#' },
        { name: '@readerId', value: 'user:u_other' }
    ]);
    expect(captured[1]?.input.query).not.toMatch(/TOP|SELECT \*/);
});

test('ordered by name, the sidebar uses creation times without reading activity; by recent activity, each listed project\'s latest', async () => {
    const previous = { cosmos: process.env.COSMOSDB_CONNECTION_STRING, endpoint: process.env.COSMOSDB_ENDPOINT };
    process.env.COSMOSDB_CONNECTION_STRING = '';
    process.env.COSMOSDB_ENDPOINT = '';
    try {
        const { loadSidebarProjects } = await import('../src/lib/app/sidebarProjects');
        const id = randomUUID().replaceAll('-', '').slice(0, 11);
        await getMemoryCommentsStore().create(comment(`project:${id}a`, 'comment_new', { updatedAt: '2026-11-08T09:00:00.000Z' }));
        await getMemoryCommentsStore().create(comment(`project:${id}c`, 'comment_done', { updatedAt: '2026-11-09T09:00:00.000Z' }));
        const context = { workspace: { id: `w_${id}` }, user: { id: 'u_admin', name: 'Admin' }, isAdmin: true } as unknown as Parameters<typeof loadSidebarProjects>[0];
        const project = (suffix: string, createdAt: string, status: 'active' | 'done' = 'active') =>
            ({ id: `${id}${suffix}`, name: suffix, urls: [], status, createdAt }) as unknown as Parameters<typeof loadSidebarProjects>[1][number];
        const projects = [project('a', '2026-11-01T00:00:00.000Z'), project('b', '2026-11-02T00:00:00.000Z'), project('c', '2026-11-03T00:00:00.000Z', 'done')];
        const times = (listed: Awaited<ReturnType<typeof loadSidebarProjects>>) =>
            listed.map(({ name, status, createdAt, activityAt }) => [name, status, createdAt, activityAt]);

        // Every project comes with its status, so grouping by status shows the done ones at once.
        // The newer comments are not read: only Recent activity needs them
        for (const sort of ['alphabetical', 'created'] as const)
            expect(times(await loadSidebarProjects(context, projects, { sort, group: 'status' }))).toEqual([
                ['a', 'active', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
                ['b', 'active', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'],
                ['c', 'done', '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z']
            ]);
        // By recent activity, only the listed projects' activity: a done project's only when grouped by status
        expect(times(await loadSidebarProjects(context, projects, { sort: 'recent', group: 'none' }))).toEqual([
            ['a', 'active', '2026-11-01T00:00:00.000Z', '2026-11-08T09:00:00.000Z'],
            ['b', 'active', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'],
            ['c', 'done', '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z']
        ]);
        expect(times(await loadSidebarProjects(context, projects, { sort: 'recent', group: 'status' }))).toEqual([
            ['a', 'active', '2026-11-01T00:00:00.000Z', '2026-11-08T09:00:00.000Z'],
            ['b', 'active', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z'],
            ['c', 'done', '2026-11-03T00:00:00.000Z', '2026-11-09T09:00:00.000Z']
        ]);
    } finally {
        for (const [name, value] of [['COSMOSDB_CONNECTION_STRING', previous.cosmos], ['COSMOSDB_ENDPOINT', previous.endpoint]] as const)
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
    }
});
