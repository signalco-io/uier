import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { feedbackStage } from '@uier/toolbar/verification';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject, DbProjectRef } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { changeFixVerification } from '../src/lib/review/fixVerification';
import { setProjectCommentPrivate, setProjectCommentResolved, setProjectCommentStatus } from '../src/lib/review/comments';
import { triageProjectComments } from '../src/lib/review/bulkTriage';
import { commentRevision } from '../src/lib/review/commentRevision';
import { projectActivity } from '../src/lib/comments/readState';
import { withImportedReplies } from '../src/lib/integrations/importReplies';
import { updateCommentResolved } from '../src/lib/comments/service';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { digestContent } from '../src/lib/notifications/digest';
import { eventMatches, mcpEventData } from '../src/lib/mcp/events/catalog';
import { reviewApiHandler } from '../src/lib/review/http';
import { updateReviewComment } from '../src/lib/review/routes';
import { sha256Hex, signToken, randomToken } from '../src/lib/app/tokens';
import type { IntegrationConnection } from '../src/lib/integrations/model';
import { persistProjectAccess } from './support/projectAccess';

const developer = { kind: 'member', userId: 'u_progress_developer', name: 'Developer', isAdmin: false } as const;
const reviewer = { ...developer, userId: 'u_progress_reviewer', name: 'Reviewer' };
const admin = { ...developer, userId: 'u_progress_admin', name: 'Admin', isAdmin: true };
const members = new Map([developer, reviewer, admin].map(actor => [actor.userId, actor.name]));
const previousLocal = process.env.UIER_LOCAL;
test.beforeEach(() => { process.env.UIER_LOCAL = '1'; });
test.afterEach(() => { if (previousLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousLocal; });

async function fixture(authorId = `user:${reviewer.userId}`, stored: Partial<DbComment> = {}) {
    const project = { id: randomUUID().replaceAll('-', '').slice(0, 12), access: 'guests' } as DbProject;
    await persistProjectAccess(project, [developer, reviewer, admin]);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id: project.id, pk: `project:${project.id}`, workspaceId: project.workspaceId });
    const store = getMemoryCommentsStore();
    // No `inProgress` and no `resolved`: a thread stored before In progress existed
    const comment: DbComment = { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id, authorId,
        path: '/checkout', origin: 'https://reviewed.example', position: { type: 'page' }, number: 7,
        thread: { items: [{ id: 'first', text: 'Fix checkout', authorId, authorName: 'Original guest' }] }, ...stored };
    await store.create(comment);
    const read = async () => (await store.get(comment.domain, comment.id))!.comment;
    const status = (target: Parameters<typeof setProjectCommentStatus>[3], actor: Parameters<typeof setProjectCommentStatus>[1] = developer) =>
        setProjectCommentStatus(project, actor, comment.id, target, randomUUID());
    const ask = (saved: DbComment) => changeFixVerification(project, developer, comment.id,
        { action: 'request', reviewerId: reviewer.userId, expectedRevision: saved.verification?.revision ?? null, idempotencyKey: randomUUID() });
    const decide = (saved: DbComment, action: 'confirm' | 'reject' | 'cancel', actor: Parameters<typeof changeFixVerification>[1], extra: Record<string, unknown> = {}) =>
        changeFixVerification(project, actor, comment.id, { action, expectedRevision: saved.verification!.revision, idempotencyKey: randomUUID(), ...extra });
    return { project, store, comment, read, status, ask, decide };
}

test('stored threads without the flag are Open; In progress moves back and forth with one event each and Done clears it', async () => {
    const f = await fixture();
    expect(feedbackStage(f.comment)).toBe('open');
    const started = await f.status('in-progress');
    expect(started).toMatchObject({ inProgress: true, syncPending: true });
    expect(started.resolved).toBeFalsy();
    expect(feedbackStage(started)).toBe('in-progress');
    expect(started.notificationEvents?.map(event => event.kind)).toEqual(['progress-started']);
    expect(started.activity!.sequence).toBeGreaterThan(0);

    // The same status again changes nothing, adds no event and keeps the sequence
    const again = await f.status('in-progress');
    expect(again.notificationEvents).toHaveLength(1);
    expect(again.activity).toEqual(started.activity);

    const stopped = await f.status('open');
    expect(stopped.inProgress).toBeUndefined();
    expect(feedbackStage(stopped)).toBe('open');
    expect(stopped.notificationEvents?.at(-1)?.kind).toBe('progress-stopped');

    await f.status('in-progress');
    const done = await f.status('done');
    expect(done).toMatchObject({ resolved: true });
    expect(done.inProgress).toBeUndefined();
    expect(done.notificationEvents?.at(-1)?.kind).toBe('resolved');

    // From Done straight to In progress, and Reopen to Open
    const restarted = await f.status('in-progress');
    expect(restarted).toMatchObject({ resolved: false, inProgress: true });
    expect(restarted.notificationEvents?.at(-1)?.kind).toBe('progress-started');
    await f.status('done');
    const reopened = await f.status('open');
    expect(feedbackStage(reopened)).toBe('open');
    expect(reopened.notificationEvents?.at(-1)?.kind).toBe('reopened');
});

test('resolved keeps its meaning: false leaves In progress as it is and reopens Done to Open, true clears it', async () => {
    const f = await fixture();
    await f.status('in-progress');
    const kept = await setProjectCommentResolved(f.project, developer, f.comment.id, false, randomUUID());
    expect(feedbackStage(kept)).toBe('in-progress');
    expect(kept.notificationEvents).toHaveLength(1);
    const done = await setProjectCommentResolved(f.project, developer, f.comment.id, true, randomUUID());
    expect(done.inProgress).toBeUndefined();
    const reopened = await setProjectCommentResolved(f.project, developer, f.comment.id, false, randomUUID());
    expect(feedbackStage(reopened)).toBe('open');
});

test('only those who may resolve set In progress; private threads stay hidden; Ready to verify is not a status write', async () => {
    const visitor = randomToken();
    const guest = { kind: 'guest', visitorId: sha256Hex(visitor) } as const;
    const f = await fixture(guest.visitorId);
    for (const actor of [{ kind: 'guest', visitorId: 'someone-else' } as const, { kind: 'anonymous' } as const])
        await expect(f.status('in-progress', actor)).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|sign_in_required/) });
    expect((await f.read()).inProgress).toBeUndefined();
    // The original guest author may, as they may mark it done
    expect(await f.status('in-progress', guest)).toMatchObject({ inProgress: true });
    await expect(f.status('ready' as never)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(f.status('resolved' as never)).rejects.toMatchObject({ code: 'invalid_request' });

    const hidden = await fixture(`user:${reviewer.userId}`);
    await setProjectCommentPrivate(hidden.project, admin, hidden.comment.id, true);
    await expect(hidden.status('in-progress', developer)).rejects.toMatchObject({ code: 'not_found' });
    expect(await hidden.status('in-progress', admin)).toMatchObject({ inProgress: true });
});

test('a fix check: requested from In progress, Still needs work returns to In progress, a cancel to where it was, Confirm clears it', async () => {
    const f = await fixture();
    // Requested from In progress: Ready to verify, with the flag kept underneath
    const asked = await f.ask(await f.status('in-progress'));
    expect(asked).toMatchObject({ inProgress: true, verification: { outcome: 'pending' } });
    expect(feedbackStage(asked)).toBe('ready');
    // Cancel without a target: back to In progress
    const canceled = await f.decide(asked, 'cancel', developer);
    expect(feedbackStage(canceled)).toBe('in-progress');
    // Cancel to Open, as the app's status menu does
    const toOpen = await f.decide(await f.ask(canceled), 'cancel', developer, { status: 'open' });
    expect(feedbackStage(toOpen)).toBe('open');
    expect(toOpen.inProgress).toBeUndefined();
    // Requested from Open, cancel to In progress
    const toProgress = await f.decide(await f.ask(toOpen), 'cancel', admin, { status: 'in-progress' });
    expect(feedbackStage(toProgress)).toBe('in-progress');
    // Requested from Open, a plain cancel stays Open
    await f.status('open');
    const plain = await f.decide(await f.ask(await f.read()), 'cancel', developer);
    expect(feedbackStage(plain)).toBe('open');
    // Still needs work: someone continues the fix
    const rejected = await f.decide(await f.ask(plain), 'reject', reviewer);
    expect(rejected).toMatchObject({ inProgress: true, verification: { outcome: 'needs-work' } });
    expect(feedbackStage(rejected)).toBe('in-progress');
    const confirmed = await f.decide(await f.ask(rejected), 'confirm', reviewer);
    expect(confirmed).toMatchObject({ resolved: true, verification: { outcome: 'confirmed' } });
    expect(confirmed.inProgress).toBeUndefined();
    // A target is only for cancel; Ready to verify is never a target
    const pending = await f.ask(confirmed);
    await expect(f.decide(pending, 'reject', reviewer, { status: 'open' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(f.decide(pending, 'cancel', developer, { status: 'ready' })).rejects.toMatchObject({ code: 'invalid_request' });
    // A cancel still takes the requester or an admin, with or without a target
    await expect(f.decide(pending, 'cancel', reviewer, { status: 'in-progress' })).rejects.toMatchObject({ code: 'forbidden' });
});

test('a status write leaves Ready to verify without confirmation, and same-status provider polls keep In progress', async () => {
    const f = await fixture();
    const asked = await f.ask(await f.read());
    // Any member who may resolve, as Reopen and Done, ends the check unconfirmed
    const moved = await f.status('in-progress', reviewer);
    expect(moved).toMatchObject({ inProgress: true, verification: { outcome: 'reopened' } });
    expect(moved.verification!.decision).toBeUndefined();
    expect(moved.verification!.revision).not.toBe(asked.verification!.revision);
    await expect(f.decide(asked, 'confirm', reviewer)).rejects.toMatchObject({ code: 'conflict' });

    const connection = { provider: 'github', id: 'connection', connectedBy: developer.userId, twoWaySync: true } as IntegrationConnection;
    const polled = withImportedReplies(moved, connection, { resolved: false, replies: [], at: new Date().toISOString() });
    expect(polled.comment).toBe(moved);
    const closed = withImportedReplies(moved, connection, { resolved: true, replies: [], at: new Date().toISOString() });
    expect(closed.comment).toMatchObject({ resolved: true });
    expect(closed.comment.inProgress).toBeUndefined();
});

test('bulk Done clears In progress; bulk Reopen leaves it as it is', async () => {
    const f = await fixture();
    const started = await f.status('in-progress');
    const run = (comment: DbComment, resolved: boolean) => triageProjectComments(f.project, developer, { kind: 'status', resolved,
        items: [{ id: comment.id, expected: Boolean(comment.resolved), revision: commentRevision(comment), idempotencyKey: randomUUID() }] });
    const reopen = await run(started, false);
    expect(reopen.counts.noop).toBe(1);
    expect(reopen.results[0]!.saved).toMatchObject({ resolved: false, inProgress: true });
    const done = await run(await f.read(), true);
    expect(done.results[0]!.saved).toMatchObject({ resolved: true, inProgress: false });
    expect((await f.read()).inProgress).toBeUndefined();
});

test('counts, packets, digests and MCP events show In progress while it stays open', async () => {
    const f = await fixture();
    const started = await f.status('in-progress');
    expect((await projectActivity(f.comment.domain, `user:${reviewer.userId}`)).summary).toMatchObject({ total: 1, open: 1, inProgress: 1, ready: 0, done: 0 });

    const packet = await projectFeedbackExport(f.project, developer, f.comment.id, undefined, 'https://uier.example');
    expect(packet.context).toMatchObject({ schemaVersion: 1, status: 'open', stage: 'in-progress' });
    expect(packet.markdown).toContain('Status: open (In progress)');

    const event = started.notificationEvents!.at(-1)!;
    const line = digestContent(f.project, started, `user:${reviewer.userId}`, [event], members).lines.join();
    expect(line).toContain('Developer moved #7 (/checkout) to In progress');
    const stopped = await f.status('open');
    expect(digestContent(f.project, stopped, `user:${reviewer.userId}`, [stopped.notificationEvents!.at(-1)!], members).lines.join())
        .toContain('moved #7 (/checkout) back to Open');

    expect(eventMatches('feedback.status_changed', { projectId: f.project.id }, event, f.comment.id, reviewer.userId)).toBe(true);
    expect(mcpEventData('feedback.status_changed', f.project, started, event, members, undefined)).toMatchObject({ change: 'progress_started', resolved: false });
    expect(mcpEventData('feedback.status_changed', f.project, stopped, stopped.notificationEvents!.at(-1)!, members, undefined)).toMatchObject({ change: 'progress_stopped', resolved: false });
});

test('review API PATCH takes status or resolved, never both, and keeps author-only rules for guests', async () => {
    const visitor = randomToken();
    const f = await fixture(sha256Hex(visitor));
    const PATCH = reviewApiHandler<{ projectId: string; id: string }>(updateReviewComment);
    const route = { params: Promise.resolve({ projectId: f.project.id, id: f.comment.id }) };
    const request = (token: string, body: unknown) => new Request(`https://uier.example/api/review/${f.project.id}/comments/${f.comment.id}`, { method: 'PATCH', headers: {
        origin: 'https://reviewed.example', 'content-type': 'application/json', 'X-Uier-Visitor': token,
        'X-Uier-Verification': signToken('review-verification', { projectId: f.project.id, origin: 'https://reviewed.example', authorId: sha256Hex(token) }, 300)
    }, body: JSON.stringify(body) });
    for (const body of [{}, { status: 'ready' }, { status: 'in_progress' }, { resolved: true, status: 'done' }, { resolved: 'true' }])
        expect((await PATCH(request(visitor, body), route)).status, JSON.stringify(body)).toBe(400);
    expect((await PATCH(request(randomToken(), { status: 'in-progress' }), route)).status).toBe(403);
    expect((await f.read()).inProgress).toBeUndefined();
    const response = await PATCH(request(visitor, { status: 'in-progress' }), route);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resolved: false, inProgress: true });
    const legacy = await PATCH(request(visitor, { resolved: false }), route);
    expect(await legacy.json()).toMatchObject({ resolved: false, inProgress: true });
    const done = await (await PATCH(request(visitor, { resolved: true }), route)).json() as { resolved: boolean; inProgress?: boolean };
    expect(done.resolved).toBe(true);
    expect(done.inProgress).toBeUndefined();
});

test('same-origin comments API: the author sets In progress with status; others cannot', async () => {
    const f = await fixture('same-origin-author');
    const context = (authorId: string) => ({ request: new Request('https://uier.example/api/comments'), domain: f.comment.domain,
        project: f.project, actor: { kind: 'guest', visitorId: authorId } as const, visitor: { authorId } });
    await expect(updateCommentResolved(context('someone-else'), f.comment.id, { status: 'in-progress' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await updateCommentResolved(context('same-origin-author'), f.comment.id, { status: 'in-progress' })).toMatchObject({ resolved: false, inProgress: true });
    expect(await updateCommentResolved(context('same-origin-author'), f.comment.id, { resolved: false })).toMatchObject({ inProgress: true });
    const done = await updateCommentResolved(context('same-origin-author'), f.comment.id, { status: 'done' });
    expect(done).toMatchObject({ resolved: true });
    expect(done.inProgress).toBeUndefined();
});
