import type { SqlParameter } from '@azure/cosmos';
import type { DbComment } from '../db/schema';
import { cosmosDataContainerComments } from '../db/client';
import type { CommentsStore, ReplaceResult, StoredComment } from './commentsStore';

function errorCode(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: number | string }).code
        : undefined;
}

/** Removes Cosmos system properties (`_rid`, `_self`, `_etag`, `_attachments`, `_ts`) */
function withoutSystemProperties(resource: Record<string, unknown>): DbComment {
    return Object.fromEntries(Object.entries(resource).filter(([key]) => !key.startsWith('_'))) as DbComment;
}

// Matches the normalized path and old documents whose path still contains the query string (e.g. `/x?review=true`)
const pathFilter = '(c.path = @path OR STARTSWITH(c.path, @pathWithQuery))';

function pathParameters(path: string): SqlParameter[] {
    return [
        { name: '@path', value: path },
        { name: '@pathWithQuery', value: `${path}?` }
    ];
}

async function queryAll<T>(domain: string, query: string, parameters: SqlParameter[]) {
    const { resources } = await cosmosDataContainerComments().items.query<T>({
        query,
        parameters: [{ name: '@domain', value: domain }, ...parameters]
    }, { partitionKey: domain }).fetchAll();
    return resources;
}

export function createCosmosCommentsStore(): CommentsStore {
    return {
        async list(domain, path, limit) {
            const resources = await queryAll<Record<string, unknown>>(
                domain,
                `SELECT TOP @limit * FROM c WHERE c.domain = @domain AND ${pathFilter} ORDER BY c.createdAt DESC`,
                [...pathParameters(path), { name: '@limit', value: limit }]);
            return resources.map(withoutSystemProperties);
        },
        async get(domain, id): Promise<StoredComment | null> {
            const response = await cosmosDataContainerComments().item(id, domain).read<Record<string, unknown>>();
            if (!response.resource || !response.etag)
                return null;
            return { comment: withoutSystemProperties(response.resource), etag: response.etag };
        },
        async create(comment) {
            await cosmosDataContainerComments().items.create<DbComment>(comment);
        },
        async replace(comment, etag): Promise<ReplaceResult> {
            try {
                await cosmosDataContainerComments().item(comment.id, comment.domain).replace<DbComment>(comment, {
                    accessCondition: { type: 'IfMatch', condition: etag }
                });
                return 'ok';
            } catch (error) {
                const code = errorCode(error);
                if (code === 412)
                    return 'conflict';
                if (code === 404)
                    return 'not_found';
                throw error;
            }
        },
        async delete(domain, id) {
            try {
                await cosmosDataContainerComments().item(id, domain).delete();
                return true;
            } catch (error) {
                if (errorCode(error) === 404)
                    return false;
                throw error;
            }
        },
        async countUnresolved(domain, path) {
            const [count] = await queryAll<number>(
                domain,
                `SELECT VALUE COUNT(1) FROM c WHERE c.domain = @domain AND ${pathFilter} AND (NOT IS_BOOL(c.resolved) OR c.resolved = false)`,
                pathParameters(path));
            return count ?? 0;
        },
        async commentTimestampsByAuthor(domain, authorId, since) {
            return await queryAll<string>(
                domain,
                'SELECT VALUE c.createdAt FROM c WHERE c.domain = @domain AND c.authorId = @authorId AND c.createdAt >= @since',
                [{ name: '@authorId', value: authorId }, { name: '@since', value: since }]);
        },
        async replyTimestampsByAuthor(domain, authorId, since) {
            // Every write to a comment bumps `updatedAt`, so older comments can be skipped via the index
            return await queryAll<string>(
                domain,
                'SELECT VALUE i.createdAt FROM c JOIN i IN c.thread.items WHERE c.domain = @domain AND c.updatedAt >= @since AND i.authorId = @authorId AND i.createdAt >= @since AND i.id != c.thread.items[0].id',
                [{ name: '@authorId', value: authorId }, { name: '@since', value: since }]);
        },
        async writeTimestampsByIp(domain, ipHash, since) {
            return await queryAll<string>(
                domain,
                'SELECT VALUE i.createdAt FROM c JOIN i IN c.thread.items WHERE c.domain = @domain AND c.updatedAt >= @since AND i.ipHash = @ipHash AND i.createdAt >= @since',
                [{ name: '@ipHash', value: ipHash }, { name: '@since', value: since }]);
        }
    };
}
