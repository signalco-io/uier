import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { POST as postComment } from '../app/api/review/[projectId]/comments/route';
import { GET as getComment } from '../app/api/review/[projectId]/comments/[id]/route';
import { POST as start } from '../app/api/review/[projectId]/review-sessions/route';
import { POST as submit } from '../app/api/review/[projectId]/review-sessions/[id]/submit/route';
import { POST as resume } from '../app/api/review/[projectId]/review-sessions/[id]/resume/route';
import { DELETE as discard } from '../app/api/review/[projectId]/review-sessions/[id]/held/route';
import { createProject, updateProject } from '../src/lib/app/projects';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, getWorkspace } from '../src/lib/app/workspaces';
import { randomToken, signToken } from '../src/lib/app/tokens';
import { getAppStore } from '../src/lib/app/store';
import { memberId, type DbMember } from '../src/lib/app/model';
import type { DbReviewSession } from '../src/lib/db/schema';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { memberActor, resolveActor } from '../src/lib/review/actor';
import { createProjectComment, projectPartition, replyToProjectComment, setProjectCommentResolved } from '../src/lib/review/comments';
import { reviewSessionDocumentId } from '../src/lib/review/reviewSessionRelease';
import { openReviewSession, prepareReviewReleases, sendReviewSession, startReviewSession } from '../src/lib/review/reviewSessions';

const base = 'http://127.0.0.1:6514';
const previousLocal = process.env.UIER_LOCAL;
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    if (previousLocal === undefined) delete process.env.UIER_LOCAL;
    else process.env.UIER_LOCAL = previousLocal;
});

async function fixture() {
    const owner = await findOrCreateUser(`review-owner-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(owner);
    const project = await createProject({ user: owner, workspace: (await getWorkspace(member.workspaceId))! },
        { name: 'Website review', urls: ['https://reviewed.example'] });
    await updateProject(project.workspaceId, project.id, { access: 'guests' });
    project.access = 'guests';
    const reviewer = await findOrCreateUser(`review-member-${randomUUID()}@example.com`);
    await getAppStore().create<DbMember>({
        type: 'member', id: memberId(reviewer.id), pk: project.pk, workspaceId: project.workspaceId,
        userId: reviewer.id, email: reviewer.email, role: 'commenter', projects: [project.id], createdAt: new Date().toISOString()
    });
    const memberHeaders = (uid: string) => ({ Authorization: `Bearer ${signToken('review', { uid, pid: project.id }, 3600)}` });
    const guest = { 'X-Uier-Visitor': randomToken() };
    const request = (method: string, headers: HeadersInit = memberHeaders(reviewer.id), body?: unknown) =>
        new Request(`${base}/api/review/${project.id}`, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body) });
    const route = { params: Promise.resolve({ projectId: project.id }) };
    const detail = (id: string) => ({ params: Promise.resolve({ projectId: project.id, id }) });
    const actor = (await memberActor(project, reviewer.id))!;
    return { project, owner, reviewer, actor, guest, memberHeaders, request, route, detail, domain: projectPartition(project.id) };
}

type Draft = { id: string; draftId: string; revision: number; number?: number };
type Comment = { id: string; reviewSession?: { id: string; revision: number; held: boolean; number?: number } };
const json = async <T,>(response: Response | Promise<Response>) => await (await response).json() as T;
const comment = (draft: Draft, path = '/') => ({
    kind: 'feedback' as const, path, position: { type: 'page' as const }, text: 'Fix the heading', idempotencyKey: randomUUID(),
    reviewSessionId: draft.id, reviewDraftId: draft.draftId
});

test('review drafts survive inactivity, publish one batch and resume the same review', async () => {
    const f = await fixture();
    const starts = await Promise.all([start(f.request('POST'), f.route), start(f.request('POST'), f.route)]);
    expect(starts.map(result => result.status)).toEqual([200, 200]);
    const [draft, duplicate] = await Promise.all(starts.map(result => result.json() as Promise<Draft>));
    expect(duplicate).toEqual(draft);

    const posts = await Promise.all([postComment(f.request('POST', undefined, comment(draft!, '/one')), f.route),
        postComment(f.request('POST', undefined, comment(draft!, '/two')), f.route)]);
    expect(posts.map(result => result.status)).toEqual([201, 201]);
    const [first, second] = await Promise.all([json<Comment>(posts[0]!), json<Comment>(posts[1]!)]);
    expect(first.reviewSession).toMatchObject({ id: draft!.id, revision: 1, held: true });

    const store = getCommentsStore();
    const record = (await store.reviewSessionRecord<DbReviewSession>(f.domain, reviewSessionDocumentId(draft!.id)))!;
    await store.writeReviewSessionBatch(f.domain, [{ operation: 'replace', etag: record.etag, doc: { ...record.doc, lastActivityAt: '2024-01-01T00:00:00.000Z' } }]);
    await prepareReviewReleases(store);
    expect(await store.listReviewReleases(f.domain)).toEqual([]);
    const returning = await resolveActor(f.request('GET', f.memberHeaders(f.reviewer.id)), f.project);
    expect(await openReviewSession(f.project, returning))
        .toMatchObject({ id: draft!.id, pendingCount: 2, state: 'open' });
    const admin = (await memberActor(f.project, f.owner.id))!;
    await replyToProjectComment(f.request('POST'), f.project, admin, first.id, { text: 'I will fix it.', idempotencyKey: randomUUID() });
    const held = (await store.get(f.domain, first.id))!.comment;
    expect(held.notificationEvents?.map(event => [event.kind, event.reviewHeld])).toEqual([['comment', true], ['reply', true]]);
    expect(held.notificationPending).toBeUndefined();
    expect(held.syncPending).toBeUndefined();

    const input = { draftId: draft!.draftId, revision: 0, idempotencyKey: randomUUID(), title: 'Home page review' };
    const sending = await Promise.all([submit(f.request('POST', undefined, input), f.detail(draft!.id)), submit(f.request('POST', undefined, input), f.detail(draft!.id))]);
    expect(sending.map(result => result.status)).toEqual([200, 200]);
    const [sent, retried] = await Promise.all(sending.map(result => result.json()));
    expect(sent).toEqual(retried);
    expect(sent).toMatchObject({ id: draft!.id, number: 1, revision: 1, pendingCount: 0, state: 'submitted' });
    expect(await store.listReviewReleases(f.domain)).toEqual([expect.objectContaining({ threadIds: expect.arrayContaining([first.id, second.id]), emailPending: true })]);
    expect((await json<Comment>(getComment(f.request('GET', f.memberHeaders(f.owner.id)), f.detail(first.id)))).reviewSession)
        .toMatchObject({ id: draft!.id, number: 1, held: false, canResume: false });
    const reopened = await (await resume(f.request('POST'), f.detail(draft!.id))).json() as Draft;
    expect(reopened).toMatchObject({ id: draft!.id, number: 1, revision: 1 });
    expect(reopened.draftId).not.toBe(draft!.draftId);
    expect((await postComment(f.request('POST', undefined, comment(draft!)), f.route)).status).toBe(409);
    await setProjectCommentResolved(f.project, admin, first.id, true);
    expect((await store.get(f.domain, first.id))!.comment.notificationPending).toBe(true);
    const third = await json<Comment>(postComment(f.request('POST', undefined, comment(reopened, '/three')), f.route));
    const next = await (await submit(f.request('POST', undefined, { draftId: reopened.draftId, revision: 1, idempotencyKey: randomUUID() }), f.detail(reopened.id))).json();
    expect(next).toMatchObject({ id: reopened.id, number: 1, revision: 2, threadCount: 3 });
    expect(await store.listReviewReleases(f.domain)).toEqual([
        expect.objectContaining({ revision: 1, threadIds: expect.arrayContaining([first.id, second.id]) }),
        expect.objectContaining({ revision: 2, threadIds: [third.id] })
    ]);
});

test('guest session state stays with its visitor and admins may discard pending threads', async () => {
    const f = await fixture();
    const draft = await (await start(f.request('POST', f.guest), f.route)).json() as Draft;
    const rejected = await postComment(f.request('POST', { 'X-Uier-Visitor': randomToken() }, { ...comment(draft), authorName: 'Other visitor' }), f.route);
    expect(rejected.status).toBe(409);
    const created = await postComment(f.request('POST', f.guest, { ...comment(draft), authorName: 'Website visitor' }), f.route);
    expect(created.status).toBe(201);
    const { id } = await json<Comment>(created);
    expect((await discard(f.request('DELETE', undefined, { draftId: draft.draftId }), f.detail(draft.id))).status).toBe(404);
    expect((await discard(f.request('DELETE', f.memberHeaders(f.owner.id), { draftId: draft.draftId }), f.detail(draft.id))).status).toBe(200);
    expect((await getComment(f.request('GET', f.guest), f.detail(id))).status).toBe(404);
    expect(await getCommentsStore().listReviewReleases(f.domain)).toEqual([]);
});

test('an interrupted discard is retried and leaves the published revision intact', async () => {
    const f = await fixture();
    const initial = await json<Draft>(start(f.request('POST'), f.route));
    const published = await json<Comment>(postComment(f.request('POST', undefined, comment(initial)), f.route));
    await submit(f.request('POST', undefined, { draftId: initial.draftId, revision: 0, idempotencyKey: randomUUID() }), f.detail(initial.id));
    const next = await json<Draft>(resume(f.request('POST'), f.detail(initial.id)));
    const withdrawn = await json<Comment>(postComment(f.request('POST', undefined, comment(next)), f.route));
    const store = getCommentsStore();
    const record = (await store.reviewSessionRecord<DbReviewSession>(f.domain, reviewSessionDocumentId(initial.id)))!;
    expect(await store.writeReviewSessionBatch(f.domain, [{
        operation: 'replace', etag: record.etag, doc: { ...record.doc, state: 'discarding' }
    }])).toBe('ok');
    await prepareReviewReleases(store);
    expect(await store.get(f.domain, published.id)).not.toBeNull();
    expect(await store.get(f.domain, withdrawn.id)).toBeNull();
    expect((await store.reviewSessionRecord<DbReviewSession>(f.domain, reviewSessionDocumentId(initial.id)))?.doc)
        .toMatchObject({ state: 'submitted', revision: 1, threadCount: 1, pendingThreadIds: [] });
    const reopened = await json<Draft>(resume(f.request('POST'), f.detail(initial.id)));
    expect(reopened.draftId).not.toBe(next.draftId);
    expect((await postComment(f.request('POST', undefined, comment(next)), f.route)).status).toBe(409);
});

test('a post racing Send either joins the committed batch or leaves its draft unsaved', async () => {
    const f = await fixture();
    const draft = await json<Draft>(start(f.request('POST'), f.route));
    const first = await json<Comment>(postComment(f.request('POST', undefined, comment(draft)), f.route));
    const [created, sent] = await Promise.all([
        postComment(f.request('POST', undefined, comment(draft)), f.route),
        submit(f.request('POST', undefined, { draftId: draft.draftId, revision: 0, idempotencyKey: randomUUID() }), f.detail(draft.id))
    ]);
    expect(sent.status).toBe(200);
    const release = (await getCommentsStore().listReviewReleases(f.domain))[0]!;
    expect(release.threadIds).toContain(first.id);
    if (created.status === 201) expect(release.threadIds).toContain((await json<Comment>(created)).id);
    else {
        expect(created.status).toBe(409);
        expect(release.threadIds).toEqual([first.id]);
    }
});

test('a removed reviewer cannot publish their held comments and an admin can send them', async () => {
    const f = await fixture();
    const draft = await json<Draft>(start(f.request('POST'), f.route));
    const created = await json<Comment>(postComment(f.request('POST', undefined, comment(draft)), f.route));
    await getAppStore().delete(f.project.pk, memberId(f.reviewer.id));
    const input = { draftId: draft.draftId, revision: 0, idempotencyKey: randomUUID() };
    await expect(sendReviewSession(f.project, f.actor, draft.id, input)).rejects.toMatchObject({ code: 'sign_in_required' });
    expect(await getCommentsStore().listReviewReleases(f.domain)).toEqual([]);
    const sent = await submit(f.request('POST', f.memberHeaders(f.owner.id), input), f.detail(draft.id));
    expect(sent.status).toBe(200);
    expect(await getCommentsStore().listReviewReleases(f.domain)).toEqual([expect.objectContaining({
        authorId: `user:${f.reviewer.id}`, submittedBy: `user:${f.owner.id}`, threadIds: [created.id]
    })]);
});

test('the final send publishes 100 held threads together and rejects additional comments', async () => {
    const f = await fixture();
    const draft = (await startReviewSession(f.project, f.actor))!;
    const store = getCommentsStore();
    const ids: string[] = [];
    for (let index = 0; index < 100; index++) {
        const created = await createProjectComment(f.request('POST'), f.project, f.actor, {
            ...comment({ ...draft, draftId: draft.draftId! }, `/page-${index}`), position: { type: 'page' }, origin: f.project.urls[0]!
        });
        ids.push(created.id);
    }
    expect(await store.listReviewReleases(f.domain)).toEqual([]);
    await expect(createProjectComment(f.request('POST'), f.project, f.actor, {
        ...comment({ ...draft, draftId: draft.draftId! }, '/page-101'), position: { type: 'page' }, origin: f.project.urls[0]!
    })).rejects.toMatchObject({ code: 'review_session_full' });
    await sendReviewSession(f.project, f.actor, draft.id, { draftId: draft.draftId!, revision: 0, idempotencyKey: randomUUID() });
    expect(await store.listReviewReleases(f.domain)).toEqual([expect.objectContaining({ threadIds: ids })]);
    const published = await Promise.all(ids.map(id => store.get(f.domain, id)));
    const releaseTimes = new Set(published.map(saved => saved?.comment.reviewSession?.releasedAt));
    expect(releaseTimes.size).toBe(1);
    expect(releaseTimes.has(undefined)).toBe(false);
});
