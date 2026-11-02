import { loadProjectComments } from '../src/lib/app/projectComments';
import type { AppContext } from '../src/lib/app/context';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { commentPriority, matchesFeedbackSearch } from '@uier/toolbar/triage';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject, DbMember, DbProjectRef, DbTeam } from '../src/lib/app/model';
import { memberId } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { threadActivity } from '../src/lib/comments/activity';
import { feedbackExport } from '../src/lib/comments/feedbackContext';
import { toReviewCommentDto } from '../src/lib/review/dto';
import { commentRevision } from '../src/lib/review/commentRevision';
import { setProjectCommentAssignee, setProjectCommentPriority, setProjectCommentResolved } from '../src/lib/review/comments';
import { triageProjectComments as triage } from '../src/lib/review/bulkTriage';
import { prioritizeReviewComment } from '../src/lib/review/routes';
import { reviewApiHandler } from '../src/lib/review/http';
import { parseCommentsQuery } from '../src/components/app/comments/commentsQuery';
import { persistProjectAccess } from './support/projectAccess';
import { signToken } from '../src/lib/app/tokens';
import { notionBlocks } from '../src/lib/integrations/notion/page';
import { slackRootMessage } from '../src/lib/integrations/slack/message';
import { azureDevOpsProjection } from '../src/lib/integrations/azure-devops/workItem';
import { githubIssueProjection } from '../src/lib/integrations/github/issue';
import { linearIssueProjection } from '../src/lib/integrations/linear/issue';
import type { LinearIssueGeneration } from '../src/lib/integrations/linear/model';

const alice = { kind: 'member', userId: 'u_triage_alice', name: 'Alice', isAdmin: false } as const;
const bob = { ...alice, userId: 'u_triage_bob', name: 'Bob' };
const admin = { ...alice, userId: 'u_triage_admin', name: 'Admin', isAdmin: true };
let mutationStore: ReturnType<typeof getMemoryCommentsStore>;
const triageProjectComments = (...args: Parameters<typeof triage>) => triage(args[0], args[1], args[2], mutationStore);
const previousLocal = process.env.UIER_LOCAL;
test.beforeEach(() => { process.env.UIER_LOCAL = '1'; });
test.afterEach(() => { if (previousLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousLocal; });
async function fixture(count = 1) {
    const project = { id: randomUUID().replaceAll('-', '').slice(0, 12), access: 'guests' } as DbProject;
    await persistProjectAccess(project, [alice, bob, admin]);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id: project.id, pk: `project:${project.id}`, workspaceId: project.workspaceId });
    const store = getMemoryCommentsStore();
    mutationStore = store;
    const comments: DbComment[] = [];
    for (let index = 0; index < count; index++) {
        const comment: DbComment = { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id,
            path: '/checkout', number: index + 1, position: { type: 'page' }, authorId: `user:${bob.userId}`, resolved: false,
            thread: { items: [{ id: 'first', text: 'Checkout feedback', quotedText: 'Pay now', authorId: `user:${bob.userId}` }] } };
        await store.create(comment); comments.push(comment);
    }
    return { project, store, comments };
}
const entry = (comment: DbComment) => ({ id: comment.id, expected: commentPriority(comment.priority), idempotencyKey: randomUUID() });

test('literal deterministic search matches live messages, quotes, canonical paths and public numbers', () => {
    const feedback = { path: '/checkout?view=cart', number: 42, messages: [
        { text: 'Checkout [error] <img>', quotedText: 'Pay NOW' }, { text: 'Card declined', quotedText: 'Try another card' },
        { text: 'hidden-secret', quotedText: 'deleted-quote', deleted: true }
    ] };
    for (const q of ['CHECKOUT', 'declined', 'pay now', 'another card', '/checkout?view', '#42', '42', '[error]', '<img>', 'checkout card'])
        expect(matchesFeedbackSearch(feedback, q), q).toBe(true);
    for (const q of ['hidden-secret', 'deleted-quote', '[a-z]+', '<script>', '#43']) expect(matchesFeedbackSearch(feedback, q), q).toBe(false);
    expect(matchesFeedbackSearch(feedback, '  \n ')).toBe(true);
    expect(parseCommentsQuery({ q: 'a'.repeat(220), priority: 'urgent', people: 'assigned', status: 'all' })).toMatchObject({ q: 'a'.repeat(200), priority: 'urgent', people: 'assigned', status: 'all' });
    expect(parseCommentsQuery({ priority: 'critical', q: ['bad'] })).toMatchObject({ priority: undefined, q: undefined });
});

test('legacy priority is Normal; changes advance activity and integration intent once without emails', async () => {
    const { project, store, comments: [comment] } = await fixture();
    const key = randomUUID();
    const normal = await setProjectCommentPriority(project, alice, comment!.id, 'normal', randomUUID());
    expect(normal.priority).toBeUndefined();
    expect(normal.syncVersion).toBeUndefined();
    const changed = await setProjectCommentPriority(project, alice, comment!.id, 'urgent', key);
    expect(changed.priority).toBe('urgent');
    expect(threadActivity(changed).sequence).toBe(threadActivity(comment!).sequence + 1);
    expect(changed).toMatchObject({ syncVersion: 1, syncPending: true });
    expect(changed.notificationEvents).toBeUndefined();
    expect(await setProjectCommentPriority(project, alice, comment!.id, 'urgent', key)).toEqual(changed);
    const later = await setProjectCommentPriority(project, bob, comment!.id, 'low', randomUUID());
    expect(await setProjectCommentPriority(project, alice, comment!.id, 'urgent', key)).toEqual(later);
    await expect(setProjectCommentPriority(project, alice, comment!.id, 'high', key)).rejects.toMatchObject({ code: 'conflict' });
    expect((await store.get(comment!.domain, comment!.id))!.comment.priority).toBe('low');
});

test('priority validates input and current guest, private, project and membership authority', async () => {
    const { project, store, comments: [comment] } = await fixture();
    await expect(setProjectCommentPriority(project, alice, comment!.id, 'high', 'bad-key')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(setProjectCommentPriority(project, alice, comment!.id, 'critical' as 'high', randomUUID())).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(setProjectCommentPriority(project, { kind: 'guest', visitorId: 'guest' }, comment!.id, 'high', randomUUID())).rejects.toMatchObject({ code: 'forbidden' });
    const foreign = await fixture();
    await expect(setProjectCommentPriority(foreign.project, alice, comment!.id, 'high', randomUUID())).rejects.toMatchObject({ code: 'not_found' });
    const stored = (await store.get(comment!.domain, comment!.id))!;
    await store.replace({ ...stored.comment, private: true }, stored.etag);
    await expect(setProjectCommentPriority(project, alice, comment!.id, 'high', randomUUID())).rejects.toMatchObject({ code: 'not_found' });
    await setProjectCommentPriority(project, bob, comment!.id, 'high', randomUUID());
    await getAppStore().delete(project.pk, memberId(bob.userId));
    await expect(setProjectCommentPriority(project, bob, comment!.id, 'low', randomUUID())).rejects.toMatchObject({ code: 'sign_in_required' });
    expect((await store.get(comment!.domain, comment!.id))!.comment.priority).toBe('high');
});

test('ordinary public enrollment does not grant priority or bulk triage powers', async () => {
    const { project, comments: [comment] } = await fixture();
    const publicProject = { ...project, id: 'uier00000001' };
    await getAppStore().create(publicProject);
    const publicComment = { ...comment!, domain: 'project:uier00000001', id: `comment_${randomUUID()}` };
    await getMemoryCommentsStore().create(publicComment);
    await expect(setProjectCommentPriority(publicProject, alice, publicComment.id, 'high', randomUUID())).rejects.toMatchObject({ code: 'forbidden' });
    await expect(triageProjectComments(publicProject, alice, { kind: 'priority', priority: 'high', items: [entry(publicComment)] })).rejects.toMatchObject({ code: 'forbidden' });
});

test('batch validation rejects duplicate, invalid, empty, oversized and malformed requests before writes', async () => {
    const { project, store, comments: [comment] } = await fixture();
    const initial = (await store.get(comment!.domain, comment!.id))!.etag;
    const item = entry(comment!);
    for (const batch of [
        { kind: 'priority', priority: 'high', items: [] },
        { kind: 'priority', priority: 'high', items: [item, { ...item, idempotencyKey: randomUUID() }] },
        { kind: 'priority', priority: 'urgent', items: Array.from({ length: 51 }, (_, i) => ({ ...item, id: `comment_${i}`, idempotencyKey: randomUUID() })) },
        { kind: 'priority', priority: 'invalid', items: [item] },
        { kind: 'assignment', assigneeId: '<script>', items: [item] },
        { kind: 'status', resolved: true, items: [{ id: item.id, expected: false, idempotencyKey: item.idempotencyKey }] },
        { kind: 'priority', priority: 'high', items: [{ ...item, id: '$sequence' }] },
        { kind: 'delete', items: [item] },
        { kind: 'priority', priority: 'high', items: [{ ...item, extra: 'x'.repeat(32000) }] }
    ]) await expect(triageProjectComments(project, alice, batch)).rejects.toMatchObject({ code: 'invalid_request' });
    expect((await store.get(comment!.domain, comment!.id))!.etag).toBe(initial);
});

test('mixed batch reports changed, no-op, stale and indistinguishable unavailable results', async () => {
    const { project, store, comments } = await fixture(5);
    await setProjectCommentPriority(project, bob, comments[1]!.id, 'high', randomUUID());
    await setProjectCommentPriority(project, bob, comments[2]!.id, 'urgent', randomUUID());
    const privateStored = (await store.get(comments[3]!.domain, comments[3]!.id))!;
    await store.replace({ ...privateStored.comment, private: true }, privateStored.etag);
    const input = { kind: 'priority', priority: 'high', items: [entry(comments[0]!), { ...entry(comments[1]!), expected: 'high' }, entry(comments[2]!), entry(comments[3]!), { ...entry(comments[4]!), id: 'comment_missing' }] };
    const result = await triageProjectComments(project, alice, input);
    expect(result.counts).toEqual({ success: 1, noop: 1, conflict: 1, unavailable: 2, failure: 0 });
    expect(result.results.map(item => item.outcome)).toEqual(['success', 'noop', 'conflict', 'unavailable', 'unavailable']);
    expect(result.results[3]).toEqual({ id: comments[3]!.id, outcome: 'unavailable' });
    expect(result.results[4]).toEqual({ id: 'comment_missing', outcome: 'unavailable' });
    expect((await triageProjectComments(project, alice, input)).counts).toEqual(result.counts);
});

test('interrupted commits retry with durable receipts; a successful replay preserves later work', async () => {
    const { project, store, comments } = await fixture(3);
    const original = store.commitSubmission.bind(store);
    const input = { kind: 'priority', priority: 'high', items: comments.map(entry) };
    store.commitSubmission = async (...args) => {
        if (args[1].id === comments[1]!.id) throw new Error('Simulated interrupted batch');
        const saved = await original(...args);
        if (args[1].id === comments[0]!.id) throw new Error('Simulated lost response after commit');
        return saved;
    };
    let first;
    try { first = await triageProjectComments(project, alice, input); } finally { store.commitSubmission = original; }
    expect(first.counts).toMatchObject({ success: 2, failure: 1 });
    const after = await setProjectCommentPriority(project, bob, comments[0]!.id, 'urgent', randomUUID());
    const retry = await triageProjectComments(project, alice, input);
    expect(retry.counts).toMatchObject({ success: 3, failure: 0 });
    expect((await store.get(after.domain, after.id))!.comment).toEqual(after);
    expect(retry.results[0]!.saved!.priority).toBe('urgent');
    for (const comment of comments.slice(1)) expect(threadActivity((await store.get(comment.domain, comment.id))!.comment).sequence).toBe(2);
});

test('at most four writes run concurrently and access is rechecked for every subsequent item', async () => {
    const { project, store, comments } = await fixture(12);
    const original = store.commitSubmission.bind(store);
    let active = 0, max = 0, calls = 0;
    store.commitSubmission = async (...args) => {
        active++; max = Math.max(max, active);
        try { await new Promise(resolve => setTimeout(resolve, 8)); calls++; return await original(...args); }
        finally { active--; }
    };
    try { expect((await triageProjectComments(project, alice, { kind: 'priority', priority: 'high', items: comments.map(entry) })).counts.success).toBe(12); }
    finally { store.commitSubmission = original; }
    expect(max).toBe(4); expect(calls).toBe(12);
    const fresh = await fixture(8);
    const original2 = fresh.store.commitSubmission.bind(fresh.store);
    let first = true;
    fresh.store.commitSubmission = async (...args) => {
        const result = await original2(...args);
        if (first) { first = false; await getAppStore().delete(fresh.project.pk, memberId(alice.userId)); }
        return result;
    };
    try {
        const result = await triageProjectComments(fresh.project, alice, { kind: 'priority', priority: 'urgent', items: fresh.comments.map(entry) });
        expect(result.counts.unavailable).toBeGreaterThanOrEqual(4);
        expect(result.counts.success + result.counts.unavailable).toBe(8);
    } finally { fresh.store.commitSubmission = original2; }
});

test('assignment checks target eligibility and expected values on conditional-write retries', async () => {
    const { project, store, comments: [comment] } = await fixture();
    const original = store.commitSubmission.bind(store);
    let first = true;
    store.commitSubmission = async (...args) => {
        if (first) {
            first = false;
            const current = (await store.get(comment!.domain, comment!.id))!;
            await store.replace({ ...current.comment, assigneeId: bob.userId }, current.etag);
            return 'conflict';
        }
        return original(...args);
    };
    try {
        const result = await triageProjectComments(project, alice, { kind: 'assignment', assigneeId: alice.userId, items: [{ id: comment!.id, expected: null, idempotencyKey: randomUUID() }] });
        expect(result.counts.conflict).toBe(1);
    } finally { store.commitSubmission = original; }
    expect((await store.get(comment!.domain, comment!.id))!.comment.assigneeId).toBe(bob.userId);
    const member = (await getAppStore().get<DbMember>(project.pk, memberId(bob.userId)))!;
    await getAppStore().delete(member.doc.pk, member.doc.id);
    const failed = await triageProjectComments(project, alice, { kind: 'assignment', assigneeId: bob.userId, items: [{ id: comment!.id, expected: bob.userId, idempotencyKey: randomUUID() }] });
    expect(failed.counts.unavailable).toBe(1);
});

test('priority CAS preserves unrelated replies, assignment and status; status revision guards newer workflow state', async () => {
    const { project, store, comments: [comment] } = await fixture();
    const original = store.commitSubmission.bind(store);
    let first = true;
    store.commitSubmission = async (...args) => {
        if (first) {
            first = false;
            await store.appendThreadItem(comment!.domain, comment!.id, { id: 'reply', text: 'Concurrent reply', authorId: `user:${bob.userId}` }, 50, new Date().toISOString());
            await setProjectCommentAssignee(project, bob, comment!.id, bob.userId);
            await setProjectCommentResolved(project, bob, comment!.id, true);
            return 'conflict';
        }
        return original(...args);
    };
    try { expect((await triageProjectComments(project, alice, { kind: 'priority', priority: 'high', items: [entry(comment!)] })).counts.success).toBe(1); }
    finally { store.commitSubmission = original; }
    const current = (await store.get(comment!.domain, comment!.id))!.comment;
    expect(current).toMatchObject({ priority: 'high', assigneeId: bob.userId, resolved: true });
    expect(current.thread.items).toHaveLength(2);
    const input = { kind: 'status', resolved: false, items: [{ id: current.id, expected: true, revision: commentRevision(current), idempotencyKey: randomUUID() }] };
    const stored = (await store.get(current.domain, current.id))!;
    // A future verification request/decision participates automatically without a schema dependency.
    await store.replace({ ...stored.comment, verification: { id: randomUUID(), revision: 'new-decision', requester: `user:${alice.userId}`, reviewer: `user:${bob.userId}`, requestedAt: new Date().toISOString(), outcome: 'confirmed' } } as DbComment, stored.etag);
    expect((await triageProjectComments(project, alice, input)).counts.conflict).toBe(1);
    expect((await store.get(current.domain, current.id))!.comment.resolved).toBe(true);
});

test('priority projects to member/guest DTOs, exports and every provider packet as context', async () => {
    const { project, comments: [comment] } = await fixture();
    const saved = await setProjectCommentPriority(project, alice, comment!.id, 'urgent', randomUUID());
    const dto = toReviewCommentDto(saved, alice, new Map(), project.urls, 0, new Map(), project)!;
    const guest = toReviewCommentDto(saved, { kind: 'guest', visitorId: 'guest' }, new Map(), [], 0, new Map(), project)!;
    expect(dto).toMatchObject({ priority: 'urgent', permissions: { priority: true } });
    expect(guest).toMatchObject({ priority: 'urgent', permissions: { priority: false } });
    const packet = feedbackExport(dto, { projectId: project.id });
    expect(packet.context.priority).toBe('urgent'); expect(packet.markdown).toContain('Priority: Urgent');
    expect(JSON.stringify(notionBlocks(packet.context))).toContain('Priority: Urgent');
    expect(slackRootMessage(packet.context, 'Project').payload.text).toContain('Priority: Urgent');
    expect(azureDevOpsProjection(packet.context, 'marker').html).toContain('Priority: Urgent');
    expect(githubIssueProjection(packet.context, 'marker').body).toContain('Priority: Urgent');
    expect(linearIssueProjection(packet.context, { marker: 'marker' } as LinearIssueGeneration).description).toContain('Priority: Urgent');
    const oversized = { ...packet.context, feedback: { ...packet.context.feedback!, text: 'x'.repeat(65_000) } };
    for (const value of [githubIssueProjection(oversized, 'marker').body, linearIssueProjection(oversized, { marker: 'marker' } as LinearIssueGeneration).description, azureDevOpsProjection(oversized, 'marker').html]) expect(value).toContain('Priority: Urgent');
});

test('priority review route validates values, requires verified writes and does not let guests edit', async () => {
    const { project, comments: [comment] } = await fixture();
    const handler = reviewApiHandler<{ projectId: string; id: string }>(prioritizeReviewComment);
    const headers = { origin: 'https://reviewed.example', 'Content-Type': 'application/json', authorization: `Bearer ${signToken('review', { uid: alice.userId, pid: project.id }, 3600)}`, 'X-Uier-Verification': signToken('review-verification', { projectId: project.id, origin: 'https://reviewed.example', authorId: `user:${alice.userId}` }, 300) };
    const request = (data: unknown, auth = true) => new Request(`http://localhost/api/review/${project.id}/comments/${comment!.id}/priority`, {
        method: 'PATCH', headers: auth ? headers : { origin: headers.origin, 'Content-Type': 'application/json', 'X-Uier-Visitor': 'a'.repeat(64) }, body: JSON.stringify(data)
    });
    const params = { params: Promise.resolve({ projectId: project.id, id: comment!.id }) };
    const unverified = request({ priority: 'high', idempotencyKey: randomUUID() }); unverified.headers.delete('X-Uier-Verification');
    expect((await handler(unverified, params)).status).toBe(403);
    expect((await handler(request({ priority: 'critical', idempotencyKey: randomUUID() }), params)).status).toBe(400);
    expect((await handler(request({ priority: 'high', idempotencyKey: randomUUID() }, false), params)).status).toBe(403);
    expect((await handler(request({ priority: 'high', idempotencyKey: randomUUID() }), params)).status).toBe(200);
});


test('team-only access and assignment target eligibility are rechecked on a write retry', async () => {
    const { project, store, comments: [comment] } = await fixture();
    const app = getAppStore();
    const member = (await app.get<DbMember>(project.pk, memberId(bob.userId)))!;
    const now = new Date().toISOString();
    const team: DbTeam = { type: 'team', pk: project.pk, id: 'team_triage', workspaceId: project.workspaceId, name: 'Design', nameKey: 'design', state: 'active', projectIds: [project.id], createdBy: admin.userId, updatedBy: admin.userId, createdAt: now, updatedAt: now };
    await app.create(team);
    await app.replace({ ...member.doc, projects: [], teamIds: [team.id] }, member.etag);
    const priorityKey = randomUUID();
    await setProjectCommentPriority(project, bob, comment!.id, 'high', priorityKey);
    const original = store.commitSubmission.bind(store);
    let first = true;
    store.commitSubmission = async (...args) => {
        if (first) { first = false; const current = (await app.get<DbTeam>(project.pk, team.id))!; await app.replace({ ...current.doc, state: 'archived' }, current.etag); return 'conflict'; }
        return original(...args);
    };
    try {
        const result = await triageProjectComments(project, alice, { kind: 'assignment', assigneeId: bob.userId, items: [{ id: comment!.id, expected: null, idempotencyKey: randomUUID() }] });
        expect(result.counts.unavailable).toBe(1);
    } finally { store.commitSubmission = original; }
    await expect(setProjectCommentPriority(project, bob, comment!.id, 'urgent', randomUUID())).rejects.toMatchObject({ code: 'sign_in_required' });
    await expect(setProjectCommentPriority(project, bob, comment!.id, 'high', priorityKey)).rejects.toMatchObject({ code: 'sign_in_required' });
});


test('the 1000-thread search window discloses its cap after private visibility filtering', async () => {
    const { project, store, comments: [template] } = await fixture();
    for (let index = 0; index < 1000; index++) await store.create({ ...template!, id: `comment_window_${index}`, private: index % 2 === 0 });
    let capped = false;
    const context = { user: { id: alice.userId }, isAdmin: false } as AppContext;
    const views = await loadProjectComments(context, project, undefined, undefined, value => { capped = value; });
    expect(capped).toBe(true);
    expect(views.length).toBeLessThan(1000);
    expect(views.length).toBeGreaterThan(0);
    expect(views.every(view => !view.private && view.priority === 'normal')).toBe(true);
    const snapshot = Array.from({ length: 1000 }, (_, index) => ({ path: `/checkout/${index}`, number: index, messages: [{ text: 'Checkout feedback', quotedText: 'Pay now' }, { text: 'Card declined' }] }));
    for (const query of ['pay now', 'declined', '#999', '/checkout/50', 'missing [literal]']) {
        const start = performance.now();
        const results = snapshot.filter(comment => matchesFeedbackSearch(comment, query));
        expect(performance.now() - start).toBeLessThan(200);
        expect(results.length).toBe(query.startsWith('missing') ? 0 : query === '#999' ? 1 : query === '/checkout/50' ? 11 : 1000);
    }
});
