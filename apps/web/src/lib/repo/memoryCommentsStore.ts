import { commentSequenceId, isCommentDocument, screenshotDocumentId, type DbComment, type DbScreenshot, type DbSequence } from '../db/schema';
import type { AppendResult, CommentsStore, ConditionalWriteResult, StoredComment } from './commentsStore';

/** Safety net so a long-running dev/test server can't grow without bounds */
const MAX_COMMENTS_PER_DOMAIN = 5000;

type MemoryEntry = {
    /** A comment, the domain's comment numbers or a screenshot: as in Cosmos DB, they share the partition */
    document: DbComment | DbSequence | DbScreenshot;
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
        async list(domain, path, limit) {
            return domainComments(domain)
                .filter(comment => pathMatches(comment, path))
                .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
                .slice(0, limit)
                .map(clone);
        },
        async listAll(domain, limit) {
            return domainComments(domain)
                .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
                .slice(0, limit)
                .map(clone);
        },
        async get(domain, id): Promise<StoredComment | null> {
            const entry = domainEntries(domain).get(id);
            const comment = commentOf(entry);
            return entry && comment ? { comment: clone(comment), etag: String(entry.version) } : null;
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

            entries.set(comment.id, { document: clone(comment), version: ++state().version, modifiedAt: Date.now() });
        },
        async replace(comment, etag): Promise<ConditionalWriteResult> {
            const entries = domainEntries(comment.domain);
            const entry = entries.get(comment.id);
            if (!entry || !commentOf(entry))
                return 'not_found';
            if (String(entry.version) !== etag)
                return 'conflict';

            entries.set(comment.id, { document: clone(comment), version: ++state().version, modifiedAt: Date.now() });
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
        async appendThreadItem(domain, id, item, maxItems, updatedAt): Promise<AppendResult> {
            const entries = domainEntries(domain);
            const current = commentOf(entries.get(id));
            if (!current)
                return 'not_found';
            if (current.thread.items.length >= maxItems)
                return 'full';

            const comment: DbComment = {
                ...current,
                thread: { ...current.thread, items: [...current.thread.items, clone(item)] },
                updatedAt
            };
            entries.set(id, { document: comment, version: ++state().version, modifiedAt: Date.now() });
            return 'ok';
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
            const savedComment = clone(comment);
            const savedImage = clone(screenshot);
            entries.set(comment.id, { document: savedComment, version: ++state().version, modifiedAt });
            entries.set(screenshot.id, { document: savedImage, version: ++state().version, modifiedAt });
            return 'ok';
        },
        async getScreenshot(domain, commentId) {
            const document = domainEntries(domain).get(screenshotDocumentId(commentId))?.document;
            return document && 'type' in document && document.type === 'screenshot' ? clone(document) : null;
        },
        async deleteScreenshot(domain, commentId) {
            domainEntries(domain).delete(screenshotDocumentId(commentId));
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
