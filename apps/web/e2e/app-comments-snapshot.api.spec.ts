import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadAppCommentsSnapshot } from '../src/lib/app/appCommentsSnapshot';
import type { AppContext } from '../src/lib/app/context';
import { getAppStore } from '../src/lib/app/store';
import { userPk, workspacePk, type DbProject, type DbUser, type DbWorkspace } from '../src/lib/app/model';
import type { DbComment } from '../src/lib/db/schema';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { parseCommentsQuery } from '../src/components/app/comments/commentsQuery';
import { markThreadRead } from '../src/lib/comments/readState';
import { persistProjectAccess } from './support/projectAccess';

const query = parseCommentsQuery({});
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });

test('the revision endpoint requires a session and rejects cross-site browser reads without caching', async ({ request }) => {
    const url = '/api/projects/zzzzzzzzzzzz/comments/revision';
    const signedOut = await request.get(url);
    expect(signedOut.status()).toBe(401);
    expect(signedOut.headers()['cache-control']).toBe('private, no-store');
    expect(signedOut.headers().vary?.split(',').map(value => value.trim().toLowerCase())).toContain('cookie');
    const crossSite = await request.get(url, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status()).toBe(403);
    expect(crossSite.headers()['cache-control']).toBe('private, no-store');
});

async function fixture() {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const viewer = { userId: `u_snapshot_${suffix}`, name: 'Reviewer', isAdmin: false };
    const other = { userId: `u_snapshot_other_${suffix}`, name: 'Other member', isAdmin: false };
    const project = await persistProjectAccess({ id: suffix.padEnd(12, 'a'), access: 'guests', aiTitles: 'off' } as DbProject, [viewer, other]);
    const user = (await getAppStore().get<DbUser>(userPk(viewer.userId), viewer.userId))!.doc;
    const workspace = { type: 'workspace', id: project.workspaceId, pk: workspacePk(project.workspaceId), name: 'Review workspace', aiTitles: false } as DbWorkspace;
    const context = { user, workspace, isAdmin: false, member: { role: 'commenter' } } as AppContext;
    const store = getMemoryCommentsStore();
    const now = new Date().toISOString();
    const shown: DbComment = { id: `comment_${suffix}`, domain: `project:${project.id}`, projectId: project.id, path: '/pricing',
        origin: project.urls[0], position: { type: 'page' }, kind: 'feedback', authorId: `user:${other.userId}`,
        createdAt: now, updatedAt: now, activity: { sequence: 1, byActor: { [`user:${other.userId}`]: 1 } },
        thread: { items: [{ id: 'first', authorId: `user:${other.userId}`, text: 'Visible feedback', createdAt: now }] } };
    const hidden: DbComment = { ...shown, id: `comment_hidden_${suffix}`, private: true,
        thread: { items: [{ ...shown.thread.items[0]!, text: 'Private feedback' }] } };
    await store.create(shown); await store.create(hidden);
    const snapshot = () => loadAppCommentsSnapshot(context, project, query);
    return { project, context, viewer, other, shown, hidden, store, snapshot };
}

test('app revisions cover only the rendered authorized snapshot and ignore local presentation filters', async () => {
    const f = await fixture();
    const first = (await f.snapshot())!;
    expect(first.comments).toHaveLength(1);
    expect(first.comments[0]?.text).toBe('Visible feedback');
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
    expect((await f.snapshot())!.revision).toBe(first.revision);
    expect((await loadAppCommentsSnapshot(f.context, f.project, parseCommentsQuery({ status: 'done', q: 'local filter', people: 'mine', view: 'board' })))!.revision).toBe(first.revision);
    const privateRow = (await f.store.get(f.hidden.domain, f.hidden.id))!;
    expect(await f.store.replace({ ...privateRow.comment, thread: { items: [{ ...privateRow.comment.thread.items[0]!, text: 'Still private' }] } }, privateRow.etag)).toBe('ok');
    expect((await f.snapshot())!.revision).toBe(first.revision);
    const visible = (await f.store.get(f.shown.domain, f.shown.id))!;
    expect(await f.store.replace({ ...visible.comment, thread: { items: [{ ...visible.comment.thread.items[0]!, text: 'Changed visible feedback' }] } }, visible.etag)).toBe('ok');
    expect((await f.snapshot())!.revision).not.toBe(first.revision);
});

test('app revisions include another tab\'s read cursor, current names and current project policy', async () => {
    const f = await fixture();
    const first = (await f.snapshot())!;
    expect(first.comments[0]?.activity?.unread).toBe(true);
    const comment = (await f.store.get(f.shown.domain, f.shown.id))!.comment;
    await markThreadRead(comment, `user:${f.viewer.userId}`, 1);
    const read = (await f.snapshot())!;
    expect(read.comments[0]?.activity?.unread).toBe(false);
    expect(read.revision).not.toBe(first.revision);
    const person = (await getAppStore().get<DbUser>(userPk(f.other.userId), f.other.userId))!;
    await getAppStore().replace({ ...person.doc, name: 'Renamed member' }, person.etag);
    const renamed = (await f.snapshot())!;
    expect(renamed.comments[0]?.author.name).toBe('Renamed member');
    expect(renamed.revision).not.toBe(read.revision);
    const restricted = (await loadAppCommentsSnapshot(f.context, { ...f.project, access: 'disabled' }, query))!;
    expect(restricted.comments[0]?.permissions.reply).toBe(false);
    expect(restricted.revision).not.toBe(renamed.revision);
    expect(await loadAppCommentsSnapshot(f.context, f.project, { ...query, author: 'not-an-author-reference' }, () => {
        throw new Error('Invalid author scopes must not start member enrichment');
    })).toBeNull();
});

test('an agent lease expiring changes the rendered revision without a document write', async () => {
    const f = await fixture();
    const row = (await f.store.get(f.shown.domain, f.shown.id))!;
    const until = Date.now() + 60_000;
    const comment = { ...row.comment, assigneeId: f.viewer.userId, assigneeAgent: {
        kind: 'claude' as const, assigneeId: f.viewer.userId, setBy: `user:${f.viewer.userId}`, setAt: new Date().toISOString(), workingUntil: new Date(until).toISOString()
    } };
    expect(await f.store.replace(comment, row.etag)).toBe('ok');
    const working = (await f.snapshot())!;
    expect(working.comments[0]?.assignee?.agent?.workingUntil).toBeTruthy();
    const now = Date.now;
    try {
        Date.now = () => until + 1;
        const idle = (await f.snapshot())!;
        expect(idle.comments[0]?.assignee?.agent?.workingUntil).toBeUndefined();
        expect(idle.revision).not.toBe(working.revision);
    } finally { Date.now = now; }
});
