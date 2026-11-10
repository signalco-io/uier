import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { compareArchivedOrder, sortBoardColumn } from '../src/components/app/comments/commentOrder';
import { boardArchiveActionSchema, boardSortActionSchema } from '../src/components/app/comments/actionSchemas';
import { boardSort, boardSortInputSchema, boardSortOptions, boardSortsOf, defaultBoardSort, withBoardSort } from '../src/lib/app/boardSort';
import { canSortProjectBoard, saveProjectBoardArchive, saveProjectBoardSort } from '../src/lib/app/projectBoard';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { createProject, getProject } from '../src/lib/app/projects';
import { getAppStore } from '../src/lib/app/store';
import { workspacePk, type DbProject } from '../src/lib/app/model';
import { appActor } from '../src/lib/app/projectComments';
import { parseActionInput } from '../src/lib/app/validation';
import { UserFacingError } from '../src/lib/app/actionErrors';
import type { AppContext } from '../src/lib/app/context';
import type { ProjectActor } from '../src/lib/review/actor';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { PUBLIC_WORKSPACE_ID, USER_FEEDBACK_PROJECT_ID, provisionPublicProject } from '../src/lib/comments/publicProject';

// Each column of a project's board has its own sort, saved on the project for everyone who opens the board.

test.beforeAll(() => {
    process.env.UIER_LOCAL = '1';
});

const threads = [
    { id: 'a', number: 1, priority: 'normal' as const, createdAt: '2026-01-01', updatedAt: '2026-05-01', completedAt: '2026-03-01' },
    { id: 'b', number: 2, priority: 'urgent' as const, createdAt: '2026-01-02', updatedAt: '2026-01-02', completedAt: '2026-06-01' },
    { id: 'c', number: 3, priority: 'low' as const, createdAt: '2026-01-03', updatedAt: '2026-04-01', completedAt: '2026-02-01' },
    { id: 'd', number: 4, priority: 'normal' as const, createdAt: '2026-01-04', updatedAt: '2026-01-04' }
];

test('each sort orders a column, a copy, and ties keep the given order', () => {
    const ids = (sort: Parameters<typeof sortBoardColumn>[1]) => sortBoardColumn(threads, sort).map(thread => thread.id);
    // Priority, then the newest number (today's active columns)
    expect(ids('priority')).toEqual(['b', 'd', 'a', 'c']);
    expect(ids('newest')).toEqual(['d', 'c', 'b', 'a']);
    expect(ids('oldest')).toEqual(['a', 'b', 'c', 'd']);
    expect(ids('updated')).toEqual(['a', 'c', 'd', 'b']);
    // Recently completed (today's Done); one without a completion time falls back to its update
    expect(ids('completed')).toEqual(['b', 'a', 'c', 'd']);
    expect(threads.map(thread => thread.id)).toEqual(['a', 'b', 'c', 'd']);

    // The same time: by number, in the sort's direction; an unknown time goes last either way
    const sameTime = [
        { id: 'x', number: 7, createdAt: '2026-02-01' },
        { id: 'y', number: 9, createdAt: '2026-02-01' },
        { id: 'z', number: 8 }
    ];
    expect(sortBoardColumn(sameTime, 'newest').map(thread => thread.id)).toEqual(['y', 'x', 'z']);
    expect(sortBoardColumn(sameTime, 'oldest').map(thread => thread.id)).toEqual(['x', 'y', 'z']);
    // Same update time: the usual order (priority, then number)
    const updated = [
        { id: 'low', number: 5, priority: 'low' as const, updatedAt: '2026-02-01' },
        { id: 'high', number: 1, priority: 'high' as const, updatedAt: '2026-02-01' }
    ];
    expect(sortBoardColumn(updated, 'updated').map(thread => thread.id)).toEqual(['high', 'low']);
});

test('Archive orders by when each thread was archived, newest first, like Done by completion', () => {
    const archived = [
        { id: 'early', number: 9, priority: 'urgent' as const, archivedAt: '2026-03-01', completedAt: '2026-09-01' },
        { id: 'late', number: 1, priority: 'low' as const, archivedAt: '2026-06-01' },
        // The same time: the usual order (priority, then number)
        { id: 'tie-normal', number: 5, archivedAt: '2026-04-01' },
        { id: 'tie-high', number: 2, priority: 'high' as const, archivedAt: '2026-04-01' },
        // No readable time: its last update
        { id: 'legacy', number: 3, archivedAt: 'not a time', updatedAt: '2026-05-01' }
    ];
    expect([...archived].sort(compareArchivedOrder).map(thread => thread.id)).toEqual(['late', 'legacy', 'tie-high', 'tie-normal', 'early']);
});

test('columns offer their own sorts, and a saved value a column does not offer reads as its default', () => {
    expect(boardSortOptions('open')).toEqual(['priority', 'newest', 'oldest', 'updated']);
    expect(boardSortOptions('in-progress')).toEqual(boardSortOptions('open'));
    expect(boardSortOptions('ready')).toEqual(boardSortOptions('open'));
    expect(boardSortOptions('done')).toEqual(['completed', 'priority', 'newest', 'oldest', 'updated']);
    expect(defaultBoardSort('open')).toBe('priority');
    expect(defaultBoardSort('done')).toBe('completed');

    expect(boardSortsOf(undefined)).toEqual({ open: 'priority', 'in-progress': 'priority', ready: 'priority', done: 'completed' });
    expect(boardSortsOf({ open: 'oldest', done: 'updated' })).toEqual({ open: 'oldest', 'in-progress': 'priority', ready: 'priority', done: 'updated' });
    expect(boardSort({ open: 'completed' }, 'open')).toBe('priority');
    expect(boardSort({ ready: 'sideways' as never }, 'ready')).toBe('priority');

    expect(boardSortInputSchema.safeParse({ status: 'done', sort: 'completed' }).success).toBe(true);
    expect(boardSortInputSchema.safeParse({ status: 'open', sort: 'newest' }).success).toBe(true);
    for (const input of [{ status: 'open', sort: 'completed' }, { status: 'open', sort: 'random' }, { status: 'archived', sort: 'newest' }, { status: 'open' }])
        expect(boardSortInputSchema.safeParse(input).success).toBe(false);

    // The action parses the project too, before anything is read
    const projectId = 'abcdefghijkl';
    expect(parseActionInput(boardSortActionSchema, { projectId, status: 'done', sort: 'oldest' })).toEqual({ projectId, status: 'done', sort: 'oldest' });
    expect(() => parseActionInput(boardSortActionSchema, { projectId, status: 'in-progress', sort: 'completed' })).toThrow(UserFacingError);
    expect(() => parseActionInput(boardSortActionSchema, { projectId: '../x', status: 'open', sort: 'newest' })).toThrow(UserFacingError);
    expect(parseActionInput(boardArchiveActionSchema, { projectId, expanded: true })).toEqual({ projectId, expanded: true });
    expect(() => parseActionInput(boardArchiveActionSchema, { projectId, expanded: 'yes' })).toThrow(UserFacingError);
    expect(() => parseActionInput(boardArchiveActionSchema, { projectId: '../x', expanded: false })).toThrow(UserFacingError);
});

test('only choices other than a column\'s default are kept on the project', () => {
    const project = { id: 'p', boardSorts: { open: 'newest' as const, ready: 'completed' as never } };
    expect(withBoardSort(project, 'done', 'oldest')).toEqual({ id: 'p', boardSorts: { open: 'newest', done: 'oldest' } });
    expect(withBoardSort(project, 'open', 'priority')).toEqual({ id: 'p' });
    const unsorted: { id: string; boardSorts?: undefined } = { id: 'p' };
    expect(withBoardSort(unsorted, 'done', 'completed')).toEqual({ id: 'p' });
});

async function adminContext(prefix: string): Promise<AppContext> {
    const user = await findOrCreateUser(`${prefix}-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const workspace = (await getWorkspace(member.workspaceId))!;
    return { user, member, workspace, isAdmin: true, memberships: [{ member, workspace }] };
}

test('members save a column\'s sort on the project, for everyone who opens its board', async () => {
    const admin = await adminContext('board-sort');
    const created = await createProject(admin, { name: 'Board sort', urls: ['https://board-sort.example.com'] });
    const reload = async () => (await getProject(admin.workspace.id, created.id))!;
    expect(created.boardSorts).toBeUndefined();

    await saveProjectBoardSort(await reload(), appActor(admin), 'open', 'oldest');
    await saveProjectBoardSort(await reload(), appActor(admin), 'done', 'priority');
    expect((await reload()).boardSorts).toEqual({ open: 'oldest', done: 'priority' });
    expect(boardSortsOf((await reload()).boardSorts)).toEqual({ open: 'oldest', 'in-progress': 'priority', ready: 'priority', done: 'priority' });

    // A commenter of the project moves its cards and triages it, so they may sort it too
    const commenter: ProjectActor = { kind: 'member', userId: `user-${randomUUID()}`, name: 'Commenter', isAdmin: false };
    expect(canSortProjectBoard(created, commenter)).toBe(true);
    await saveProjectBoardSort(await reload(), commenter, 'in-progress', 'updated');
    expect((await reload()).boardSorts).toEqual({ open: 'oldest', 'in-progress': 'updated', done: 'priority' });

    // Back to the defaults: nothing is left on the project
    for (const [status, sort] of [['open', 'priority'], ['in-progress', 'priority'], ['done', 'completed']] as const)
        await saveProjectBoardSort(await reload(), appActor(admin), status, sort);
    expect(await reload()).not.toHaveProperty('boardSorts');

    // The service checks the column's choices again, and guests can't sort
    await expect(saveProjectBoardSort(await reload(), appActor(admin), 'open', 'completed')).rejects.toThrow('Choose a sort this column offers.');
    await expect(saveProjectBoardSort(await reload(), appActor(admin), 'open', 'sideways' as never)).rejects.toThrow(UserFacingError);
    const guest: ProjectActor = { kind: 'guest', visitorId: randomUUID() };
    expect(canSortProjectBoard(created, guest)).toBe(false);
    await expect(saveProjectBoardSort(await reload(), guest, 'open', 'newest')).rejects.toThrow('You can’t change how this board is sorted.');
    expect(await reload()).not.toHaveProperty('boardSorts');
});

test('members expand the board\'s Archive column on the project, and collapsed leaves no field', async () => {
    const admin = await adminContext('board-archive');
    const created = await createProject(admin, { name: 'Board archive', urls: ['https://board-archive.example.com'] });
    const reload = async () => (await getProject(admin.workspace.id, created.id))!;
    expect(created).not.toHaveProperty('boardArchiveExpanded');

    await saveProjectBoardArchive(await reload(), appActor(admin), true);
    expect((await reload()).boardArchiveExpanded).toBe(true);
    // The same choice again writes nothing; the sorts are untouched
    await saveProjectBoardArchive(await reload(), appActor(admin), true);
    expect((await reload()).boardArchiveExpanded).toBe(true);
    expect(await reload()).not.toHaveProperty('boardSorts');

    // A commenter of the project may sort it, so they may collapse it too
    const commenter: ProjectActor = { kind: 'member', userId: `user-${randomUUID()}`, name: 'Commenter', isAdmin: false };
    await saveProjectBoardArchive(await reload(), commenter, false);
    expect(await reload()).not.toHaveProperty('boardArchiveExpanded');

    const guest: ProjectActor = { kind: 'guest', visitorId: randomUUID() };
    await expect(saveProjectBoardArchive(await reload(), guest, true)).rejects.toThrow('You can’t change how this board is shown.');
    expect(await reload()).not.toHaveProperty('boardArchiveExpanded');

    // uier's user feedback project: its staff only, as for its sorts
    const app = getAppStore();
    const read = async () => (await app.get<DbProject>(workspacePk(PUBLIC_WORKSPACE_ID), USER_FEEDBACK_PROJECT_ID))!.doc;
    await provisionPublicProject(app, getMemoryCommentsStore());
    const account: ProjectActor = { kind: 'member', userId: `user-${randomUUID()}`, name: 'Account', isAdmin: false };
    await expect(saveProjectBoardArchive(await read(), account, true)).rejects.toThrow('You can’t change how this board is shown.');
    expect(await read()).not.toHaveProperty('boardArchiveExpanded');
});

test('uier\'s user feedback project takes a sort from its staff only, and provisioning keeps it', async () => {
    const app = getAppStore();
    const read = async () => (await app.get<DbProject>(workspacePk(PUBLIC_WORKSPACE_ID), USER_FEEDBACK_PROJECT_ID))!.doc;
    await provisionPublicProject(app, getMemoryCommentsStore());
    const before = await read();
    // Accounts are its commenters and see only their own threads: the staff's board is not theirs to sort
    const account: ProjectActor = { kind: 'member', userId: `user-${randomUUID()}`, name: 'Account', isAdmin: false };
    expect(canSortProjectBoard(before, account)).toBe(false);
    await expect(saveProjectBoardSort(before, account, 'open', 'newest')).rejects.toThrow('You can’t change how this board is sorted.');
    expect((await read()).boardSorts).toEqual(before.boardSorts);

    const staff: ProjectActor = { kind: 'member', userId: `user-${randomUUID()}`, name: 'Staff', isAdmin: true };
    try {
        await saveProjectBoardSort(await read(), staff, 'open', 'newest');
        expect((await read()).boardSorts?.open).toBe('newest');
        await provisionPublicProject(app, getMemoryCommentsStore());
        expect((await read()).boardSorts?.open).toBe('newest');
    } finally {
        await saveProjectBoardSort(await read(), staff, 'open', 'priority');
    }
});
