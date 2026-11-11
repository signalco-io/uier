import { matchesArchive } from './archiveFilter';
import { matchesOrigin } from './originFilter';
import { matchesAuthor } from './authorFilter';
import { matchesVisibility } from './visibilityFilter';
import { withThreadActivity } from '../comments/activity';
import { withNotificationEvent } from '../notifications/events';
import { commentSequenceId, isCommentDocument, screenshotDocumentId, syncTombstoneId, type DbComment, type DbCommentActivity, type DbScreenshot, type DbSequence, type DbSubmission, type DbSyncTombstone } from '../db/schema';
import { syncPendingPageLimit, type AppendResult, type CommentsStore, type ConditionalWriteResult, type StoredComment } from './commentsStore';
import { candidateBudget, CommentQueryBudgetError, throwIfQueryAborted, toCommentQueryCandidate, validateCandidatePredicate, type CommentQueryCandidate } from './commentQuerySource';
import { withCommentQueryMetadata } from './queryMetadata';

/** Safety net so a long-running dev/test server can't grow without bounds */
const MAX_COMMENTS_PER_DOMAIN = 5000;

type MemoryEntry = {
    /** A comment, the domain's comment numbers or a screenshot: as in Cosmos DB, they share the partition */
    document: DbComment | DbSequence | DbScreenshot | DbSubmission | DbSyncTombstone;
    version: number;
    /** Milliseconds; emulates Cosmos `_ts` (last modification) for TTL */
    modifiedAt: number;
};

type MemoryCounter = {
    count: number;
    expiresAt: number;
};

type MemoryState = {
    domains: Map<string, Map<string, MemoryEntry>>;
    counters: Map<string, MemoryCounter>;
    version: number;
};

// Kept on globalThis so the data survives module reloads in `next dev` (a new name when the shape
// of the state changes)
const globalForStore = globalThis as typeof globalThis & { __uierCommentsMemoryStore2?: MemoryState };

function state() {
    return globalForStore.__uierCommentsMemoryStore2 ??= { domains: new Map(), counters: new Map(), version: 0 };
}

function isExpired(entry: MemoryEntry, now: number) {
    const ttl = 'ttl' in entry.document ? entry.document.ttl : undefined;
    return typeof ttl === 'number' && ttl > 0 && entry.modifiedAt + ttl * 1000 <= now;
}

function domainEntries(domain: string) {
    const domains = state().domains;
    let entries = domains.get(domain);
    if (!entries) {
        entries = new Map();
        domains.set(domain, entries);
    }

    const now = Date.now();
    for (const [id, entry] of entries) {
        if (isExpired(entry, now))
            entries.delete(id);
    }

    return entries;
}

/** The entry's comment; the sequence is not one */
function commentOf(entry: MemoryEntry | undefined): DbComment | undefined {
    return entry && isCommentDocument(entry.document) ? entry.document as DbComment : undefined;
}

function domainComments(domain: string) {
    return [...domainEntries(domain).values()].flatMap(entry => commentOf(entry) ?? []);
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function pathMatches(comment: DbComment, path: string) {
    return comment.path === path || (comment.pageStateVersion !== 1 && !/[?#]/.test(path) && comment.path.startsWith(`${path}?`));
}

export function getMemoryCommentsStore(): CommentsStore {
    return {
        async queryCandidates(domain, options = {}) {
            validateCandidatePredicate(options.predicate);
            const budget = candidateBudget(options);
            const start = performance.now();
            const candidates: CommentQueryCandidate[] = [];
            let bytes = 0;
            throwIfQueryAborted(options.signal);
            for (const entry of domainEntries(domain).values()) {
                throwIfQueryAborted(options.signal);
                if (performance.now() - start > budget.durationMs) throw new CommentQueryBudgetError();
                const comment = commentOf(entry);
                if (!comment || typeof comment.path !== 'string' || !matchesVisibility(comment, options.visibility)
                    || !matchesOrigin(comment.origin, options.origin) || !matchesArchive(comment, options.archive)) continue;
                const candidate = toCommentQueryCandidate(comment, String(entry.version));
                if (options.predicate && !options.predicate.test(candidate)) continue;
                bytes += Buffer.byteLength(JSON.stringify(candidate));
                candidates.push(candidate);
                if (candidates.length > budget.candidates || bytes > budget.bytes) throw new CommentQueryBudgetError();
            }
            return candidates;
        },
        async listRealtime(domain) {
            return [...domainEntries(domain).values()].flatMap(entry => {
                const comment = commentOf(entry);
                if (!comment) return [];
                const { id, path, private: isPrivate, authorId } = comment;
                return [{ id, domain, path, private: isPrivate, authorId, revision: String(entry.version) }];
            });
        },
        async listSyncPending(options = {}) {
            return [...state().domains.keys()].flatMap(domain => [...domainEntries(domain).values()])
                .flatMap(entry => {
                    const doc = entry.document;
                    if (!(isCommentDocument(doc) || ('type' in doc && doc.type === 'tombstone'))
                        || !('syncPending' in doc) || !doc.syncPending || !('projectId' in doc) || !doc.projectId) return [];
                    // Existing in-process fixtures can predate syncKey; production had no outbox.
                    const key = 'syncKey' in doc && typeof doc.syncKey === 'string' ? doc.syncKey : `${doc.domain}:${doc.id}`;
                    return options.after && key <= options.after ? [] : [{ ...clone(doc as DbComment | DbSyncTombstone), syncKey: key }];
                })
                .sort((a, b) => a.syncKey < b.syncKey ? -1 : a.syncKey > b.syncKey ? 1 : 0)
                .slice(0, syncPendingPageLimit(options));
        },
        async deleteWithTombstone(domain, id, etag, tombstone) {
            if (tombstone.domain !== domain || tombstone.commentId !== id || tombstone.id !== syncTombstoneId(id))
                throw new Error('Deletion intent does not match its comment.');
            const entries = domainEntries(domain);
            const entry = entries.get(id);
            if (!commentOf(entry)) return 'not_found';
            if (String(entry!.version) !== etag) return 'conflict';
            // One synchronous commit, matching Cosmos Delete + Upsert in the same batch.
            entries.delete(id);
            entries.set(tombstone.id, { document: clone(tombstone), version: ++state().version, modifiedAt: Date.now() });
            return 'ok';
        },
        async deleteTombstone(domain, commentId, expectedVersion) {
            const entries = domainEntries(domain);
            const id = syncTombstoneId(commentId);
            const document = entries.get(id)?.document;
            if (!document || !('type' in document) || document.type !== 'tombstone') return 'not_found';
            if (expectedVersion !== undefined && document.syncVersion !== expectedVersion) return 'conflict';
            entries.delete(id);
            return 'ok';
        },
        async listNotificationPending() {
            return [...state().domains.keys()].flatMap(domainComments)
                .filter(comment => comment.notificationPending && comment.projectId).map(clone);
        },
        async list(domain, path, limit, originFilter, authorId, archive) {
            return domainComments(domain)
                .filter(comment => matchesOrigin(comment.origin, originFilter) && matchesAuthor(comment, authorId) && matchesArchive(comment, archive))
                .filter(comment => pathMatches(comment, path))
                .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
                .slice(0, limit)
                .map(clone);
        },
        async listChangedSince(domain, since, limit) {
            // Second precision, as Cosmos `_ts`; ordered by write within a second.
            const floor = Math.floor(since / 1000) * 1000;
            return [...domainEntries(domain).values()].flatMap(entry => {
                const comment = commentOf(entry);
                return comment && entry.modifiedAt >= floor ? [{ entry, comment }] : [];
            }).sort((a, b) => a.entry.modifiedAt - b.entry.modifiedAt || a.entry.version - b.entry.version)
                .slice(0, Math.max(1, Math.min(1000, Math.trunc(limit))))
                .map(({ entry, comment }) => ({ comment: clone(comment), changedAt: Math.floor(entry.modifiedAt / 1000) * 1000 }));
        },
        async listAll(domain, limit, originFilter, authorId, archive) {
            return domainComments(domain)
                .filter(comment => matchesOrigin(comment.origin, originFilter) && matchesAuthor(comment, authorId) && matchesArchive(comment, archive))
                .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
                .slice(0, limit)
                .map(clone);
        },
        async get(domain, id): Promise<StoredComment | null> {
            const entry = domainEntries(domain).get(id);
            const comment = commentOf(entry);
            return entry && comment ? { comment: clone(comment), etag: String(entry.version) } : null;
        },
        async getSubmission(domain, id) {
            const document = domainEntries(domain).get(id)?.document;
            return document && 'type' in document && document.type === 'submission' ? clone(document) : null;
        },
        async commitSubmission(receipt, comment, etag, screenshot) {
            const entries = domainEntries(receipt.domain);
            const previous = entries.get(comment.id);
            if (entries.has(receipt.id) || (etag ? !previous || String(previous.version) !== etag : previous)) return 'conflict';
            // No await between checking and applying: mirrors the Cosmos transaction.
            for (const document of [receipt, withCommentQueryMetadata(comment), ...(screenshot ? [screenshot] : [])]) {
                entries.set(document.id, { document: clone(document), version: ++state().version, modifiedAt: Date.now() });
            }
            return 'ok';
        },
        async create(comment) {
            const entries = domainEntries(comment.domain);
            if (entries.has(comment.id))
                throw new Error(`Comment ${comment.id} already exists`);

            if (entries.size >= MAX_COMMENTS_PER_DOMAIN) {
                const oldestId = [...entries].find(([, entry]) => commentOf(entry))?.[0];
                if (oldestId) {
                    entries.delete(oldestId);
                    entries.delete(screenshotDocumentId(oldestId));
                }
            }

            entries.set(comment.id, { document: clone(withCommentQueryMetadata(comment)), version: ++state().version, modifiedAt: Date.now() });
        },
        async replace(comment, etag): Promise<ConditionalWriteResult> {
            const entries = domainEntries(comment.domain);
            const entry = entries.get(comment.id);
            if (!entry || !commentOf(entry))
                return 'not_found';
            if (String(entry.version) !== etag)
                return 'conflict';

            entries.set(comment.id, { document: clone(withCommentQueryMetadata(comment)), version: ++state().version, modifiedAt: Date.now() });
            return 'ok';
        },
        async delete(domain, id, etag): Promise<ConditionalWriteResult> {
            const entries = domainEntries(domain);
            const entry = entries.get(id);
            if (!entry || !commentOf(entry))
                return 'not_found';
            if (String(entry.version) !== etag)
                return 'conflict';

            entries.delete(id);
            return 'ok';
        },
        async listActivity(domain): Promise<DbCommentActivity[]> {
            return [...domainEntries(domain).values()].flatMap(entry => {
                const comment = commentOf(entry);
                if (!comment) return [];
                const { id, path, origin, private: isPrivate, authorId, resolved, inProgress, archivedAt, verification, createdAt, activity } = comment;
                return [{ id, domain, path, origin, private: isPrivate, authorId, resolved, inProgress, archivedAt, verification: verification ? { outcome: verification.outcome } : undefined, createdAt, activity: clone(activity),
                    thread: { items: activity ? [] : comment.thread.items.map(item => ({ authorId: item.authorId, deletedAt: item.deletedAt })) } }];
            }).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        },
        async latestActivity(domain, visibleTo) {
            return domainComments(domain)
                .filter(comment => typeof comment.path === 'string' && matchesVisibility(comment, visibleTo))
                .map(comment => comment.updatedAt)
                .filter((updatedAt): updatedAt is string => typeof updatedAt === 'string')
                .sort().at(-1);
        },
        async appendThreadItem(domain, id, item, maxItems, updatedAt): Promise<AppendResult> {
            const entries = domainEntries(domain);
            const current = commentOf(entries.get(id));
            if (!current)
                return 'not_found';
            if (current.thread.items.length >= maxItems)
                return 'full';

            const comment: DbComment = {
                ...withNotificationEvent(withThreadActivity(current, item.authorId ?? 'legacy', Boolean(item.agent)), item.authorId ?? 'legacy', 'reply', updatedAt),
                thread: { ...current.thread, items: [...current.thread.items, clone(item)] },
                updatedAt
            };
            entries.set(id, { document: withCommentQueryMetadata(comment), version: ++state().version, modifiedAt: Date.now() });
            return 'ok';
        },
        async listScreenshotsBefore(before, continuation) {
            const items = [...state().domains.keys()].flatMap(domain => [...domainEntries(domain).values()])
                .flatMap(entry => {
                    const image = entry.document;
                    if (!('type' in image) || image.type !== 'screenshot' || image.createdAt >= before) return [];
                    return [{ domain: image.domain, commentId: image.commentId, itemId: image.itemId, etag: String(entry.version), key: `${image.domain}:${image.id}` }];
                }).filter(image => !continuation || image.key > continuation).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
            const page = items.slice(0, 100);
            return { items: page, continuation: items.length > page.length ? page.at(-1)?.key : undefined };
        },
        async createScreenshot(screenshot) {
            const entries = domainEntries(screenshot.domain);
            if (entries.has(screenshot.id))
                throw new Error(`Screenshot ${screenshot.id} already exists`);
            entries.set(screenshot.id, { document: clone(screenshot), version: ++state().version, modifiedAt: Date.now() });
        },
        async replaceScreenshot(comment, etag, screenshot) {
            const entries = domainEntries(comment.domain);
            const entry = entries.get(comment.id);
            if (!commentOf(entry)) return 'not_found';
            if (String(entry!.version) !== etag) return 'conflict';
            // No await between the check and both writes: the same transaction as Cosmos.
            const modifiedAt = Date.now();
            const savedComment = clone(withCommentQueryMetadata(comment));
            const savedImage = clone(screenshot);
            entries.set(comment.id, { document: savedComment, version: ++state().version, modifiedAt });
            entries.set(screenshot.id, { document: savedImage, version: ++state().version, modifiedAt });
            return 'ok';
        },
        async getScreenshot(domain, commentId, itemId) {
            const document = domainEntries(domain).get(screenshotDocumentId(commentId, itemId))?.document;
            return document && 'type' in document && document.type === 'screenshot' ? clone(document) : null;
        },
        async deleteScreenshot(domain, commentId, etag, itemId) {
            const entries = domainEntries(domain);
            const id = screenshotDocumentId(commentId, itemId);
            if (!etag || String(entries.get(id)?.version) === etag) entries.delete(id);
        },
        async nextCommentNumber(domain) {
            // A document in the partition, as in Cosmos DB; a missing one continues after the highest stored
            const entries = domainEntries(domain);
            const sequence = entries.get(commentSequenceId)?.document;
            const next = sequence && !isCommentDocument(sequence)
                ? (sequence as DbSequence).count + 1
                : Math.max(0, ...domainComments(domain).map(comment => comment.number ?? 0)) + 1;
            entries.set(commentSequenceId, {
                document: { id: commentSequenceId, domain, type: 'sequence', count: next },
                version: ++state().version,
                modifiedAt: Date.now()
            });
            return next;
        },
        async deleteSequence(domain) {
            domainEntries(domain).delete(commentSequenceId);
        },
        async getCounter(domain, id) {
            const counter = state().counters.get(`${domain}/${id}`);
            return counter && counter.expiresAt > Date.now() ? counter.count : 0;
        },
        async incrementCounter(domain, id, limit, ttlSeconds) {
            const counters = state().counters;
            const key = `${domain}/${id}`;
            const now = Date.now();
            for (const [counterKey, counter] of counters) {
                if (counter.expiresAt <= now)
                    counters.delete(counterKey);
            }

            const counter = counters.get(key) ?? { count: 0, expiresAt: now + ttlSeconds * 1000 };
            if (counter.count >= limit)
                return false;

            counters.set(key, { ...counter, count: counter.count + 1 });
            return true;
        }
    };
}
