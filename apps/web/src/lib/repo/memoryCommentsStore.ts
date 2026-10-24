import type { DbComment } from '../db/schema';
import type { AppendResult, CommentsStore, ReplaceResult, StoredComment } from './commentsStore';

/** Safety net so a long-running dev/test server can't grow without bounds */
const MAX_COMMENTS_PER_DOMAIN = 5000;

type MemoryEntry = {
    comment: DbComment;
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

// Kept on globalThis so the data survives module reloads in `next dev`
const globalForStore = globalThis as typeof globalThis & { __uierCommentsMemoryStore?: MemoryState };

function state() {
    return globalForStore.__uierCommentsMemoryStore ??= { domains: new Map(), counters: new Map(), version: 0 };
}

function isExpired(entry: MemoryEntry, now: number) {
    const ttl = entry.comment.ttl;
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

function clone<T>(value: T): T {
    return structuredClone(value);
}

function pathMatches(docPath: string, path: string) {
    return docPath === path || docPath.startsWith(`${path}?`);
}

export function getMemoryCommentsStore(): CommentsStore {
    return {
        async list(domain, path, limit) {
            return [...domainEntries(domain).values()]
                .map(entry => entry.comment)
                .filter(comment => pathMatches(comment.path, path))
                .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
                .slice(0, limit)
                .map(clone);
        },
        async get(domain, id): Promise<StoredComment | null> {
            const entry = domainEntries(domain).get(id);
            return entry ? { comment: clone(entry.comment), etag: String(entry.version) } : null;
        },
        async create(comment) {
            const entries = domainEntries(comment.domain);
            if (entries.has(comment.id))
                throw new Error(`Comment ${comment.id} already exists`);

            if (entries.size >= MAX_COMMENTS_PER_DOMAIN) {
                const oldestId = entries.keys().next().value;
                if (oldestId)
                    entries.delete(oldestId);
            }

            entries.set(comment.id, { comment: clone(comment), version: ++state().version, modifiedAt: Date.now() });
        },
        async replace(comment, etag): Promise<ReplaceResult> {
            const entries = domainEntries(comment.domain);
            const entry = entries.get(comment.id);
            if (!entry)
                return 'not_found';
            if (String(entry.version) !== etag)
                return 'conflict';

            entries.set(comment.id, { comment: clone(comment), version: ++state().version, modifiedAt: Date.now() });
            return 'ok';
        },
        async delete(domain, id) {
            return domainEntries(domain).delete(id);
        },
        async appendThreadItem(domain, id, item, maxItems, updatedAt): Promise<AppendResult> {
            const entries = domainEntries(domain);
            const entry = entries.get(id);
            if (!entry)
                return 'not_found';
            if (entry.comment.thread.items.length >= maxItems)
                return 'full';

            const comment: DbComment = {
                ...entry.comment,
                thread: { ...entry.comment.thread, items: [...entry.comment.thread.items, clone(item)] },
                updatedAt
            };
            entries.set(id, { comment, version: ++state().version, modifiedAt: Date.now() });
            return 'ok';
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
