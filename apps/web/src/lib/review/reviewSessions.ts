import { nanoid } from 'nanoid';
import type { DbProject } from '../app/model';
import { findProject } from '../app/projects';
import { configuredAppBaseUrl } from '../app/deployment';
import { sha256Hex } from '../app/tokens';
import { queueThreadCleanup } from '../comments/cleanup';
import { ApiError, apiErrors } from '../comments/http';
import { isUierFeedbackProject } from '../comments/publicProjectPolicy';
import { forgetScreenshot } from '../comments/service';
import { submission, submissionTtlSeconds } from '../comments/submissions';
import type { DbComment, DbReviewRelease, DbReviewSession, DbReviewSessionRecord } from '../db/schema';
import { queueMcpEventDelivery } from '../mcp/events/trigger';
import { cleanupRemovedRecordings } from '../recordings/service';
import { getCommentsStore, type CommentsStore, type ReviewSessionWrite } from '../repo/commentsStore';
import { queueAiTitles } from '../titles/threadTitles';
import { afterResponse } from '../afterResponse';
import { withSyncMark } from '../integrations/syncSignal';
import { actorAuthorId, assertCanUseComments, assertWriter, refreshMutationActor, type ProjectActor } from './actor';
import { canSeeComment, commentVisibilityFilter, projectPartition } from './comments';
import { itemPersonName, participantNames } from './dto';
import { reviewReleaseId, reviewSessionDocumentId } from './reviewSessionRelease';

type Pointer = Extract<DbReviewSessionRecord, { type: 'review-session-open' }>;
type Sequence = Extract<DbReviewSessionRecord, { type: 'review-session-number' }>;
type Receipt = Extract<DbReviewSessionRecord, { type: 'review-session-receipt' }>;
type Discard = Extract<DbReviewSessionRecord, { type: 'review-session-discard' }>;
type ReviewText = { title?: string; summary?: string };
type SendInput = ReviewText & { draftId: string; revision: number; idempotencyKey: string };

const MAX_REVIEW_COMMENTS = 100;
const MAX_ATTEMPTS = 8;
const sequenceId = '$review-session-number';
const pointerId = (actorId: string) => `$review-session-open_${sha256Hex(actorId)}`;
const discardId = (id: string, draft: string) => `$review-session-discard_${sha256Hex(JSON.stringify([id, draft]))}`;
const sessionId = (doc: DbReviewSession) => doc.id.slice('$review-session_'.length);
const nowIso = () => new Date().toISOString();
const missing = () => apiErrors.notFound('Review session not found.');
const closed = () => new ApiError(409, 'review_session_closed', 'This review is no longer open.');
const full = () => new ApiError(409, 'review_session_full', 'This review already has 100 comments.');

function available(project: DbProject) {
    return !isUierFeedbackProject(project.id) && project.access !== 'disabled' && !project.transfer;
}

export async function reviewSessionsAvailable(project: DbProject, actor: ProjectActor) {
    if (!available(project) || actor.proofThread || (project.access === 'invited' && actor.kind !== 'member')) return false;
    return (await import('../integrations/reviewGroups')).canStartReviewSessions(project);
}

async function authorize(project: DbProject, actor: ProjectActor) {
    assertWriter(actor);
    const current = await refreshMutationActor(project, actor, true);
    if (!available(current) || actor.proofThread || (actor.kind === 'member' && actor.agent)) throw missing();
    return actorAuthorId(actor)!;
}

function manager(doc: DbReviewSession, actor: ProjectActor) {
    return doc.authorId === actorAuthorId(actor) || (actor.kind === 'member' && actor.isAdmin);
}

async function readSession(store: CommentsStore, domain: string, id: string) {
    const record = await store.reviewSessionRecord<DbReviewSession>(domain, reviewSessionDocumentId(id));
    return record?.doc.type === 'review-session' ? record : null;
}

async function sessionPointer(store: CommentsStore, domain: string, authorId: string) {
    const record = await store.reviewSessionRecord<Pointer>(domain, pointerId(authorId));
    return record?.doc.type === 'review-session-open' ? record : null;
}

function pointer(doc: DbReviewSession): Pointer {
    return { type: 'review-session-open', id: pointerId(doc.authorId), domain: doc.domain, sessionId: sessionId(doc) };
}

async function sessionView(doc: DbReviewSession, project: DbProject, actor: ProjectActor, store: CommentsStore,
    { detail = false, visibleIds }: { detail?: boolean; visibleIds?: ReadonlySet<string> } = {}) {
    const canManage = manager(doc, actor);
    const author = doc.authorId === actorAuthorId(actor);
    if (!canManage && actor.kind !== 'member') return null;

    // The caller's own bootstrap only needs the open draft and its counts.
    const ids = detail || !canManage ? [...doc.publishedThreadIds, ...doc.pendingThreadIds] : [];
    const visible = (await Promise.all((visibleIds ? [] : ids).map(async id => (await store.get(doc.domain, id))?.comment)))
        .filter((comment): comment is DbComment => Boolean(comment && canSeeComment(comment, actor)));
    const visibleThreadIds = visibleIds ? ids.filter(id => visibleIds.has(id)) : visible.map(comment => comment.id);
    if (!canManage && !visibleThreadIds.length) return null;
    const pending = visible.filter(comment => doc.pendingThreadIds.includes(comment.id));
    const publication = canManage ? null : (doc.revision > 0
        ? (await store.reviewSessionRecord<DbReviewRelease>(doc.domain, reviewReleaseId(sessionId(doc), doc.revision)))?.doc
        : null);
    const canSeeText = Boolean(publication?.type === 'review-release'
        && doc.publishedThreadIds.every(id => visibleThreadIds.includes(id)));
    const text = canManage ? doc : canSeeText ? publication : null;
    const names = detail && doc.authorId.startsWith('user:') ? await participantNames(project) : new Map<string, string>();
    return {
        id: sessionId(doc), number: doc.number, revision: doc.revision, state: doc.state,
        ...(text ? { title: text.title, summary: text.summary } : {}),
        ...(canManage ? { draftId: doc.draftId } : {}),
        ...(detail ? { authorName: itemPersonName(doc, names), submittedAt: doc.submittedAt } : {}),
        pendingCount: canManage && !detail ? doc.pendingThreadIds.length : doc.pendingThreadIds.filter(id => visibleThreadIds.includes(id)).length,
        threadCount: canManage && !detail ? doc.threadCount : visibleThreadIds.length,
        canManage, canResume: author && doc.state === 'submitted' && doc.threadCount < MAX_REVIEW_COMMENTS,
        ...(detail && canManage ? { pending: pending.map(comment => ({
            id: comment.id, number: comment.number, path: comment.path.split(/[?#]/, 1)[0] ?? '/',
            text: comment.thread.items[0]?.text.slice(0, 200) ?? ''
        })) } : {})
    };
}

export async function openReviewSession(project: DbProject, actor: ProjectActor, store = getCommentsStore()) {
    const authorId = actorAuthorId(actor);
    if (!authorId || !available(project) || actor.proofThread) return null;
    const domain = projectPartition(project.id);
    const record = await sessionPointer(store, domain, authorId);
    const saved = record && await readSession(store, domain, record.doc.sessionId);
    return saved ? sessionView(saved.doc, project, actor, store) : null;
}

export async function getReviewSession(project: DbProject, actor: ProjectActor, id: string, store = getCommentsStore()) {
    const record = await readSession(store, projectPartition(project.id), id);
    const view = record && await sessionView(record.doc, project, actor, store, { detail: true });
    if (!view) throw missing();
    return view;
}

export async function listReviewSessions(project: DbProject, actor: ProjectActor, page: { limit: number; before?: string }, store = getCommentsStore()) {
    const authorId = actorAuthorId(actor);
    if (!authorId) return { sessions: [], next: null };
    const domain = projectPartition(project.id);
    const visibleIds = actor.kind === 'member' && !actor.isAdmin ? new Set((await store.queryCandidates(domain, {
        visibility: commentVisibilityFilter(domain, actor), archive: 'all', includeText: false
    })).map(row => row.id)) : undefined;
    let before = page.before && reviewSessionDocumentId(page.before);
    const sessions: NonNullable<Awaited<ReturnType<typeof sessionView>>>[] = [];
    const chunkSize = 50;
    while (sessions.length <= page.limit) {
        const records = await store.listReviewSessions(domain, { limit: chunkSize, before, ...(actor.kind !== 'member' ? { authorId } : {}) });
        for (const doc of records) {
            const view = await sessionView(doc, project, actor, store, { visibleIds });
            if (view) sessions.push(view);
            if (sessions.length > page.limit) return { sessions: sessions.slice(0, page.limit), next: sessions[page.limit - 1]!.id };
        }
        if (records.length < chunkSize) break;
        before = records.at(-1)!.id;
    }
    return { sessions, next: null };
}

export type ReviewSessionCommentView = { id: string; revision: number; number?: number; held: boolean; canResume: boolean };

export async function reviewSessionCommentViews(comments: readonly DbComment[], actor: ProjectActor, store?: CommentsStore) {
    const result = new Map<string, ReviewSessionCommentView>();
    const grouped = comments.filter(comment => comment.reviewSession);
    if (!grouped.length) return result;
    const repository = store ?? getCommentsStore();
    const releases = new Map<string, ReturnType<typeof repository.reviewSessionRecord<DbReviewRelease>>>();
    const author = actorAuthorId(actor);
    const byDomain = new Map<string, Set<string>>();
    for (const comment of grouped) if (author && comment.authorId === author) {
        const ids = byDomain.get(comment.domain) ?? new Set<string>();
        ids.add(reviewSessionDocumentId(comment.reviewSession!.id));
        byDomain.set(comment.domain, ids);
    }
    const sessions = new Map(await Promise.all([...byDomain].map(async ([domain, ids]) => {
        const rows = await repository.listReviewSessionRecords(domain, [...ids]);
        return [domain, new Map(rows.map(row => [row.id, row]))] as const;
    })));
    await Promise.all(grouped.map(async comment => {
        const review = comment.reviewSession!;
        const releaseId = reviewReleaseId(review.id, review.revision);
        const key = `${comment.domain}/${releaseId}`;
        let released = review.releasedAt !== undefined;
        let number = review.number;
        if (!released) {
            const request = releases.get(key) ?? repository.reviewSessionRecord<DbReviewRelease>(comment.domain, releaseId);
            releases.set(key, request);
            const record = (await request)?.doc;
            if (record?.type === 'review-release' && record.threadIds.includes(comment.id)) {
                released = true;
                number = record.number;
            }
        }
        const session = sessions.get(comment.domain)?.get(reviewSessionDocumentId(review.id));
        const canResume = released && session?.authorId === author && session?.state === 'submitted' && session.threadCount < MAX_REVIEW_COMMENTS;
        result.set(comment.id, { id: review.id, revision: review.revision, number, held: !released, canResume });
    }));
    return result;
}

export async function startReviewSession(project: DbProject, actor: ProjectActor, store = getCommentsStore()) {
    const domain = projectPartition(project.id);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const authorId = await authorize(project, actor);
        const active = await openReviewSession(project, actor, store);
        if (active) return active;
        if (!await reviewSessionsAvailable(project, actor))
            throw apiErrors.unavailable('Review sessions are unavailable for this project.');
        const at = nowIso();
        const doc: DbReviewSession = {
            type: 'review-session', id: reviewSessionDocumentId(nanoid()), domain, projectId: project.id, authorId,
            state: 'open', revision: 0, draftId: nanoid(), pendingThreadIds: [], publishedThreadIds: [],
            threadCount: 0, openedAt: at, lastActivityAt: at
        };
        const committed = await store.writeReviewSessionBatch(domain, [
            { operation: 'create', doc }, { operation: 'create', doc: pointer(doc) }
        ]);
        if (committed === 'ok') return sessionView(doc, project, actor, store);
    }
    throw apiErrors.conflict();
}

/** Attaching a new thread and its submission receipt uses this conditional operation in the same batch. */
export async function prepareReviewAdd(store: CommentsStore, project: DbProject, actor: ProjectActor,
    id: string, draftId: string, threadId: string, guestName?: string) {
    const authorId = await authorize(project, actor);
    const current = await readSession(store, projectPartition(project.id), id);
    if (!current || current.doc.authorId !== authorId || current.doc.state !== 'open' || current.doc.draftId !== draftId) throw closed();
    if (current.doc.threadCount >= MAX_REVIEW_COMMENTS) throw full();
    const write: ReviewSessionWrite = {
        operation: 'replace', etag: current.etag, doc: {
            ...current.doc, pendingThreadIds: [...current.doc.pendingThreadIds, threadId],
            ...(guestName ? { authorName: guestName } : {}),
            threadCount: current.doc.threadCount + 1, lastActivityAt: nowIso()
        }
    };
    return { write, revision: current.doc.revision + 1, number: current.doc.number };
}

export async function editReviewSession(project: DbProject, actor: ProjectActor, id: string,
    input: ReviewText & { draftId: string }, store = getCommentsStore()) {
    const domain = projectPartition(project.id);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const authorId = await authorize(project, actor);
        const current = await readSession(store, domain, id);
        if (!current || current.doc.authorId !== authorId) throw missing();
        if (current.doc.state !== 'open' || current.doc.draftId !== input.draftId) throw closed();
        const doc = { ...current.doc, ...reviewText(input), lastActivityAt: nowIso() };
        if (await store.writeReviewSessionBatch(domain, [{ operation: 'replace', doc, etag: current.etag }]) === 'ok')
            return sessionView(doc, project, actor, store, { detail: true });
    }
    throw apiErrors.conflict();
}

function reviewText(text: ReviewText) {
    return { ...(text.title === undefined ? {} : { title: text.title || undefined }),
        ...(text.summary === undefined ? {} : { summary: text.summary || undefined }) };
}

export async function sendReviewSession(project: DbProject, actor: ProjectActor, id: string, input: SendInput, store = getCommentsStore()) {
    const domain = projectPartition(project.id);
    for (let retry = 0; retry < MAX_ATTEMPTS; retry++) {
        const submitter = await authorize(project, actor);
        const current = await readSession(store, domain, id);
        if (!current || !manager(current.doc, actor)) throw missing();
        const doc = current.doc;
        const attempt = submission(domain, submitter, input.idempotencyKey, { operation: 'review-submit', id, ...input })!;
        const receiptId = `$review-session-receipt_${attempt.id.slice('$submission_'.length)}`;
        const replay = await store.reviewSessionRecord<Receipt>(domain, receiptId);
        if (replay) {
            if (replay.doc.type !== 'review-session-receipt' || replay.doc.fingerprint !== attempt.fingerprint)
                throw apiErrors.conflict();
            const release = (await store.reviewSessionRecord<DbReviewRelease>(domain, replay.doc.releaseId))?.doc;
            if (!release || release.type !== 'review-release') throw missing();
            return sentView(doc, release, project, actor, store);
        }
        if (doc.state !== 'open' || doc.draftId !== input.draftId || doc.revision !== input.revision) throw closed();
        if (!doc.pendingThreadIds.length) throw apiErrors.invalidRequest('Add a comment before sending the review.');
        if (doc.authorId !== submitter && (input.title !== undefined || input.summary !== undefined)) throw apiErrors.forbidden();
        const { snapshotReviewGroups } = await import('../integrations/reviewGroups');
        const [open, sequence, integrationGroups] = await Promise.all([
            sessionPointer(store, domain, doc.authorId),
            doc.number === undefined ? store.reviewSessionRecord<Sequence>(domain, sequenceId) : null,
            snapshotReviewGroups(project)
        ]);
        if (open?.doc.sessionId !== id) continue;
        const number = doc.number ?? (sequence?.doc.value ?? 0) + 1;
        const at = nowIso();
        const sent: DbReviewSession = {
            ...doc, ...reviewText(input), state: 'submitted', number, draftId: undefined, pendingThreadIds: [],
            publishedThreadIds: [...doc.publishedThreadIds, ...doc.pendingThreadIds],
            revision: doc.revision + 1, lastActivityAt: at, submittedAt: at
        };
        const release: DbReviewRelease = {
            type: 'review-release', domain, id: reviewReleaseId(id, sent.revision), projectId: project.id,
            sessionId: id, revision: sent.revision, number, authorId: doc.authorId, authorName: doc.authorName, submittedBy: submitter,
            submittedAt: at, title: sent.title, summary: sent.summary, threadIds: doc.pendingThreadIds,
            threadCount: sent.threadCount, integrationGroups,
            emailPending: true, integrationPending: true
        };
        const operations: ReviewSessionWrite[] = [
            { operation: 'create', doc: release },
            { operation: 'create', doc: { type: 'review-session-receipt', id: receiptId, domain, releaseId: release.id, fingerprint: attempt.fingerprint, ttl: submissionTtlSeconds } },
            { operation: 'replace', doc: sent, etag: current.etag },
            { operation: 'delete', id: open.doc.id, etag: open.etag }
        ];
        if (doc.number === undefined) {
            const next: Sequence = { type: 'review-session-number', id: sequenceId, domain, value: number };
            operations.push(sequence ? { operation: 'replace', doc: next, etag: sequence.etag } : { operation: 'create', doc: next });
        }
        try {
            if (await store.writeReviewSessionBatch(domain, operations) !== 'ok') continue;
        } catch (error) {
            const committed = await store.reviewSessionRecord<Receipt>(domain, receiptId);
            if (!committed) throw error;
            continue;
        }
        queueMcpEventDelivery(project.id);
        const deadline = Date.now() + 15_000;
        afterResponse(async () => {
            try {
                await indexReleasedReview(release, store, deadline);
                if (Date.now() >= deadline) return;
                const [{ deliverReviewNow }, { appBaseUrl }] = await Promise.all([import('../integrations/deliverNow'), import('../app/request')]);
                const baseUrl = configuredAppBaseUrl() ?? await appBaseUrl().catch(() => undefined);
                if (baseUrl) await deliverReviewNow(project, release, { baseUrl, deadline, comments: store });
            } catch {
                console.warn('[review-sessions] Delivery after send needs retry');
            }
        });
        return sentView(sent, release, project, actor, store);
    }
    throw apiErrors.conflict();
}

function sentView(doc: DbReviewSession, release: DbReviewRelease, project: DbProject, actor: ProjectActor, store: CommentsStore) {
    return sessionView({
        ...doc, state: 'submitted', draftId: undefined, revision: release.revision, threadCount: release.threadCount,
        title: release.title, summary: release.summary,
        pendingThreadIds: [], submittedAt: release.submittedAt
    }, project, actor, store);
}

export async function resumeReviewSession(project: DbProject, actor: ProjectActor, id: string, store = getCommentsStore()) {
    const domain = projectPartition(project.id);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const authorId = await authorize(project, actor);
        const current = await readSession(store, domain, id);
        if (!current || current.doc.authorId !== authorId) throw missing();
        if (current.doc.state === 'open') return sessionView(current.doc, project, actor, store, { detail: true });
        if (current.doc.state !== 'submitted') throw closed();
        if (current.doc.threadCount >= MAX_REVIEW_COMMENTS) throw full();
        if (await sessionPointer(store, domain, authorId)) throw new ApiError(409, 'conflict', 'Send or discard your open review before resuming another.');
        const doc: DbReviewSession = { ...current.doc, state: 'open', draftId: nanoid(), lastActivityAt: nowIso() };
        const result = await store.writeReviewSessionBatch(domain, [
            { operation: 'create', doc: pointer(doc) }, { operation: 'replace', doc, etag: current.etag }
        ]);
        if (result === 'ok') return sessionView(doc, project, actor, store, { detail: true });
    }
    throw apiErrors.conflict();
}

export async function discardReviewSession(project: DbProject, actor: ProjectActor, id: string, draftId: string, store = getCommentsStore()) {
    const domain = projectPartition(project.id);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const discardedBy = await authorize(project, actor);
        const current = await readSession(store, domain, id);
        if (!current || current.doc.state === 'submitted') {
            const receipt = (await store.reviewSessionRecord<Discard>(domain, discardId(id, draftId)))?.doc;
            if (receipt?.type === 'review-session-discard'
                && (receipt.authorId === discardedBy || (actor.kind === 'member' && actor.isAdmin)))
                return current ? sessionView(current.doc, project, actor, store) : null;
        }
        if (!current || !manager(current.doc, actor)) throw missing();
        if (current.doc.draftId !== draftId || current.doc.state === 'submitted') throw closed();
        if (current.doc.state === 'open') {
            const doc: DbReviewSession = { ...current.doc, state: 'discarding', discardedBy, lastActivityAt: nowIso() };
            if (await store.writeReviewSessionBatch(domain, [{ operation: 'replace', doc, etag: current.etag }]) !== 'ok') continue;
        }
        await finishReviewDiscard(store, domain, id, draftId);
        const saved = await readSession(store, domain, id);
        return saved ? sessionView(saved.doc, project, actor, store) : null;
    }
    throw apiErrors.conflict();
}

async function finishReviewDiscard(store: CommentsStore, domain: string, id: string, draftId: string, deadline = Infinity) {
    const initial = await readSession(store, domain, id);
    if (!initial || initial.doc.state !== 'discarding' || initial.doc.draftId !== draftId) return;
    // The claim above invalidates all pending mutations. No stale tab can add to a discarding review.
    for (const threadId of initial.doc.pendingThreadIds) {
        if (Date.now() >= deadline) return;
        const saved = await store.get(domain, threadId);
        if (!saved) continue;
        const comment = saved.comment;
        if (comment.reviewSession?.id !== id || comment.reviewSession.releasedAt) throw new Error('Pending review comment changed.');
        await queueThreadCleanup(domain, threadId, true);
        const result = await store.delete(domain, threadId, saved.etag);
        if (result === 'conflict') return;
        if (result === 'ok') {
            await forgetScreenshot(store, domain, threadId, Boolean(comment.screenshot), null, comment.thread.items.filter(item => item.screenshot).map(item => item.id));
            await cleanupRemovedRecordings(comment, null, store);
        }
    }
    const current = await readSession(store, domain, id);
    if (!current || current.etag !== initial.etag) return;
    const open = await sessionPointer(store, domain, current.doc.authorId);
    if (open?.doc.sessionId !== id) return;
    const operations: ReviewSessionWrite[] = [{ operation: 'delete', id: open.doc.id, etag: open.etag }];
    if (current.doc.discardedBy) operations.push({ operation: 'create', doc: {
        type: 'review-session-discard', id: discardId(id, draftId), domain, sessionId: id, authorId: current.doc.authorId,
        discardedBy: current.doc.discardedBy, discardedAt: current.doc.lastActivityAt, ttl: submissionTtlSeconds
    } });
    if (current.doc.revision === 0) operations.push({ operation: 'delete', id: current.doc.id, etag: current.etag });
    else {
        const latest = (await store.reviewSessionRecord<DbReviewRelease>(domain, reviewReleaseId(id, current.doc.revision)))?.doc;
        const doc: DbReviewSession = {
            ...current.doc, state: 'submitted', draftId: undefined, discardedBy: undefined, pendingThreadIds: [],
            threadCount: current.doc.threadCount - current.doc.pendingThreadIds.length, title: latest?.title, summary: latest?.summary
        };
        operations.push({ operation: 'replace', doc, etag: current.etag });
    }
    await store.writeReviewSessionBatch(domain, operations);
}

async function indexReleasedReview(release: DbReviewRelease, store: CommentsStore, deadline = Infinity) {
    const project = await findProject(release.projectId);
    if (!project || project.transfer) return;
    let hasMore = false;
    const queue = [...release.threadIds];
    await Promise.all(Array.from({ length: Math.min(queue.length, 8) }, async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
            if (Date.now() >= deadline) { hasMore = true; return; }
            const saved = await store.get(release.domain, id);
            if (!saved || saved.comment.reviewSessionIndexed) continue;
            const current = saved.comment;
            if (!current.reviewSession?.releasedAt) { hasMore = true; continue; }
            const result = await store.replace(withSyncMark(project, null, { ...current, reviewSessionIndexed: true }), saved.etag);
            if (result === 'conflict') hasMore = true;
            if (result === 'ok') queueAiTitles(project, [current], 'new');
        }
    }));
    if (hasMore) return;
    const stored = await store.reviewSessionRecord<DbReviewRelease>(release.domain, release.id);
    if (!stored?.doc.integrationPending) return;
    const { integrationPending: _, ...doc } = stored.doc;
    await store.writeReviewSessionBatch(release.domain, [{ operation: 'replace', doc, etag: stored.etag }]);
}

/** Durable worker recovery for interrupted discard, plus integration discovery for committed reviews. */
export async function prepareReviewReleases(store: CommentsStore = getCommentsStore(), limit = 20, deadline = Infinity,
    options: { integrationsOnly?: boolean } = {}) {
    let failed = 0;
    const discards = options.integrationsOnly ? [] : await store.listReviewDiscards(limit);
    for (const doc of discards) if (doc.draftId) {
        if (Date.now() >= deadline) return failed;
        try { await finishReviewDiscard(store, doc.domain, sessionId(doc), doc.draftId, deadline); }
        catch { failed++; console.warn('[review-sessions] Draft discard needs retry'); }
    }
    const releases = await store.listReviewReleasesPending('integrations', limit);
    for (const release of releases) {
        if (Date.now() >= deadline) return failed;
        try { await indexReleasedReview(release, store, deadline); }
        catch { failed++; console.warn('[review-sessions] Release discovery needs retry'); }
    }
    return failed;
}
