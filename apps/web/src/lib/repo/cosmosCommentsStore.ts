import type { SqlParameter } from '@azure/cosmos';
import { commentSequenceId, isCommentDocument, screenshotDocumentId, type DbComment, type DbCounter, type DbScreenshot, type DbSequence } from '../db/schema';
import { cosmosDataContainerComments } from '../db/client';
import type { AppendResult, CommentsStore, ConditionalWriteResult, StoredComment } from './commentsStore';

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
        async listAll(domain, limit) {
            // Rate-limit counters and the comment numbers' sequence share the partition; they have no `path`
            const resources = await queryAll<Record<string, unknown>>(
                domain,
                'SELECT TOP @limit * FROM c WHERE c.domain = @domain AND IS_DEFINED(c.path) ORDER BY c.createdAt DESC',
                [{ name: '@limit', value: limit }]);
            return resources.map(withoutSystemProperties);
        },
        async get(domain, id): Promise<StoredComment | null> {
            const response = await cosmosDataContainerComments().item(id, domain).read<Record<string, unknown>>();
            // The partition's counters, sequence and screenshots are not comments
            if (!response.resource || !response.etag || !isCommentDocument(response.resource))
                return null;
            return { comment: withoutSystemProperties(response.resource), etag: response.etag };
        },
        async create(comment) {
            await cosmosDataContainerComments().items.create<DbComment>(comment);
        },
        async replace(comment, etag): Promise<ConditionalWriteResult> {
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
        async delete(domain, id, etag): Promise<ConditionalWriteResult> {
            try {
                await cosmosDataContainerComments().item(id, domain).delete({
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
        async appendThreadItem(domain, id, item, maxItems, updatedAt): Promise<AppendResult> {
            try {
                // Conditional patch: atomic, so concurrent replies never overwrite each other
                await cosmosDataContainerComments().item(id, domain).patch<DbComment>({
                    condition: `FROM c WHERE ARRAY_LENGTH(c.thread.items) < ${maxItems}`,
                    operations: [
                        { op: 'add', path: '/thread/items/-', value: item },
                        { op: 'set', path: '/updatedAt', value: updatedAt }
                    ]
                });
                return 'ok';
            } catch (error) {
                const code = errorCode(error);
                if (code === 412)
                    return 'full';
                if (code === 404)
                    return 'not_found';
                throw error;
            }
        },
        async createScreenshot(screenshot) {
            await cosmosDataContainerComments().items.create<DbScreenshot>(screenshot);
        },
        async getScreenshot(domain, commentId) {
            try {
                const { resource } = await cosmosDataContainerComments().item(screenshotDocumentId(commentId), domain).read<Record<string, unknown>>();
                return resource?.type === 'screenshot'
                    ? withoutSystemProperties(resource) as unknown as DbScreenshot
                    : null;
            } catch (error) {
                if (errorCode(error) === 404)
                    return null;
                throw error;
            }
        },
        async deleteScreenshot(domain, commentId) {
            try {
                await cosmosDataContainerComments().item(screenshotDocumentId(commentId), domain).delete();
            } catch (error) {
                if (errorCode(error) !== 404)
                    throw error;
            }
        },
        async nextCommentNumber(domain) {
            const container = cosmosDataContainerComments();
            const id = commentSequenceId;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const { resource } = await container.item(id, domain).patch<DbSequence>({
                        operations: [{ op: 'incr', path: '/count', value: 1 }]
                    });
                    if (typeof resource?.count === 'number')
                        return resource.count;
                    throw new Error(`Sequence ${id} has no count`);
                } catch (error) {
                    if (errorCode(error) !== 404)
                        throw error;
                }

                // The domain's first number (409 = created concurrently, increment again). A sequence
                // that expired (`comments-preview` has a default ttl) continues after the highest stored.
                const [highest] = await queryAll<number | undefined>(
                    domain,
                    'SELECT VALUE MAX(c.number) FROM c WHERE c.domain = @domain AND IS_NUMBER(c.number)',
                    []);
                const first = (typeof highest === 'number' ? highest : 0) + 1;
                try {
                    await container.items.create<DbSequence>({ id, domain, type: 'sequence', count: first });
                    return first;
                } catch (error) {
                    if (errorCode(error) !== 409)
                        throw error;
                }
            }

            throw new Error(`Sequence ${id} could not be updated`);
        },
        async incrementCounter(domain, id, limit, ttlSeconds) {
            const container = cosmosDataContainerComments();
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await container.item(id, domain).patch<DbCounter>({
                        condition: `FROM c WHERE c.count < ${limit}`,
                        operations: [{ op: 'incr', path: '/count', value: 1 }]
                    });
                    return true;
                } catch (error) {
                    const code = errorCode(error);
                    if (code === 412)
                        return false;
                    if (code !== 404)
                        throw error;
                }

                // First write in this window: create the counter (409 = created concurrently, patch again)
                try {
                    await container.items.create<DbCounter>({ id, domain, type: 'counter', count: 1, ttl: ttlSeconds });
                    return limit > 0;
                } catch (error) {
                    if (errorCode(error) !== 409)
                        throw error;
                }
            }

            throw new Error(`Counter ${id} could not be updated`);
        }
    };
}
