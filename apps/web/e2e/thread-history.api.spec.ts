import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { DbComment } from '../src/lib/db/schema';
import type { DbProject } from '../src/lib/app/model';
import { getMemoryCommentsStore } from '../src/lib/repo/memoryCommentsStore';
import { MAX_THREAD_HISTORY, threadHistoryView, withThreadHistory } from '../src/lib/comments/history';
import { setProjectCommentAssignees, setProjectCommentPriority, setProjectCommentPrivate, setProjectCommentStatus, editProjectCommentText, reattachProjectAnchor, getProjectComment } from '../src/lib/review/comments';
import { setProjectCommentAgent, setProjectCommentAgentWorking } from '../src/lib/review/assigneeAgent';
import { changeFixVerification } from '../src/lib/review/fixVerification';
import { toReviewCommentDto } from '../src/lib/review/dto';
import { triageProjectComments } from '../src/lib/review/bulkTriage';
import { commentRevision } from '../src/lib/review/commentRevision';
import { makeAiTitle } from '../src/lib/titles/threadTitles';
import { withImportedReplies } from '../src/lib/integrations/importReplies';
import type { IntegrationConnection } from '../src/lib/integrations/model';
import { persistProjectAccess } from './support/projectAccess';
import { editCommentThreadItem, updateCommentResolved } from '../src/lib/comments/service';

const author = { kind: 'member', userId: 'u_history_author', name: 'Author', isAdmin: false } as const;
const colleague = { ...author, userId: 'u_history_colleague', name: 'Colleague' };
const admin = { ...author, userId: 'u_history_admin', name: 'Admin', isAdmin: true };
const names = new Map([author, colleague, admin].map(actor => [actor.userId, actor.name]));
const previousLocal = process.env.UIER_LOCAL;
test.beforeEach(() => { process.env.UIER_LOCAL = '1'; });
test.afterEach(() => { if (previousLocal === undefined) delete process.env.UIER_LOCAL; else process.env.UIER_LOCAL = previousLocal; });

async function fixture(fields: Partial<DbComment> = {}) {
    const project = { id: randomUUID().replaceAll('-', '').slice(0, 12), access: 'guests' } as DbProject;
    await persistProjectAccess(project, [author, colleague, admin]);
    const store = getMemoryCommentsStore();
    const comment: DbComment = { id: `comment_${randomUUID()}`, domain: `project:${project.id}`, projectId: project.id,
        origin: 'https://reviewed.example', path: '/checkout', authorId: `user:${author.userId}`, position: { type: 'page' },
        thread: { items: [{ id: 'first', text: 'Fix checkout', authorId: `user:${author.userId}` }] }, ...fields };
    await store.create(comment);
    const read = async () => (await store.get(comment.domain, comment.id))!.comment;
    return { project, comment, store, read };
}

test('assignment changes are individual, durable and retry-safe; each agent removal is retained', async () => {
    const f = await fixture();
    const key = randomUUID();
    await setProjectCommentAssignees(f.project, admin, f.comment.id, [author.userId, colleague.userId], 'replace', key);
    await setProjectCommentAssignees(f.project, admin, f.comment.id, [author.userId, colleague.userId], 'replace', key);
    let saved = await f.read();
    expect(saved.history?.map(e => [e.action, e.userId])).toEqual([['assigned', author.userId], ['assigned', colleague.userId]]);
    expect(saved.notificationEvents?.map(e => e.kind)).toEqual(['assignment']);
    const connector = { ...author, agent: { credentialId: 'secret-connection', name: 'Private connection' } };
    const attached = await setProjectCommentAgent(f.project, connector, f.comment.id, { kind: 'codex', sessionId: 'private-session', model: 'private-model' }, { idempotencyKey: randomUUID(), startWork: true });
    expect(attached.history?.slice(-2).map(e => e.action)).toEqual(['agent-attached', 'status']);
    const beforeLease = attached.history;
    const working = await setProjectCommentAgentWorking(f.project, connector, f.comment.id, { working: true, sessionId: 'private-session' }, randomUUID());
    expect(working.history).toEqual(beforeLease);
    await setProjectCommentAgent(f.project, connector, f.comment.id, { kind: 'claude' }, { idempotencyKey: randomUUID(), add: true });
    await setProjectCommentAssignees(f.project, admin, f.comment.id, [author.userId], 'remove', randomUUID());
    saved = await f.read();
    expect(saved.history?.slice(-3).map(e => e.action)).toEqual(['unassigned', 'agent-removed', 'agent-removed']);
    expect(saved.assigneeIds).toEqual([colleague.userId]);
    expect(JSON.stringify(saved.history)).not.toMatch(/secret-connection|Private connection|private-session|private-model/);
    expect(saved.notificationEvents?.slice(-3).map(e => e.kind)).toEqual(['assignment', 'agent', 'agent']);
});

test('concurrent writes keep both entries; no-op, failed writes and receipt replay never add entries', async () => {
    const f = await fixture();
    await Promise.all([
        setProjectCommentAssignees(f.project, admin, f.comment.id, [author.userId], 'add', randomUUID()),
        setProjectCommentAssignees(f.project, admin, f.comment.id, [colleague.userId], 'add', randomUUID())
    ]);
    expect((await f.read()).history).toHaveLength(2);
    const key = randomUUID();
    await setProjectCommentPriority(f.project, admin, f.comment.id, 'high', key);
    await setProjectCommentPriority(f.project, admin, f.comment.id, 'high', randomUUID());
    await setProjectCommentPriority(f.project, admin, f.comment.id, 'urgent', randomUUID());
    await setProjectCommentPriority(f.project, admin, f.comment.id, 'high', key);
    expect((await f.read()).priority).toBe('urgent');
    expect((await f.read()).history).toHaveLength(4);
    await expect(setProjectCommentPriority(f.project, admin, f.comment.id, 'low', randomUUID(), undefined,
        { ...f.store, commitSubmission: async () => 'conflict' })).rejects.toMatchObject({ code: 'conflict' });
    expect((await f.read()).history).toHaveLength(4);
});

test('verification requests, rejection, confirmation and cancellation remain distinct from ordinary status', async () => {
    const f = await fixture();
    const request = async () => changeFixVerification(f.project, author, f.comment.id, { action: 'request', reviewerId: colleague.userId,
        expectedRevision: (await f.read()).verification?.revision ?? null, idempotencyKey: randomUUID(), summary: 'Private fix details' });
    const decide = async (action: 'confirm' | 'reject' | 'cancel') => changeFixVerification(f.project, action === 'cancel' ? author : colleague,
        f.comment.id, { action, expectedRevision: (await f.read()).verification!.revision, idempotencyKey: randomUUID() });
    await request(); await decide('reject');
    await request(); await decide('confirm');
    await setProjectCommentStatus(f.project, author, f.comment.id, 'open', randomUUID());
    await request(); await decide('cancel');
    await request(); await setProjectCommentStatus(f.project, author, f.comment.id, 'done', randomUUID());
    const saved = await f.read();
    expect(saved.history?.filter(e => e.action.startsWith('verification')).map(e => e.action)).toEqual([
        'verification-requested', 'verification-rejected', 'verification-requested', 'verification-confirmed',
        'verification-requested', 'verification-canceled', 'verification-requested', 'verification-canceled'
    ]);
    expect(saved.notificationEvents?.some(e => e.kind === 'verification-confirmed')).toBe(true);
    expect(JSON.stringify(saved.history)).not.toContain('Private fix details');
});

test('AI titles and edits record metadata without changing revision or retaining old title text', async () => {
    const f = await fixture();
    const revision = commentRevision(f.comment);
    const make = () => makeAiTitle(f.comment, 'new', { store: f.store, service: async () => ({ outcome: 'success', title: 'Secret generated title' }) });
    expect(await make()).toBe('written');
    expect(await make()).toBe('current');
    let saved = await f.read();
    expect(commentRevision(saved)).toBe(revision);
    expect(saved.history?.map(e => e.action)).toEqual(['title-written']);
    const manual = withThreadHistory(saved, { ...saved, aiTitle: { ...saved.aiTitle!, text: 'Edited private title' } }, `user:${author.userId}`);
    expect(manual.history?.at(-1)?.action).toBe('title-edited');
    expect(JSON.stringify(manual.history)).not.toContain('Edited private title');
    expect(saved.activity).toEqual(f.comment.activity);
    expect(saved.notificationEvents).toEqual(f.comment.notificationEvents);
    await editProjectCommentText(f.project, author, f.comment.id, 'Edited first message');
    saved = await f.read();
    expect(saved.history?.at(-1)?.action).toBe('title-cleared');
    expect(JSON.stringify(saved.history)).not.toMatch(/Secret generated title|Edited first message/);
});

test('private-period entries never leak after publication, and guests never receive history', async () => {
    const f = await fixture();
    await setProjectCommentPriority(f.project, admin, f.comment.id, 'high', randomUUID());
    await setProjectCommentPrivate(f.project, admin, f.comment.id, true);
    await expect(getProjectComment(f.project, colleague, f.comment.id)).rejects.toMatchObject({ code: 'not_found' });
    await setProjectCommentPriority(f.project, admin, f.comment.id, 'urgent', randomUUID());
    await setProjectCommentPrivate(f.project, admin, f.comment.id, false);
    const saved = await f.read();
    const dto = toReviewCommentDto(saved, colleague, names, [], 0, names, f.project)!;
    expect(dto.history?.map(e => e.description)).toEqual(['Admin changed priority to High.']);
    for (const actor of [admin, author]) expect(toReviewCommentDto(saved, actor, names, [], 0, names, f.project)!.history).toHaveLength(4);
    const guest = toReviewCommentDto(saved, { kind: 'guest', visitorId: 'guest' }, names, [], 0, names, f.project)!;
    expect(guest).not.toHaveProperty('history');
    expect(JSON.stringify(dto.history)).not.toMatch(/u_history|actorId|private|Urgent/);
    expect(threadHistoryView(saved, { member: true }, new Map())?.[0]?.description).toContain('Former member');
});

test('retention caps history independently from delivery events, with chronological stable entries', async () => {
    const f = await fixture();
    let saved = f.comment;
    for (let i = 0; i < MAX_THREAD_HISTORY + 5; i++) saved = withThreadHistory(saved, { ...saved, priority: i % 2 ? 'high' : 'low' }, 'user:actor', new Date(i * 1000).toISOString());
    expect(saved.history).toHaveLength(MAX_THREAD_HISTORY);
    expect(saved.history![0]!.at).toBe(new Date(5000).toISOString());
    expect(new Set(saved.history!.map(e => e.id)).size).toBe(MAX_THREAD_HISTORY);
    expect(saved.notificationEvents).toBe(f.comment.notificationEvents);
});

test('bulk triage, integration status and reattachment use the same history contract', async () => {
    const f = await fixture({ position: { type: 'point', selector: '#old', xNormal: 0, yNormal: 0 } });
    const input = { kind: 'priority', priority: 'high', items: [{ id: f.comment.id, expected: 'normal', idempotencyKey: randomUUID() }] };
    expect((await triageProjectComments(f.project, admin, input)).counts.success).toBe(1);
    expect((await triageProjectComments(f.project, admin, input)).counts.success).toBe(1);
    const moved = await reattachProjectAnchor(f.project, author, f.comment.id, f.comment.origin!, {
        path: f.comment.path, expectedRevision: null, position: { type: 'point', selector: '#new', xNormal: 0.5, yNormal: 0.5 }
    });
    expect(moved.history?.map(e => e.action)).toEqual(['priority', 'moved']);
    const connection = { provider: 'github', twoWaySync: true, connectedBy: author.userId } as IntegrationConnection;
    const synced = withImportedReplies(moved, connection, { resolved: true, replies: [], at: new Date().toISOString() }).comment;
    expect(synced.history?.at(-1)).toMatchObject({ actorId: 'integration:github', action: 'status', status: 'done' });
    expect(threadHistoryView(synced, { member: true, admin: true }, names)?.at(-1)?.description).toBe('GitHub changed status to Done.');
    expect(synced.notificationEvents?.at(-1)?.kind).toBe('resolved');
    expect(withImportedReplies(synced, connection, { resolved: true, replies: [], at: new Date().toISOString() }).comment).toBe(synced);
});

test('legacy public writes keep history durable and omit it from their public responses', async () => {
    const authorId = 'original-guest';
    const f = await fixture({ authorId, aiTitle: { text: 'Old private title', source: 'old', model: 'test', generatedAt: new Date().toISOString() },
        thread: { items: [{ id: 'first', text: 'Before editing', authorId, authorName: 'Guest reviewer' }] } });
    const context = { request: new Request('https://uier.example/api/comments'), domain: f.comment.domain,
        project: f.project, actor: { kind: 'guest', visitorId: authorId } as const, visitor: { authorId } };
    const status = await updateCommentResolved(context, f.comment.id, { status: 'in-progress' });
    expect(status).not.toHaveProperty('history');
    await editCommentThreadItem(context, f.comment.id, 'first', { text: 'After editing', expectedText: 'Before editing' });
    const saved = await f.read();
    expect(saved.aiTitle).toBeUndefined();
    expect(saved.history?.map(e => e.action)).toEqual(['status', 'title-cleared']);
    expect(threadHistoryView(saved, { member: true }, names)?.[0]?.description).toBe('Guest reviewer changed status to In progress.');
});
