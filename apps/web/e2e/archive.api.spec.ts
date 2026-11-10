import { loadProjectComments } from '../src/lib/app/projectComments';
import { loadMyWork } from '../src/lib/app/myWork';
import type { AppContext } from '../src/lib/app/context';
import { getAppStore } from '../src/lib/app/store';
import { memberId, userPk, type DbUser, type DbMember } from '../src/lib/app/model';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { feedbackStage } from '@uier/toolbar/verification';
import { matchesStatus } from '../../../packages/toolbar/src/components/sidebar/CommentsFilter';
import type { CommentItem } from '../../../packages/toolbar/src/components/@types/Comments';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject } from '../src/lib/app/model';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { archiveSql } from '../src/lib/repo/archiveFilter';
import { setProjectCommentArchived, setProjectCommentPrivate, setProjectCommentStatus, replyToProjectComment } from '../src/lib/review/comments';
import { listReviewComments, reviewActivitySummary } from '../src/lib/review/readRoutes';
import { updateReviewComment } from '../src/lib/review/routes';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { markThreadRead, projectActivity } from '../src/lib/comments/readState';
import { updateCommentSchema } from '../src/lib/comments/validation';
import { threadHistoryView } from '../src/lib/comments/history';
import { eventMatches, mcpEventData } from '../src/lib/mcp/events/catalog';
import { statusMatches } from '../src/components/app/comments/commentLabels';
import { persistProjectAccess } from './support/projectAccess';

const author = { kind: 'member', userId: 'u_archive_author', name: 'Author', isAdmin: false } as const;
const member = { ...author, userId: 'u_archive_member', name: 'Member' };
const admin = { ...author, userId: 'u_archive_admin', name: 'Admin', isAdmin: true };
const originalLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => { if (originalLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = originalLocal; });

async function fixture(extra: Partial<DbComment> = {}) {
    const project = { id: randomUUID().replaceAll('-', '').slice(0, 12), access: 'guests' } as DbProject;
    await persistProjectAccess(project, [author, member, admin]);
    const comment: DbComment = {
        id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id,
        path: '/checkout', origin: project.urls[0], position: { type: 'page' }, authorId: `user:${author.userId}`,
        number: 1, thread: { items: [{ id: 'first', text: 'Keep this feedback', authorId: `user:${author.userId}` }] },
        createdAt: '2026-01-01T00:00:00.000Z', ...extra
    };
    const store = getMemoryCommentsStore();
    await store.create(comment);
    const archive = (value: boolean, actor = member, key = randomUUID()) => setProjectCommentArchived(project, actor, comment.id, value, key);
    const read = async () => (await store.get(comment.domain, comment.id))!.comment;
    return { project, comment, store, archive, read };
}

test('archive and restore preserve each workflow, completion time, verification and evidence', async () => {
    for (const stage of ['open', 'in-progress', 'ready', 'done'] as const) {
        const f = await fixture({ resolved: stage === 'done', inProgress: stage === 'in-progress',
            completedAt: '2025-12-01T00:00:00.000Z',
            ...(stage === 'ready' ? { verification: { revision: 'pending-revision', outcome: 'pending' } as DbComment['verification'] } : {}),
            screenshot: { width: 120, height: 80, contentType: 'image/png', bytes: 100 }, assigneeIds: [author.userId] });
        const archived = await f.archive(true);
        expect(archived.archivedAt).toBeTruthy();
        expect(feedbackStage(archived)).toBe(stage);
        for (const key of ['position', 'thread', 'completedAt', 'verification', 'screenshot', 'assigneeIds'] as const)
            expect(archived[key]).toEqual(f.comment[key]);
        const repeated = await f.archive(true);
        expect(repeated.activity).toEqual(archived.activity);
        expect(repeated.archivedAt).toBe(archived.archivedAt);
        const restored = await f.archive(false);
        expect(restored.archivedAt).toBeUndefined();
        expect(feedbackStage(restored)).toBe(stage);
        expect(restored.history?.map(entry => entry.action)).toEqual(['archived', 'restored']);
        // Legacy status updates do not implicitly restore an archived thread.
        await f.archive(true);
        expect((await setProjectCommentStatus(f.project, member, f.comment.id, 'done')).archivedAt).toBeTruthy();
    }
});

test('archived lists, unread and counts share visibility and environment scopes', async () => {
    const f = await fixture();
    await f.archive(true);
    const hidden = { ...f.comment, id: `comment_${randomUUID()}`, private: true, archivedAt: new Date().toISOString() };
    const otherEnvironment = { ...hidden, id: `comment_${randomUUID()}`, private: false, origin: 'https://other.example' };
    const ordinary = { ...f.comment, id: `comment_${randomUUID()}`, resolved: true };
    for (const comment of [hidden, otherEnvironment, ordinary]) await f.store.create(comment);
    const actor = { kind: 'guest', visitorId: 'reader' } as const;
    const context = (query = '') => ({ project: f.project, actor, siteOrigin: f.project.urls[0],
        request: new Request(`https://uier.io/api/review/${f.project.id}/comments?scope=site${query}`) });
    const list = async (query = '') => await (await listReviewComments(context(query))).json() as { id: string }[];
    expect((await list()).map(comment => comment.id)).toEqual([ordinary.id]);
    expect((await list('&archive=only')).map(comment => comment.id)).toEqual([f.comment.id]);
    expect((await list('&archive=all')).map(comment => comment.id).sort()).toEqual([f.comment.id, ordinary.id].sort());
    expect((await list('&archive=only&unread=true')).map(comment => comment.id)).toEqual([f.comment.id]);
    expect(await (await reviewActivitySummary(context())).json()).toMatchObject({ archived: 1, total: 1, open: 0, done: 1, unread: 1 });
    expect((await projectActivity(f.comment.domain, `user:${author.userId}`)).summary.open).toBe(0);
    await markThreadRead(await f.read(), 'reader', (await f.read()).activity!.sequence);
    expect(await list('&archive=only&unread=true')).toEqual([]);
});

test('archive uses status authority, rechecks privacy and retains member-only history', async () => {
    const f = await fixture({ authorId: 'guest-owner', thread: { items: [{ id: 'first', text: 'Private evidence', authorId: 'guest-owner', authorName: 'Owner' }] } });
    const guest = { kind: 'guest', visitorId: 'guest-owner' } as const;
    await expect(setProjectCommentArchived(f.project, { ...guest, visitorId: 'other' }, f.comment.id, true)).rejects.toMatchObject({ code: 'forbidden' });
    const saved = await setProjectCommentArchived(f.project, guest, f.comment.id, true);
    expect(threadHistoryView(saved, { member: false }, new Map())).toBeUndefined();
    await setProjectCommentPrivate(f.project, admin, f.comment.id, true);
    await expect(f.archive(false)).rejects.toMatchObject({ code: 'not_found' });
    expect((await setProjectCommentArchived(f.project, admin, f.comment.id, false)).archivedAt).toBeUndefined();
});

test('archive receipts replay safely and concurrent replies survive restoration', async () => {
    const f = await fixture();
    const key = randomUUID();
    await f.archive(true, member, key);
    await f.archive(false);
    await f.archive(true, member, key);
    expect((await f.read()).archivedAt).toBeUndefined();
    await f.archive(true);
    await Promise.all([
        f.archive(false),
        replyToProjectComment(new Request('http://localhost'), f.project, author, f.comment.id, { text: 'Retain this reply', idempotencyKey: randomUUID() })
    ]);
    const saved = await f.read();
    expect(saved.archivedAt).toBeUndefined();
    expect(saved.thread.items).toHaveLength(2);
    expect(saved.thread.items[1]!.text).toBe('Retain this reply');
    const packet = await projectFeedbackExport(f.project, author, f.comment.id, undefined, 'https://uier.io');
    expect(packet.context.status).toBe('open');
    await f.archive(true);
    const archived = await projectFeedbackExport(f.project, author, f.comment.id, undefined, 'https://uier.io');
    expect(archived.context.archivedAt).toBeTruthy();
    expect(archived.context.stage).toBe('open');
    expect(archived.markdown).toContain('Archived');
    const event = (await f.read()).notificationEvents!.at(-1)!;
    expect(eventMatches('feedback.archive_changed', { projectId: f.project.id }, event, f.comment.id, member.userId)).toBe(true);
    expect(mcpEventData('feedback.archive_changed', f.project, await f.read(), event, new Map(), 'https://uier.io')).toMatchObject({ archived: true });
});

test('archive filtering precedes limits and both UI filters exclude it from All and Done', async () => {
    const f = await fixture();
    await f.store.create({ ...f.comment, id: 'comment_newer', createdAt: '2026-11-10', archivedAt: '2026-11-10' });
    for (const list of [() => f.store.listAll(f.comment.domain, 1, undefined, undefined, 'exclude'),
        () => f.store.list(f.comment.domain, '/checkout', 1, undefined, undefined, 'exclude')])
        expect((await list()).map(comment => comment.id)).toEqual([f.comment.id]);
    expect(archiveSql('exclude')).toContain('NOT IS_STRING(c.archivedAt)');
    expect(archiveSql('only')).toContain('AND IS_STRING(c.archivedAt)');
    for (const stage of ['open', 'in-progress', 'ready', 'done'] as const) {
        const comment = { archivedAt: '2026-11-10', resolved: stage === 'done', inProgress: stage === 'in-progress' } as CommentItem;
        expect(statusMatches('all', stage, comment.archivedAt)).toBe(false);
        expect(statusMatches('done', stage, comment.archivedAt)).toBe(false);
        expect(statusMatches('archived', stage, comment.archivedAt)).toBe(true);
        for (const status of ['all', 'unresolved', 'resolved'] as const) expect(matchesStatus(comment, status)).toBe(false);
        expect(matchesStatus(comment, 'archived')).toBe(true);
    }
});

test('PATCH accepts one archive operation and rejects mixed, missing or invalid operations', async () => {
    for (const input of [{}, { archived: 'true' }, { archived: true, resolved: true }, { archived: false, status: 'open' }])
        expect(updateCommentSchema.safeParse(input).success).toBe(false);
    const f = await fixture();
    const request = (archived: boolean) => new Request(`https://uier.io/api/review/${f.project.id}/comments/${f.comment.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived })
    });
    const context = { project: f.project, actor: member, request: request(true) };
    expect(await (await updateReviewComment(context, { id: f.comment.id })).json()).toMatchObject({ archivedAt: expect.any(String), resolved: false });
    expect(await (await updateReviewComment({ ...context, request: request(false) }, { id: f.comment.id })).json()).not.toHaveProperty('archivedAt');
});

test('public comments API archives and restores only the author\'s thread', async ({ request, playwright, baseURL }) => {
    const path = `/archive-api/${randomUUID()}`;
    const created = await request.post('/api/comments', { data: { path, position: { type: 'page' }, kind: 'feedback', text: 'Retain the original content' } });
    expect(created.status()).toBe(201);
    const comment = await created.json() as { id: string };
    const endpoint = `/api/comments/${comment.id}`;
    const other = await playwright.request.newContext({ baseURL });
    try {
        expect((await other.patch(endpoint, { data: { archived: true } })).status()).toBe(403);
        const saved = await request.patch(endpoint, { data: { archived: true } });
        expect(saved.status()).toBe(200);
        expect(await saved.json()).toMatchObject({ archivedAt: expect.any(String), resolved: false });
        expect(await (await request.get(`/api/comments?path=${encodeURIComponent(path)}`)).json()).toEqual([]);
        const archived = await (await request.get(`/api/comments?path=${encodeURIComponent(path)}&archive=only`)).json();
        expect(archived).toHaveLength(1);
        expect(archived[0]).toMatchObject({ id: comment.id, thread: { items: [{ text: 'Retain the original content' }] } });
        expect((await request.patch(endpoint, { data: { archived: false } })).status()).toBe(200);
        expect(await (await request.get(`/api/comments?path=${encodeURIComponent(path)}`)).json()).toHaveLength(1);
    } finally { await other.dispose(); }
});


test('ordinary API, app and My work survive more than a full window of newer archived feedback', async () => {
    const f = await fixture({ assigneeIds: [author.userId] });
    for (let index = 0; index < 1001; index++)
        await f.store.create({ ...f.comment, id: `comment_archived_${index}`, number: index + 2,
            createdAt: '2026-11-10T00:00:00.000Z', archivedAt: '2026-11-10T00:00:00.000Z' });
    // Inclusive repository reads keep their legacy contract, while explicit scopes filter before TOP.
    expect(await f.store.listAll(f.comment.domain, 1000)).toHaveLength(1000);
    expect((await f.store.list(f.comment.domain, '/checkout', 200, undefined, undefined, 'exclude')).map(c => c.id)).toEqual([f.comment.id]);
    for (const query of ['path=/checkout', 'scope=site', 'scope=site&unread=true']) {
        const context = { project: f.project, actor: member, siteOrigin: f.project.urls[0],
            request: new Request(`https://uier.io/api/review/${f.project.id}/comments?${query}`) };
        const ordinary = await (await listReviewComments(context)).json() as { id: string }[];
        expect(ordinary.map((c: { id: string }) => c.id)).toEqual([f.comment.id]);
        expect(await (await listReviewComments({ ...context, request: new Request(`${context.request.url}&archive=only`) })).json()).toHaveLength(200);
    }
    const app = getAppStore();
    const context = { user: (await app.get<DbUser>(userPk(author.userId), author.userId))!.doc,
        member: (await app.get<DbMember>(f.project.pk, memberId(author.userId)))!.doc, workspace: { id: f.project.workspaceId },
        isAdmin: false, memberships: [] } as unknown as AppContext;
    const comments = await loadProjectComments(context, f.project, 'all');
    expect(comments.some(c => c.id === f.comment.id && !c.archivedAt)).toBe(true);
    expect(comments.filter(c => c.archivedAt)).toHaveLength(1000);
    const work = await loadMyWork(context);
    expect(work.assigned.map(item => item.comment.id)).toEqual([f.comment.id]);
    expect(work.capped).toBe(false);
});
