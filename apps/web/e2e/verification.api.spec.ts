import { updateCommentResolved, toPublicCommentDto } from '../src/lib/comments/service';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { DbComment, DbVerification } from '../src/lib/db/schema';
import type { DbProject } from '../src/lib/app/model';
import { memberId } from '../src/lib/app/model';
import { getAppStore } from '../src/lib/app/store';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { changeFixVerification, fixDestination, verificationDetails, verificationPermissions } from '../src/lib/review/fixVerification';
import { setProjectCommentPrivate, setProjectCommentResolved, deleteProjectCommentItem } from '../src/lib/review/comments';
import { projectActivity, getReadSequence } from '../src/lib/comments/readState';
import { ordinaryVerificationStatus } from '../src/lib/comments/verificationState';
import { projectFeedbackExport } from '../src/lib/review/feedbackContext';
import { triageProjectComments } from '../src/lib/review/bulkTriage';
import { commentRevision } from '../src/lib/review/commentRevision';
import { digestContent } from '../src/lib/notifications/digest';
import { readyForReview } from '@uier/toolbar/verification';
import { persistProjectAccess } from './support/projectAccess';
import { reviewApiHandler } from '../src/lib/review/http';
import { verifyReviewFix } from '../src/lib/review/routes';
import { sha256Hex, signToken, randomToken } from '../src/lib/app/tokens';
import type { DbProjectRef } from '../src/lib/app/model';
import { notionBlocks } from '../src/lib/integrations/notion/page';
import { slackRootMessage } from '../src/lib/integrations/slack/message';
import { azureDevOpsProjection } from '../src/lib/integrations/azure-devops/workItem';
import { githubIssueProjection } from '../src/lib/integrations/github/issue';

const developer = { kind: 'member', userId: 'u_verify_developer', name: 'Developer', isAdmin: false } as const;
const reviewer = { ...developer, userId: 'u_verify_reviewer', name: 'Reviewer' };
const stranger = { ...developer, userId: 'u_verify_stranger', name: 'Stranger' };
const admin = { ...developer, userId: 'u_verify_admin', name: 'Admin', isAdmin: true };
const members = new Map([developer, reviewer, stranger, admin].map(a => [a.userId, a.name]));
const previousLocal = process.env.UIER_LOCAL;
test.beforeEach(() => { process.env.UIER_LOCAL = '1'; });
test.afterEach(() => { if (previousLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousLocal; });
async function fixture(authorId = `user:${reviewer.userId}`) {
    const project = { verificationEnabled: true, id: randomUUID().replaceAll('-', '').slice(0, 12), access: 'guests' } as DbProject;
    await persistProjectAccess(project, [developer, reviewer, stranger, admin]);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', id: project.id, pk: `project:${project.id}`, workspaceId: project.workspaceId });
    const store = getMemoryCommentsStore();
    const comment: DbComment = { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id, authorId,
        path: '/checkout', origin: 'https://reviewed.example', position: { type: 'page' },
        thread: { items: [{ id: 'first', text: 'Fix checkout', authorId, authorName: 'Original guest' }, { id: 'reply', text: 'Existing reply', authorId: `user:${developer.userId}` }] } };
    await store.create(comment);
    const request = (expectedRevision: string | null = null, extra: Record<string, unknown> = {}) => ({ action: 'request', reviewerId: 'author', expectedRevision, idempotencyKey: randomUUID(), ...extra });
    const ask = (input: unknown = request()) => changeFixVerification(project, developer, comment.id, input);
    const decide = (saved: DbComment, action = 'confirm', actor: Parameters<typeof changeFixVerification>[1] = reviewer, extra: Record<string, unknown> = {}) => changeFixVerification(project, actor, comment.id, { action, expectedRevision: saved.verification!.revision, idempotencyKey: randomUUID(), ...extra });
    return { project, store, comment, request, ask, decide };
}

test('request, reject, re-request, confirm and reopen preserve evidence and distinguish historical confirmation', async () => {
    const f = await fixture();
    const asked = await f.ask(f.request(null, { summary: 'Fixed the submit handler', fixUrl: 'https://github.com/example/repo/pull/12' }));
    expect(readyForReview(asked)).toBe(true);
    expect(asked.thread).toEqual(f.comment.thread);
    expect(asked).toMatchObject({ resolved: false, syncPending: true, verification: { requester: `user:${developer.userId}`, reviewer: `user:${reviewer.userId}`, outcome: 'pending' } });
    const rejected = await f.decide(asked, 'reject');
    expect(rejected).toMatchObject({ resolved: false, verification: { outcome: 'needs-work', decision: { kind: 'reject', override: false } } });
    const again = await f.ask(f.request(rejected.verification!.revision));
    expect(again.verification!.id).not.toBe(asked.verification!.id);
    const confirmed = await f.decide(again);
    expect(confirmed).toMatchObject({ resolved: true, verification: { outcome: 'confirmed', decision: { actorId: `user:${reviewer.userId}`, kind: 'confirm', override: false } } });
    expect(confirmed.verification!.decision!.at).toMatch(/^\d{4}-/);
    expect(confirmed.thread).toEqual(f.comment.thread);
    const reopened = await setProjectCommentResolved(f.project, developer, f.comment.id, false);
    expect(reopened).toMatchObject({ resolved: false, verification: { outcome: 'reopened', decision: { kind: 'confirm' } } });
    await expect(f.decide(again)).rejects.toMatchObject({ code: 'conflict' });
});

test('receipt replay survives lost responses and later decisions without duplicate events or overwriting work', async () => {
    const f = await fixture();
    const input = f.request();
    const original = f.store.commitSubmission;
    let lost = false;
    const store = { ...f.store, commitSubmission: async (...args: Parameters<typeof original>) => { const result = await original(...args); if (!lost) { lost = true; throw new Error('Lost response'); } return result; } };
    const asked = await changeFixVerification(f.project, developer, f.comment.id, input, store);
    expect(asked.notificationEvents).toHaveLength(1);
    const confirmed = await f.decide(asked);
    const replay = await f.ask(input);
    expect(replay).toEqual(confirmed);
    expect(replay.notificationEvents).toHaveLength(2);
    await expect(f.ask({ ...input, summary: 'Different intention' })).rejects.toMatchObject({ code: 'conflict' });
    const decision = { action: 'confirm', expectedRevision: asked.verification!.revision, idempotencyKey: randomUUID() };
    await expect(changeFixVerification(f.project, reviewer, f.comment.id, decision)).rejects.toMatchObject({ code: 'conflict' });
});

test('only requested independent reviewers can decide; overrides are explicit, named and notified', async () => {
    const f = await fixture();
    const asked = await f.ask();
    for (const actor of [developer, stranger, admin, { kind: 'guest', visitorId: 'unrelated' } as const])
        await expect(f.decide(asked, 'confirm', actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(f.decide(asked, 'confirm', developer, { override: true })).rejects.toMatchObject({ code: 'forbidden' });
    const overridden = await f.decide(asked, 'confirm', admin, { override: true });
    expect(verificationDetails(overridden, f.project, reviewer, members)).toMatchObject({ outcome: 'confirmed', reviewer: 'Reviewer', decision: { actor: 'Admin', override: true } });
    const event = overridden.notificationEvents!.at(-1)!;
    expect(digestContent(f.project, overridden, `user:${developer.userId}`, [event], members).lines.join()).toContain('admin override');
});

test('original guest identity can confirm through verified review routes; unrelated guests cannot', async () => {
    const visitor = randomToken();
    const f = await fixture(sha256Hex(visitor));
    const asked = await f.ask();
    const guest = { kind: 'guest', visitorId: sha256Hex(visitor) } as const;
    expect(verificationPermissions(asked, f.project, guest, members)).toMatchObject({ request: false, respond: true });
    const dto = verificationDetails(asked, f.project, guest, members)!;
    expect(JSON.stringify(dto)).not.toContain(guest.visitorId);
    const POST = reviewApiHandler<{ projectId: string; id: string }>(verifyReviewFix);
    const route = { params: Promise.resolve({ projectId: f.project.id, id: f.comment.id }) };
    const request = (token: string) => new Request(`https://uier.example/api/review/${f.project.id}/comments/${f.comment.id}/verification`, { method: 'POST', headers: { origin: 'https://reviewed.example', 'content-type': 'application/json', 'X-Uier-Visitor': token, 'X-Uier-Verification': signToken('review-verification', { projectId: f.project.id, origin: 'https://reviewed.example', authorId: sha256Hex(token) }, 300) }, body: JSON.stringify({ action: 'confirm', expectedRevision: asked.verification!.revision, idempotencyKey: randomUUID() }) });
    expect((await POST(request(randomToken()), route)).status).toBe(403);
    const response = await POST(request(visitor), route);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resolved: true, verification: { outcome: 'confirmed', decision: { actor: 'Original guest' } } });
});

test('removed members, private-ineligible guests and changed project mode lose decision authority', async () => {
    const f = await fixture();
    const asked = await f.ask();
    await getAppStore().delete(f.project.pk, memberId(reviewer.userId));
    await expect(f.decide(asked)).rejects.toMatchObject({ code: 'sign_in_required' });
    const g = await fixture('original-guest');
    const pending = await g.ask();
    await setProjectCommentPrivate(g.project, admin, g.comment.id, true);
    // The original author retains private visibility; another guest never acquires it.
    await expect(g.decide(pending, 'confirm', { kind: 'guest', visitorId: 'other-guest' })).rejects.toMatchObject({ code: 'not_found' });
    const stored = (await getAppStore().get<DbProject>(g.project.pk, g.project.id))!;
    await getAppStore().replace({ ...stored.doc, access: 'invited' }, stored.etag);
    await expect(g.decide(pending, 'confirm', { kind: 'guest', visitorId: 'original-guest' })).rejects.toMatchObject({ code: 'sign_in_required' });
});

test('cancellation and superseding requests invalidate earlier decisions; self and missing reviewers are rejected', async () => {
    const f = await fixture();
    for (const reviewerId of [developer.userId, 'u_missing']) await expect(f.ask(f.request(null, { reviewerId }))).rejects.toMatchObject({ code: 'forbidden' });
    const asked = await f.ask();
    await expect(f.decide(asked, 'cancel', stranger)).rejects.toMatchObject({ code: 'forbidden' });
    const canceled = await f.decide(asked, 'cancel', developer);
    expect(canceled.verification!.outcome).toBe('canceled');
    await expect(f.decide(asked)).rejects.toMatchObject({ code: 'conflict' });
    const next = await f.ask(f.request(canceled.verification!.revision));
    const superseded = await f.ask(f.request(next.verification!.revision, { reviewerId: stranger.userId }));
    expect(superseded.verification!.revision).not.toBe(next.verification!.revision);
    await expect(f.decide(next)).rejects.toMatchObject({ code: 'conflict' });
});

test('conditional write races reauthorize and preserve concurrent replies; closures make old decisions conflict', async () => {
    const f = await fixture();
    const asked = await f.ask();
    let raced = false;
    const original = f.store.commitSubmission;
    const store = { ...f.store, commitSubmission: async (...args: Parameters<typeof original>) => {
        if (!raced) { raced = true; await setProjectCommentResolved(f.project, developer, f.comment.id, true); return 'conflict' as const; }
        return original(...args);
    } };
    await expect(changeFixVerification(f.project, reviewer, f.comment.id, { action: 'confirm', expectedRevision: asked.verification!.revision, idempotencyKey: randomUUID() }, store)).rejects.toMatchObject({ code: 'conflict' });
    const saved = (await f.store.get(f.comment.domain, f.comment.id))!.comment;
    expect(saved.verification).toMatchObject({ outcome: 'unconfirmed' });
    expect(saved.thread).toEqual(f.comment.thread);
});

test('ordinary status, bulk Done/Reopen and same-status polls never manufacture confirmation', async () => {
    const f = await fixture();
    const asked = await f.ask();
    expect(ordinaryVerificationStatus(asked, false)).toBe(asked);
    const run = (comment: DbComment, resolved: boolean) => triageProjectComments(f.project, developer, { kind: 'status', resolved, items: [{ id: comment.id, expected: Boolean(comment.resolved), revision: commentRevision(comment), idempotencyKey: randomUUID() }] });
    expect((await run(asked, true)).counts.success).toBe(1);
    let saved = (await f.store.get(f.comment.domain, f.comment.id))!.comment;
    expect(saved.verification).toMatchObject({ outcome: 'unconfirmed' });
    expect(saved.verification!.decision).toBeUndefined();
    expect((await run(asked, false)).counts.conflict).toBe(1);
    expect((await run(saved, false)).counts.success).toBe(1);
    saved = (await f.store.get(f.comment.domain, f.comment.id))!.comment;
    expect(saved.verification).toMatchObject({ outcome: 'reopened' });
    expect(saved.verification!.decision).toBeUndefined();
    await expect(f.decide(asked)).rejects.toMatchObject({ code: 'conflict' });
});

test('full activity counts include Ready as Open without acknowledging reads, including old threads', async () => {
    const f = await fixture();
    const before = await getReadSequence(f.comment.domain, `user:${reviewer.userId}`, f.comment.id);
    await f.ask();
    const counts = await projectActivity(f.comment.domain, `user:${reviewer.userId}`);
    expect(counts.summary).toMatchObject({ total: 1, open: 1, ready: 1, done: 0, unread: 1 });
    expect(await getReadSequence(f.comment.domain, `user:${reviewer.userId}`, f.comment.id)).toBe(before);
});

test('fix links reject credentials, executable schemes and secret state; guest exports hide other review origins', async () => {
    const f = await fixture();
    for (const link of ['javascript:alert(1)', 'data:text/html,test', 'http://external.example/fix', 'https://user:password@example.com/fix', 'https://example.com/pull/1?token=secret', 'https://example.com/pull/1#secret', 'https://reviewed.example/?uier-token=secret'])
        expect(() => fixDestination(f.project, link), link).toThrow();
    expect(fixDestination(f.project, 'https://reviewed.example/fixed')).toBe('https://reviewed.example/fixed');
    const asked = await f.ask(f.request(null, { fixUrl: 'https://reviewed.example/fixed' }));
    const packet = await projectFeedbackExport(f.project, { kind: 'guest', visitorId: 'other' }, f.comment.id, 'https://another.example', 'https://uier.example');
    expect(packet.context.verification?.fixUrl).toBeUndefined();
    expect(packet.markdown).not.toContain('https://reviewed.example/fixed');
    expect(asked.position).toEqual(f.comment.position);
});

test('confirmation provenance reaches exports and provider projections while status stays v1 done/open', async () => {
    const f = await fixture();
    const confirmed = await f.decide(await f.ask());
    const packet = await projectFeedbackExport(f.project, reviewer, f.comment.id, undefined, 'https://uier.example');
    expect(packet.context).toMatchObject({ schemaVersion: 1, status: 'done', verification: { outcome: 'confirmed', decision: { actor: 'Reviewer', override: false } } });
    expect(packet.markdown).toContain('Fix verification');
    for (const projection of [notionBlocks(packet.context), slackRootMessage(packet.context, 'Project'), azureDevOpsProjection(packet.context, 'marker'), githubIssueProjection(packet.context, 'marker')])
        expect(JSON.stringify(projection)).toContain('confirm');
    expect(JSON.stringify(packet)).not.toContain(confirmed.verification!.reviewer);
    const reopened = await setProjectCommentResolved(f.project, developer, f.comment.id, false);
    expect(reopened.verification!.outcome).toBe('reopened');
});

test('author deletion redacts guest verification references with the first message; legacy documents stay optional', async () => {
    const f = await fixture('guest-to-delete');
    expect(f.comment.verification).toBeUndefined();
    await f.ask();
    const kept = await deleteProjectCommentItem(f.project, { kind: 'guest', visitorId: 'guest-to-delete' }, f.comment.id, 'first');
    expect(kept?.verification).toBeUndefined();
    expect(kept?.thread.items[0]).toMatchObject({ deletedAt: expect.any(String), text: '' });
    expect(kept?.thread.items[0]?.authorId).toBeUndefined();
});


test('explicit Reopen ends an unresolved pending check, while a same-status provider poll preserves it', async () => {
    const f = await fixture();
    const asked = await f.ask();
    expect(ordinaryVerificationStatus(asked, false)).toBe(asked);
    const reopened = await setProjectCommentResolved(f.project, developer, f.comment.id, false);
    expect(reopened).toMatchObject({ resolved: false, verification: { outcome: 'reopened' } });
    expect(reopened.verification!.revision).not.toBe(asked.verification!.revision);
    await expect(f.decide(asked)).rejects.toMatchObject({ code: 'conflict' });
});


test('making a thread private removes a selected member reviewer who is neither author nor admin', async () => {
    const f = await fixture();
    const asked = await f.ask(f.request(null, { reviewerId: stranger.userId }));
    await setProjectCommentPrivate(f.project, admin, f.comment.id, true);
    await expect(f.decide(asked, 'confirm', stranger)).rejects.toMatchObject({ code: 'not_found' });
    expect((await f.store.get(f.comment.domain, f.comment.id))!.comment.verification!.outcome).toBe('pending');
});


test('legacy same-origin boolean status ends pending verification without exposing guest hashes', async () => {
    const f = await fixture('legacy-guest-hash');
    await f.ask();
    const context = { request: new Request('https://uier.example/api/comments'), domain: f.comment.domain,
        project: f.project, actor: { kind: 'guest', visitorId: 'legacy-guest-hash' } as const, visitor: { authorId: 'legacy-guest-hash' } };
    const dto = await updateCommentResolved(context, f.comment.id, { resolved: true });
    expect(dto).toMatchObject({ resolved: true, verification: { outcome: 'unconfirmed' } });
    expect(JSON.stringify(dto)).not.toContain('legacy-guest-hash');
    const stored = (await f.store.get(f.comment.domain, f.comment.id))!.comment;
    expect(stored.verification!.decision).toBeUndefined();
});

test('missing project opt-in suspends existing checks without hiding threads or confirming fixes', async () => {
    const { updateProject } = await import('../src/lib/app/projects');
    const { toReviewCommentDto } = await import('../src/lib/review/dto');
    const { feedbackStage } = await import('@uier/toolbar/verification');
    const { setProjectCommentWorkflowStatus, setProjectCommentStatus } = await import('../src/lib/review/comments');
    const { loadStatusWorkflow } = await import('../src/lib/app/statusWorkflows');
    const { orderedStatuses } = await import('../src/lib/app/statusWorkflow');
    const f = await fixture();
    const originalRequest = f.request();
    const asked = await f.ask(originalRequest);
    const off = (await updateProject(f.project.workspaceId, f.project.id, { verificationEnabled: false }))!;
    // A project saved before the setting existed has exactly the same disabled behavior.
    const legacy = { ...off }; delete legacy.verificationEnabled;
    const suspended = toReviewCommentDto(asked, developer, new Map(), off.urls, 0, members, legacy)!;
    expect(suspended.verification).toBeUndefined();
    expect(suspended.verificationPermissions).toMatchObject({ request: false, respond: false, override: false });
    expect(feedbackStage(suspended)).toBe('open');
    expect(feedbackStage({ ...suspended, inProgress: true })).toBe('in-progress');
    expect((await f.store.get(asked.domain, asked.id))!.comment.verification).toEqual(asked.verification);
    expect(orderedStatuses(await loadStatusWorkflow(off)).some(status => status.category === 'ready')).toBe(false);
    await expect(f.ask(originalRequest)).rejects.toThrow('Mark the comment done instead');
    await expect(f.ask(f.request(asked.verification!.revision))).rejects.toThrow('Mark the comment done instead');
    await expect(f.decide(asked)).rejects.toThrow('Mark the comment done instead');
    await expect(setProjectCommentWorkflowStatus(off, developer, asked.id, 'ready')).rejects.toThrow('Mark the comment done instead');
    const summary = await projectActivity(asked.domain, undefined, () => true, 'exclude', false);
    expect(summary.summary).toMatchObject({ ready: 0, open: 1 });
    await updateProject(off.workspaceId, off.id, { verificationEnabled: true });
    expect(verificationPermissions(asked, { ...off, verificationEnabled: true }, developer, members).request).toBe(true);
    await updateProject(off.workspaceId, off.id, { verificationEnabled: false });
    const done = await setProjectCommentStatus(off, developer, asked.id, 'done');
    expect(done.resolved).toBe(true);
    expect(done.verification?.outcome).toBe('unconfirmed');
});
