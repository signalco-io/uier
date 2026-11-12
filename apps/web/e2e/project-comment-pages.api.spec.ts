import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import { expect, test } from '@playwright/test';
import { loadAppCommentsSnapshot } from '../src/lib/app/appCommentsSnapshot';
import type { AppContext } from '../src/lib/app/context';
import type { DbProject } from '../src/lib/app/model';
import type { DbComment } from '../src/lib/db/schema';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { parseCommentsQuery } from '../src/components/app/comments/commentsQuery';
import { persistProjectAccess } from './support/projectAccess';
import { boardSorts, type BoardSort } from '../src/lib/app/boardSort';
import { sortBoardColumn } from '../src/components/app/comments/commentOrder';
import { CommentQueryBudgetError } from '../src/lib/repo/commentQuerySource';
import { markThreadRead } from '../src/lib/comments/readState';

test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
// Observe the fixture's storage boundary without replacing production dependencies.
function memoryDomain(domain: string) {
    return (globalThis as unknown as { __uierCommentsMemoryStore2: { domains: Map<string, Map<unknown, unknown>> } }).__uierCommentsMemoryStore2.domains.get(domain)!;
}
async function fixture() {
    const project = await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12), aiTitles: 'off' } as DbProject);
    const context = { user: { id: 'admin', name: 'Admin' }, workspace: { id: project.workspaceId, aiTitles: false }, isAdmin: true } as AppContext;
    const domain = `project:${project.id}`, store = getCommentsStore();
    const row = (index: number, fields: Partial<DbComment> = {}): DbComment => ({ id: `row-${String(index).padStart(5, '0')}`, domain,
        projectId: project.id, path: '/pricing', origin: project.urls[0], number: index + 1, authorId: 'user:member',
        position: { type: 'page' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        thread: { items: [{ id: 'first', text: `Feedback ${index}`, authorId: 'user:member' }] }, ...fields });
    const load = (params: Record<string, string> = {}, input: Parameters<typeof loadAppCommentsSnapshot>[5] = {}, projectFields: Partial<DbProject> = {}) =>
        loadAppCommentsSnapshot(context, { ...project, ...projectFields }, parseCommentsQuery({ view: 'board', ...params }), undefined, undefined, input).then(data => data!);
    return { project, context, domain, store, row, load };
}

test('project pages are bounded, count the entire authorized project and defer Archive and thread bodies', async () => {
    const f = await fixture();
    for (let i = 0; i < 1105; i++) await f.store.create(f.row(i));
    for (let i = 2000; i < 2040; i++) await f.store.create(f.row(i, { archivedAt: '2026-02-01T00:00:00.000Z' }));
    await f.store.create(f.row(9999, { private: true, priority: 'urgent', authorId: 'user:admin', thread: { items: [{ id: 'first', text: 'Private', authorId: 'user:admin' }] } }));
    const viewer = { ...f.context, user: { ...f.context.user, id: 'member' }, isAdmin: false };
    const board = (await loadAppCommentsSnapshot(viewer, f.project, parseCommentsQuery({ view: 'board' })))!;
    expect(board.comments).toHaveLength(25);
    expect(board.paging.statusCounts).toMatchObject({ open: 1105, active: 1105, archived: 40, all: 1105 });
    expect(board.paging.lanes.open?.total).toBe(1105);
    expect(board.paging.lanes.archive).toEqual({ ids: [], total: 40, nextCursor: null });
    expect(board.comments.every(comment => comment.summary && !comment.replies.length && !comment.history && !comment.screenshot)).toBe(true);
    const list = await f.load({ view: 'list' });
    expect(list.comments).toHaveLength(25);
    expect(list.paging.lanes.list?.total).toBe(1106);
    const expanded = await f.load({}, { archiveExpanded: true });
    expect(expanded.paging.lanes.archive?.ids).toHaveLength(25);
    expect(expanded.comments.filter(comment => comment.archivedAt)).toHaveLength(25);
    const archived = await f.load({ view: 'list', status: 'archived' });
    expect(archived.comments).toHaveLength(25);
    expect(archived.paging.lanes.list?.total).toBe(40);
});

test('refresh depths restore multiple lanes with one scan and one read/subscription load', async () => {
    const f = await fixture();
    for (let i = 0; i < 320; i++) await f.store.create(f.row(i, i < 110 ? {} : i < 220 ? { inProgress: true } : { resolved: true }));
    const entries = memoryDomain(f.domain), values = Map.prototype.values;
    let scans = 0, reads = 0, subscriptions = 0;
    const observer = mock.method(Map.prototype, 'values', function(this: Map<unknown, unknown>) {
        if (this === entries) scans++;
        const partitions = (globalThis as unknown as { __uierAppMemoryStore: { partitions: Map<string, Map<unknown, unknown>> } }).__uierAppMemoryStore.partitions;
        for (const [pk, partition] of partitions) if (this === partition) {
            if (pk.startsWith('review-read:')) reads++;
            if (pk.startsWith('notifications:')) subscriptions++;
        }
        return values.call(this);
    });
    try {
        const data = await f.load({}, { depths: { open: 4, 'in-progress': 3, done: 2 } });
        expect([scans, reads, subscriptions]).toEqual([1, 1, 1]);
        expect(data.comments).toHaveLength(225);
        expect(data.paging.lanes.open?.ids).toHaveLength(100);
        expect(data.paging.lanes['in-progress']?.ids).toHaveLength(75);
        expect(data.paging.lanes.done?.ids).toHaveLength(50);
        const next = await f.load({}, { lane: 'open', cursor: data.paging.lanes.open!.nextCursor! });
        expect(next.paging.lanes.open?.ids).toHaveLength(10);
        expect(next.paging.lanes.open?.ids.some(id => data.paging.lanes.open!.ids.includes(id))).toBe(false);
        await expect(f.load({}, { depths: { open: 9 } })).rejects.toMatchObject({ status: 400 });
        await expect(f.load({}, { depths: { missing: 2 } })).rejects.toMatchObject({ status: 400 });
    } finally { observer.mock.restore(); }
});

test('status unread totals include only off-page unread threads, with verification disabled and enabled', async () => {
    const f = await fixture();
    for (let i = 0; i < 35; i++) await f.store.create(f.row(i, { inProgress: true, verification: { outcome: 'pending', requester: 'user:member', reviewer: 'user:admin', requestedAt: '2026-01-01T00:00:00.000Z' } as DbComment['verification'] }));
    const first = await f.load({}, {}, { verificationEnabled: true });
    expect(first.paging.lanes.ready?.ids).toHaveLength(25);
    for (const view of first.comments) await markThreadRead((await f.store.get(f.domain, view.id))!.comment, 'user:admin', 1);
    const refreshed = await f.load({ view: 'list', status: 'open' }, {}, { verificationEnabled: true });
    expect(refreshed.comments).toHaveLength(0);
    expect(refreshed.paging.statusUnread).toMatchObject({ open: 0, ready: 10, active: 10, all: 10 });
    const disabled = await f.load({ status: 'ready' });
    expect(disabled.query.status).toBe('active');
    expect(disabled.paging.lanes.ready).toBeUndefined();
    expect(disabled.paging.statusCounts).toMatchObject({ ready: 0, 'in-progress': 35 });
});

test('budget failures retain page filters explicitly and HTTP callers still fail instead of showing partial totals', async () => {
    const f = await fixture();
    await f.store.create(f.row(0));
    const entries = memoryDomain(f.domain), values = Map.prototype.values;
    const observer = mock.method(Map.prototype, 'values', function(this: Map<unknown, unknown>) {
        if (this === entries) throw new CommentQueryBudgetError();
        return values.call(this);
    });
    try {
        const fallback = await f.load({}, { budgetFallback: true });
        expect(fallback.paging.queryTooExpensive).toBe(true);
        expect(fallback.environments.length).toBeGreaterThan(0);
        expect(fallback.comments).toEqual([]);
        await expect(f.load()).rejects.toBeInstanceOf(CommentQueryBudgetError);
    } finally { observer.mock.restore(); }
});

test('a thread turning private between scan and point reads only disappears from that page', async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) await f.store.create(f.row(i));
    const entries = memoryDomain(f.domain), get = Map.prototype.get;
    const observer = mock.method(Map.prototype, 'get', function(this: Map<unknown, unknown>, key: unknown) {
        const value = get.call(this, key);
        if (this === entries && key === 'row-00000') value.document.private = true;
        return value;
    });
    try {
        const data = (await loadAppCommentsSnapshot({ ...f.context, isAdmin: false, user: { ...f.context.user, id: 'other' } }, f.project, parseCommentsQuery({ view: 'board' })))!;
        expect(data.comments.map(row => row.id)).toEqual(['row-00002', 'row-00001']);
        expect(data.paging.lanes.open?.ids).toEqual(['row-00002', 'row-00001']);
    } finally { observer.mock.restore(); }
});

test('cursor pages follow each supported column sort, without duplicates on equal sort keys', async () => {
    const f = await fixture();
    const rows: DbComment[] = [];
    for (let i = 0; i < 63; i++) {
        const row = f.row(i, { priority: i % 2 ? 'high' : 'normal', resolved: true,
            createdAt: new Date(Date.UTC(2025, 0, i % 12 + 1)).toISOString(), completedAt: new Date(Date.UTC(2026, 0, i % 6 + 1)).toISOString(),
            updatedAt: new Date(Date.UTC(2026, 0, i % 7 + 1)).toISOString(), archivedAt: '2026-03-01T00:00:00.000Z' });
        rows.push(row); await f.store.create(row);
    }
    for (const sort of boardSorts) {
        const lane = sort === 'completed' ? 'done' : 'archive';
        for (const row of rows) { const current = (await f.store.get(f.domain, row.id))!; await f.store.replace({ ...current.comment, archivedAt: lane === 'done' ? undefined : row.archivedAt }, current.etag); }
        const options = { boardSorts: { [lane]: sort as BoardSort } };
        let data = await f.load({}, { archiveExpanded: true }, options);
        const ids = [...data.paging.lanes[lane]!.ids];
        let cursor = data.paging.lanes[lane]!.nextCursor;
        while (cursor) {
            data = await f.load({}, { lane, cursor, archiveExpanded: true }, options);
            ids.push(...data.paging.lanes[lane]!.ids); cursor = data.paging.lanes[lane]!.nextCursor;
        }
        const expected = sortBoardColumn([...rows].sort((a, b) => a.id.localeCompare(b.id)), sort).map(row => row.id);
        expect(ids, sort).toEqual(expected); expect(new Set(ids).size).toBe(63);
    }
});

test('cursors bind scope, viewer, filters and sort; deletion does not shift the next page', async () => {
    const f = await fixture();
    for (let i = 0; i < 60; i++) await f.store.create(f.row(i));
    const first = await f.load(), cursor = first.paging.lanes.open!.nextCursor!;
    const deleted = (await f.store.get(f.domain, first.paging.lanes.open!.ids[0]!))!;
    await f.store.delete(f.domain, deleted.comment.id, deleted.etag);
    const next = await f.load({}, { lane: 'open', cursor });
    expect(next.paging.lanes.open!.ids).toHaveLength(25);
    expect(next.paging.lanes.open!.ids.some(id => first.paging.lanes.open!.ids.includes(id))).toBe(false);
    expect(next.paging.lanes.open!.total).toBe(59);
    await expect(f.load({ q: 'different query' }, { lane: 'open', cursor })).rejects.toThrow(/cursor/);
    await expect(f.load({}, { lane: 'done', cursor })).rejects.toThrow(/cursor/);
    await expect(f.load({}, { lane: 'open', cursor }, { boardSorts: { open: 'oldest' } })).rejects.toThrow(/cursor/);
    await expect(loadAppCommentsSnapshot({ ...f.context, user: { ...f.context.user, id: 'member' } }, f.project, parseCommentsQuery({ view: 'board' }), undefined, undefined, { lane: 'open', cursor })).rejects.toThrow(/cursor/);
    await expect(f.load({}, { lane: 'open', cursor: cursor + 'x' })).rejects.toThrow(/cursor/);
    const now = Date.now;
    try { Date.now = () => now() + 16 * 60_000; await expect(f.load({}, { lane: 'open', cursor })).rejects.toThrow(/cursor/); }
    finally { Date.now = now; }
});

test('search and people/page/status filters find off-page reply matches; details remain independently addressable', async () => {
    const f = await fixture();
    for (let i = 0; i < 1100; i++) await f.store.create(f.row(i, { path: '/other', priority: 'urgent' }));
    const target = f.row(1101, { number: 1, path: '/pricing/annual', priority: 'high', assigneeIds: ['admin'],
        thread: { items: [{ id: 'first', text: 'An old opener', authorId: 'user:member' }, { id: 'reply', text: 'a reply-only-needle', authorId: 'user:member' }] } });
    await f.store.create(target);
    const result = await f.load({ q: 'reply-only-needle', page: '/pricing/*', people: 'assigned', priority: 'high' });
    expect(result.paging.statusCounts.open).toBe(1);
    expect(result.comments.map(comment => comment.id)).toEqual([target.id]);
    expect(result.comments[0]?.replies).toEqual([]);
    const deepLink = await f.load({}, { openId: target.id });
    expect(deepLink.openedComment?.replies[0]?.text).toBe('a reply-only-needle');
    const filteredBoard = await f.load({ status: 'done' });
    expect(filteredBoard.comments).toEqual([]);
    expect(filteredBoard.paging.lanes.done?.total).toBe(0);
});

test('custom status columns have independent pages/totals and removed ids fall back to the category default', async () => {
    const f = await fixture();
    const { defaultStatusWorkflow } = await import('../src/lib/app/statusWorkflow');
    const workflow = { ...defaultStatusWorkflow, statuses: [...defaultStatusWorkflow.statuses,
        { id: 'approved', category: 'open' as const, label: 'Approved', description: '' },
        { id: 'rejected', category: 'archive' as const, label: 'Rejected', description: '' }] };
    const projectFields = { statusWorkflow: { mode: 'replace' as const, value: workflow } };
    for (let i = 0; i < 40; i++) {
        await f.store.create(f.row(i, { workflowStatusId: 'approved' }));
        await f.store.create(f.row(i + 100, { workflowStatusId: 'removed-status' }));
        await f.store.create(f.row(i + 200, { archivedAt: '2026-03-01T00:00:00.000Z', archiveStatusId: 'rejected' }));
    }
    const first = await f.load({}, { archiveExpanded: true }, projectFields);
    expect(first.paging.lanes.approved?.total).toBe(40);
    expect(first.paging.lanes.open?.total).toBe(40);
    expect(first.paging.lanes.rejected?.total).toBe(40);
    expect(first.paging.lanes.archive?.total).toBe(0);
    expect(first.paging.lanes.approved?.ids).toHaveLength(25);
    expect(first.paging.lanes.open?.ids).toHaveLength(25);
    expect(first.paging.lanes.rejected?.ids).toHaveLength(25);
    const next = await f.load({}, { lane: 'approved', cursor: first.paging.lanes.approved!.nextCursor!, archiveExpanded: true }, projectFields);
    expect(next.comments).toHaveLength(15);
    expect(next.comments.every(comment => comment.workflowStatusId === 'approved')).toBe(true);
    const renamed = { ...projectFields, statusWorkflow: { ...projectFields.statusWorkflow, value: { ...workflow, statuses: workflow.statuses.filter(status => status.id !== 'approved') } } };
    const removed = await f.load({}, {}, renamed);
    expect(removed.paging.lanes.open?.total).toBe(80);
    await expect(f.load({}, { lane: 'approved', cursor: first.paging.lanes.approved!.nextCursor! }, renamed)).rejects.toThrow(/column|cursor/);
});

test('routing scans omit bodies/diagnostics and enrich only the selected page; text search explicitly opts in', async () => {
    const f = await fixture();
    for (let i = 0; i < 80; i++) await f.store.create(f.row(i, { device: { browser: 'private device' }, thread: { items: [
        { id: 'first', text: 'Large opener body', authorId: 'user:member' }, { id: 'second', text: 'reply-only-needle', quotedText: 'Quoted secret', authorId: 'user:member' }
    ] } }));
    const metadata = await f.store.queryCandidates(f.domain, { includeText: false });
    expect(metadata).toHaveLength(80);
    expect(JSON.stringify(metadata)).not.toMatch(/Large opener body|reply-only-needle|Quoted secret|private device|queryMetadata/);
    expect(metadata[0]?.thread.items).toHaveLength(2);
    const data = await f.load();
    expect(data.comments).toHaveLength(25);
    expect(data.comments[0]?.text).toBe('Large opener body');
    expect((await f.load({ q: 'reply-only-needle' })).paging.statusCounts.open).toBe(80);
});

test('label filters count and page off-page assignments against the effective catalog', async () => {
    const f = await fixture();
    const label = { id: 'label_quality', name: 'Quality', color: 'ink' as const, description: '' };
    const settings = { threadLabels: { mode: 'replace' as const, value: [label] } };
    for (let i = 0; i < 31; i++) await f.store.create(f.row(i, { labelIds: [label.id] }));
    for (let i = 100; i < 180; i++) await f.store.create(f.row(i));
    const first = await f.load({ label: label.id }, {}, settings);
    expect(first.comments).toHaveLength(25);
    expect(first.paging.lanes.open?.total).toBe(31);
    expect(first.comments.every(comment => comment.labels?.some(value => value.id === label.id))).toBe(true);
    const cursor = first.paging.lanes.open!.nextCursor!;
    const next = await f.load({ label: label.id }, { lane: 'open', cursor }, settings);
    expect(next.comments).toHaveLength(6);
    expect(next.comments.some(comment => first.comments.some(previous => previous.id === comment.id))).toBe(false);
    await expect(f.load({ label: 'label_another' }, { lane: 'open', cursor }, settings)).rejects.toThrow(/cursor/);
    const removed = await f.load({ label: label.id }, {}, { threadLabels: { mode: 'replace', value: [] } });
    expect(removed.paging.statusCounts.open).toBe(0);
    expect(removed.comments).toHaveLength(0);
});

test('merging a continuation preserves the full-window revision and other lane rows', async () => {
    const { mergePage } = await import('../src/components/app/comments/useProjectCommentPages');
    const f = await fixture();
    for (let i = 0; i < 30; i++) await f.store.create(f.row(i));
    await f.store.create(f.row(100, { resolved: true }));
    const first = await f.load();
    await f.store.create(f.row(101, { resolved: true }));
    const next = await f.load({}, { lane: 'open', cursor: first.paging.lanes.open!.nextCursor! });
    expect(next.revision).not.toBe(first.revision);
    const merged = mergePage(first, next, 'open');
    expect(merged.revision).toBe(first.revision);
    expect(merged.revision).not.toBe(next.revision);
    expect(merged.paging.lanes.open?.ids).toHaveLength(30);
    expect(merged.paging.lanes.done?.ids).toEqual(first.paging.lanes.done?.ids);
    expect(merged.comments.some(row => row.id === 'row-00101')).toBe(false);
});

test('label swim lanes page independently, bind cursors and resolve removed definitions as unlabeled', async () => {
    const f = await fixture();
    const labels = [
        { id: 'label_DesignA', name: 'Design', color: 'violet' as const, description: '' },
        { id: 'label_BugB', name: 'Bug', color: 'red' as const, description: '' }
    ];
    const fields = { boardGroupByLabel: true, threadLabels: { mode: 'replace' as const, value: labels } };
    for (let i = 0; i < 31; i++) await f.store.create(f.row(i, { labelIds: i % 2 ? [labels[0]!.id] : labels.map(label => label.id) }));
    await f.store.create(f.row(100, { labelIds: ['label_removed'] }));
    await f.store.create(f.row(101, { labelIds: [labels[1]!.id], archivedAt: '2026-01-02T00:00:00.000Z' }));
    const first = await f.load({}, {}, fields);
    expect(first.paging.lanes['open~label_DesignA']).toMatchObject({ total: 31 });
    expect(first.paging.lanes['open~label_DesignA']?.ids).toHaveLength(25);
    expect(first.paging.lanes['open~label_BugB']?.total).toBe(16);
    expect(first.paging.lanes['open~unlabeled']?.ids).toEqual(['row-00100']);
    expect(first.paging.lanes['archive~label_BugB']).toEqual({ ids: [], total: 1, nextCursor: null });
    const allBug = await f.load({}, { lane: 'open~label_BugB', allIds: true, revisionOnly: true }, fields);
    expect(allBug.paging.lanes['open~label_BugB']?.ids).toHaveLength(16);
    const cursor = first.paging.lanes['open~label_DesignA']!.nextCursor!;
    const next = await f.load({}, { lane: 'open~label_DesignA', cursor }, fields);
    expect(next.paging.lanes['open~label_DesignA']?.ids).toHaveLength(6);
    expect(next.paging.lanes['open~label_DesignA']?.ids.some(id => first.paging.lanes['open~label_DesignA']!.ids.includes(id))).toBe(false);
    await expect(f.load({}, { lane: 'open~label_BugB', cursor }, fields)).rejects.toMatchObject({ status: 400 });
    await expect(f.load({}, { lane: 'open', cursor }, fields)).rejects.toMatchObject({ status: 400 });
    await expect(f.load({}, { lane: 'open~label_DesignA', cursor }, { ...fields, boardGroupByLabel: false })).rejects.toMatchObject({ status: 400 });
    const removed = await f.load({}, {}, { ...fields, threadLabels: { mode: 'replace', value: [] } });
    expect(removed.paging.lanes['open~unlabeled']?.total).toBe(32);
});


test('summary PR cards retain links from complete messages without reply bodies or removal rights', async () => {
    const f = await fixture();
    const opener = 'https://github.com/acme/site/pull/2';
    const reply = 'https://gitlab.com/acme/site/-/merge_requests/4';
    await f.store.create(f.row(1, { thread: { items: [
        { id: 'first', text: `${'Intro '.repeat(100)}${opener}`, authorId: 'user:member' },
        { id: 'reply', text: reply, authorId: 'user:member' },
        { id: 'removed', text: 'https://github.com/acme/site/pull/99', authorId: 'user:member', deletedAt: '2026-01-02T00:00:00.000Z' }
    ] } }));
    const result = await f.load();
    expect(result.comments[0]?.text).not.toContain(opener);
    expect(result.comments[0]?.replies).toEqual([]);
    expect(result.comments[0]?.pullRequests).toEqual([
        { url: opener, canRemove: false }, { url: reply, canRemove: false }
    ]);
});
