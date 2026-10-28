import type { OriginFilter } from './originFilter';
import type { DbComment, DbCommentActivity, DbScreenshot, DbSubmission, DbSyncTombstone, DbThreadItem } from '../db/schema';
import { isCosmosConfigured } from '../db/client';
import { isLocalRuntime } from '../comments/environment';
import { createCosmosCommentsStore } from './cosmosCommentsStore';
import { getMemoryCommentsStore } from './memoryCommentsStore';

export type StoredComment = {
    comment: DbComment;
    /** Opaque version used for optimistic concurrency (Cosmos `_etag`) */
    etag: string;
};

/** Result of a write that only applies to the version that was read (`etag`) */
export type ConditionalWriteResult = 'ok' | 'conflict' | 'not_found';
export type AppendResult = 'ok' | 'full' | 'not_found';
export type SyncPendingOptions = { limit?: number; after?: string };

/** Callers cannot turn a worker page into an unbounded cross-partition fetch. */
export function syncPendingPageLimit(options: SyncPendingOptions = {}) {
    const requested = options.limit ?? 100;
    return Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.trunc(requested))) : 100;
}

/**
 * Persistence of comments. All operations are scoped to a single domain (the Cosmos partition key),
 * so every query is a single-partition query.
 */
export type CommentsStore = {
    /** Indexed syncKey page, including deletion intents: default 100, maximum 1000, ascending. */
    listSyncPending(options?: SyncPendingOptions): Promise<(DbComment | DbSyncTombstone)[]>;
    /** Delete + deletion intent in one partition transaction under the comment etag. */
    deleteWithTombstone(domain: string, id: string, etag: string, tombstone: DbSyncTombstone): Promise<ConditionalWriteResult>;
    /** Shared discovery acknowledges only the deletion version it durably fanned out. */
    deleteTombstone(domain: string, commentId: string, expectedVersion?: number): Promise<ConditionalWriteResult>;
    /** Durable notification discovery, across projects, without the inbox's display cap. */
    listNotificationPending(): Promise<DbComment[]>;
    /** Canonical view, newest first. Only legacy records use a base-path query-string fallback. */
    list(domain: string, path: string, limit: number, originFilter?: OriginFilter): Promise<DbComment[]>;
    /** Every comment of the partition (all pages), newest first */
    listAll(domain: string, limit: number, originFilter?: OriginFilter): Promise<DbComment[]>;
    /** All thread activity, without message text or images; authoritative badge counts. */
    listActivity(domain: string): Promise<DbCommentActivity[]>;
    get(domain: string, id: string): Promise<StoredComment | null>;
    create(comment: DbComment): Promise<void>;
    getSubmission(domain: string, id: string): Promise<DbSubmission | null>;
    /** Receipt + create/conditional replacement + optional image: one partition transaction. */
    commitSubmission(receipt: DbSubmission, comment: DbComment, etag?: string, screenshot?: DbScreenshot): Promise<'ok' | 'conflict'>;
    /** Replaces the comment only when it was not changed since it was read (`etag`) */
    replace(comment: DbComment, etag: string): Promise<ConditionalWriteResult>;
    /**
     * Deletes the comment only when it was not changed since it was read (`etag`), so a reply
     * appended in the meantime is never deleted with it
     */
    delete(domain: string, id: string, etag: string): Promise<ConditionalWriteResult>;
    /** Atomically appends a thread item unless the thread already has `maxItems` items */
    appendThreadItem(domain: string, id: string, item: DbThreadItem, maxItems: number, updatedAt: string): Promise<AppendResult>;

    /**
     * Atomically adds one to the counter `id` unless it already reached `limit`. Returns `false`
     * (and changes nothing) when the limit is reached. The counter expires after `ttlSeconds`.
     */
    incrementCounter(domain: string, id: string, limit: number, ttlSeconds: number): Promise<boolean>;

    /** The domain's next comment number (1, 2, 3, ...), atomically: its public id (`#12`) */
    nextCommentNumber(domain: string): Promise<number>;

    /** Stores a comment's screenshot (a document of its own in the comment's partition) */
    createScreenshot(screenshot: DbScreenshot): Promise<void>;
    /** Atomically swaps image and comment metadata, conditional on the authorized comment version. */
    replaceScreenshot(comment: DbComment, etag: string, screenshot: DbScreenshot): Promise<ConditionalWriteResult>;
    getScreenshot(domain: string, commentId: string): Promise<DbScreenshot | null>;
    /** Deletes a comment's screenshot; nothing when there is none */
    deleteScreenshot(domain: string, commentId: string): Promise<void>;
};

let warnedAboutMemoryStore = false;

/**
 * Cosmos DB when `COSMOSDB_CONNECTION_STRING` or `COSMOSDB_ENDPOINT` is set (see `db/client.ts`).
 * Locally (`next dev`, e2e tests) without either, an in-memory store. Anywhere else that is an error.
 */
export function getCommentsStore(): CommentsStore {
    if (isCosmosConfigured())
        return createCosmosCommentsStore();

    if (!isLocalRuntime())
        throw new Error('COSMOSDB_CONNECTION_STRING or COSMOSDB_ENDPOINT is required outside local development.');

    if (!warnedAboutMemoryStore) {
        warnedAboutMemoryStore = true;
        console.warn('[comments] Cosmos DB is not configured - using an in-memory comments store (data is lost on restart).');
    }

    return getMemoryCommentsStore();
}
