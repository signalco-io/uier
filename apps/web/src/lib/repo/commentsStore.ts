import type { DbComment } from '../db/schema';
import { isCosmosConfigured } from '../db/client';
import { createCosmosCommentsStore } from './cosmosCommentsStore';
import { getMemoryCommentsStore } from './memoryCommentsStore';

export type StoredComment = {
    comment: DbComment;
    /** Opaque version used for optimistic concurrency (Cosmos `_etag`) */
    etag: string;
};

export type ReplaceResult = 'ok' | 'conflict' | 'not_found';

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
    replace(comment: DbComment, etag: string): Promise<ReplaceResult>;
    /** Returns `false` when the comment does not exist */
    delete(domain: string, id: string): Promise<boolean>;

    /** Number of unresolved comments on the page */
    countUnresolved(domain: string, path: string): Promise<number>;
    /** `createdAt` of comments created by the author since `since` */
    commentTimestampsByAuthor(domain: string, authorId: string, since: string): Promise<string[]>;
    /** `createdAt` of replies (thread items except the first one) created by the author since `since` */
    replyTimestampsByAuthor(domain: string, authorId: string, since: string): Promise<string[]>;
    /** `createdAt` of all thread items (comments + replies) created from the IP since `since` */
    writeTimestampsByIp(domain: string, ipHash: string, since: string): Promise<string[]>;
};

let warnedAboutMemoryStore = false;

/**
 * Cosmos DB when `COSMOSDB_CONNECTION_STRING` is set; otherwise (local development, e2e tests,
 * non-production deployments) an in-memory store. Production requires Cosmos DB.
 */
export function getCommentsStore(): CommentsStore {
    if (isCosmosConfigured())
        return createCosmosCommentsStore();

    if (process.env.VERCEL_ENV === 'production')
        throw new Error('COSMOSDB_CONNECTION_STRING is required in production.');

    if (!warnedAboutMemoryStore) {
        warnedAboutMemoryStore = true;
        console.warn('[comments] COSMOSDB_CONNECTION_STRING is not set - using an in-memory comments store (data is lost on restart).');
    }

    return getMemoryCommentsStore();
}
