import { withThreadActivity } from '../comments/activity';
import { withNotificationEvent } from '../notifications/events';
import type { OperationInput, SqlParameter } from '@azure/cosmos';
import { commentSequenceId, isCommentDocument, screenshotDocumentId, type DbComment, type DbCommentActivity, type DbCounter, type DbScreenshot, type DbSequence, type DbSubmission } from '../db/schema';
import { cosmosDataContainerComments } from '../db/client';
import type { AppendResult, CommentsStore, ConditionalWriteResult, StoredComment } from './commentsStore';

function errorCode(error: unknown): number | string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: number | string }).code
        : typeof error === 'object' && error !== null && 'cause' in error ? errorCode(error.cause) : undefined;
}

/** Removes Cosmos system properties (`_rid`, `_self`, `_etag`, `_attachments`, `_ts`) */
function withoutSystemProperties(resource: Record<string, unknown>): DbComment {
    return Object.fromEntries(Object.entries(resource).filter(([key]) => !key.startsWith('_'))) as DbComment;
}

// Matches the normalized path and old documents whose path still contains the query string (e.g. `/x?review=true`)
const pathFilter = '(c.path = @path OR (@legacyPath = true AND (NOT IS_DEFINED(c.pageStateVersion) OR c.pageStateVersion != 1) AND STARTSWITH(c.path, @pathWithQuery)))';

function pathParameters(path: string): SqlParameter[] {
    return [
        { name: '@path', value: path },
        { name: '@pathWithQuery', value: `${path}?` },
        { name: '@legacyPath', value: !/[?#]/.test(path) }
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
        async listNotificationPending() {
            const { resources } = await cosmosDataContainerComments().items.query<Record<string, unknown>>({
                query: 'SELECT * FROM c WHERE c.notificationPending = true AND IS_DEFINED(c.projectId) AND IS_DEFINED(c.path)'
            }).fetchAll();
            return resources.map(withoutSystemProperties);
        },
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
            try {
                const response = await cosmosDataContainerComments().item(id, domain).read<Record<string, unknown>>();
                // The partition's counters, sequence and screenshots are not comments
                if (!response.resource || !response.etag || !isCommentDocument(response.resource))
                    return null;
                return { comment: withoutSystemProperties(response.resource), etag: response.etag };
            } catch (error) {
                if (errorCode(error) === 404)
                    return null;
                throw error;
            }
        },
        async getSubmission(domain, id) {
            try {
                const { resource } = await cosmosDataContainerComments().item(id, domain).read<DbSubmission>();
                return resource?.type === 'submission' ? resource : null;
            } catch (error) {
                if (errorCode(error) === 404) return null;
                throw error;
            }
        },
        async commitSubmission(receipt, comment, etag, screenshot) {
            const operations: OperationInput[] = [
                { operationType: 'Create', resourceBody: receipt },
                etag
                    ? { operationType: 'Replace', id: comment.id, resourceBody: comment, ifMatch: etag }
                    : { operationType: 'Create', resourceBody: comment },
                ...(screenshot ? [{ operationType: 'Create' as const, resourceBody: screenshot }] : [])
            ];
            try {
                const response = await cosmosDataContainerComments().items.batch(operations, receipt.domain);
                const failed = response.result?.find(result => result.statusCode >= 400 && result.statusCode !== 424)?.statusCode;
                const code = failed ?? response.code;
                if (code === 409 || code === 412 || code === 404) return 'conflict';
                if (!code || code < 200 || code >= 300 || response.result?.some(result => result.statusCode >= 400))
                    throw new Error(`Submission transaction failed (${code})`);
                return 'ok';
            } catch (error) {
                // The SDK wraps transaction failures in Error.cause.
                if ([404, 409, 412].includes(Number(errorCode(error)))) return 'conflict';
                throw error;
            }
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
        async listActivity(domain) {
            // No TOP: badge counts and unread selection must include threads outside the text list.
            // Modern records need only the compact activity map; legacy records need item authors.
            return await queryAll<DbCommentActivity>(domain,
                `SELECT c.id, c.domain, c.private, c.authorId, c.resolved, c.createdAt, c.activity,
                    IIF(IS_DEFINED(c.activity), {"items": []}, {"items": ARRAY(SELECT VALUE {"authorId": i.authorId, "deletedAt": i.deletedAt} FROM i IN c.thread.items)}) AS thread
                 FROM c WHERE c.domain = @domain AND IS_STRING(c.path)`, []);
        },
        async appendThreadItem(domain, id, item, maxItems, updatedAt): Promise<AppendResult> {
            // Item and activity cursor share one etag-protected write. A patch cannot derive
            // a cursor for legacy threads or record the actor's latest sequence atomically.
            const target = cosmosDataContainerComments().item(id, domain);
            for (let attempt = 0; attempt < 16; attempt++) {
                try {
                    const stored = await target.read<DbComment>();
                    if (!stored.resource || !stored.etag) return 'not_found';
                    const current = withoutSystemProperties(stored.resource as unknown as Record<string, unknown>);
                    if (current.thread.items.length >= maxItems) return 'full';
                    const updated = {
                        ...withNotificationEvent(withThreadActivity(current, item.authorId ?? 'legacy'), item.authorId ?? 'legacy', 'reply', updatedAt),
                        thread: { ...current.thread, items: [...current.thread.items, item] }, updatedAt
                    };
                    await target.replace(updated, { accessCondition: { type: 'IfMatch', condition: stored.etag } });
                    return 'ok';
                } catch (error) {
                    const code = errorCode(error);
                    if (code === 404) return 'not_found';
                    if (code !== 412) throw error;
                    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 25));
                }
            }
            throw new Error(`Comment ${id} changed too often while replying`);
        },
        async createScreenshot(screenshot) {
            await cosmosDataContainerComments().items.create<DbScreenshot>(screenshot);
        },
        async replaceScreenshot(comment, etag, screenshot) {
            // One partition transaction: a failed metadata write never destroys the old image.
            try {
                const response = await cosmosDataContainerComments().items.batch([
                    { operationType: 'Replace', id: comment.id, resourceBody: comment, ifMatch: etag },
                    { operationType: 'Upsert', resourceBody: screenshot }
                ], comment.domain);
                const codes = [response.code, ...(response.result ?? []).map(result => result.statusCode)]
                    .filter((code): code is number => typeof code === 'number');
                if (codes.includes(412)) return 'conflict';
                if (codes.includes(404)) return 'not_found';
                if (response.result?.length !== 2 || codes.some(code => code < 200 || code >= 300))
                    throw new Error('Screenshot replacement transaction failed.');
                return 'ok';
            } catch (error) {
                // The SDK may wrap a top-level failure in Error.cause.
                const code = errorCode(error) ?? (error instanceof Error ? errorCode(error.cause) : undefined);
                if (code === 412) return 'conflict';
                if (code === 404) return 'not_found';
                throw error;
            }
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
