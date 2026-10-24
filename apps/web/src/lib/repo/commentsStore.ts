import type { DbComment, DbThreadItem } from '../db/schema';
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

/**
 * Persistence of comments. All operations are scoped to a single domain (the Cosmos partition key),
 * so every query is a single-partition query.
 */
export type CommentsStore = {
    /** Comments for the page, newest first. Also matches old documents whose path still contains a query string. */
    list(domain: string, path: string, limit: number): Promise<DbComment[]>;
    get(domain: string, id: string): Promise<StoredComment | null>;
    create(comment: DbComment): Promise<void>;
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
