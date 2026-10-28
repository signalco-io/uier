import { originSql } from './originFilter';
import { withThreadActivity } from '../comments/activity';
import { withNotificationEvent } from '../notifications/events';
import type { Container, DeleteOperation, OperationInput, SqlParameter } from '@azure/cosmos';
import { commentSequenceId, isCommentDocument, screenshotDocumentId, syncTombstoneId, type DbComment, type DbCommentActivity, type DbCounter, type DbScreenshot, type DbSequence, type DbSubmission, type DbSyncTombstone } from '../db/schema';
import { cosmosDataContainerComments } from '../db/client';
import { syncPendingPageLimit, type AppendResult, type CommentsStore, type ConditionalWriteResult, type StoredComment } from './commentsStore';

function errorCode(error: unknown): number | string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: number | string }).code
        : typeof error === 'object' && error !== null && 'cause' in error ? errorCode(error.cause) : undefined;
}

/** Removes Cosmos system properties (`_rid`, `_self`, `_etag`, `_attachments`, `_ts`) */
function withoutSystemProperties<T = DbComment>(resource: Record<string, unknown>): T {
    return Object.fromEntries(Object.entries(resource).filter(([key]) => !key.startsWith('_'))) as T;
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

export function createCosmosCommentsStore(getContainer: () => Container = cosmosDataContainerComments): CommentsStore {
    async function queryAll<T>(domain: string, query: string, parameters: SqlParameter[]) {
        const { resources } = await getContainer().items.query<T>({
            query,
            parameters: [{ name: '@domain', value: domain }, ...parameters]
        }, { partitionKey: domain }).fetchAll();
        return resources;
    }
    return {
        async listSyncPending(options = {}) {
            // No production outbox predates syncKey. Audit missing keys explicitly on adoption;
            // don't use a non-indexed fallback expression that requires fetching the full queue.
            const parameters: SqlParameter[] = [{ name: '@limit', value: syncPendingPageLimit(options) }];
            if (options.after) parameters.push({ name: '@after', value: options.after });
            const { resources } = await getContainer().items.query<Record<string, unknown>>({
                query: "SELECT TOP @limit * FROM c WHERE c.syncPending = true AND IS_DEFINED(c.projectId) AND IS_STRING(c.syncKey) AND (IS_DEFINED(c.path) OR c.type = 'tombstone')"
                    + (options.after ? ' AND c.syncKey > @after' : '') + ' ORDER BY c.syncKey ASC',
                parameters
            }).fetchAll();
            return resources.map(resource => withoutSystemProperties<DbComment | DbSyncTombstone>(resource));
        },
        async deleteWithTombstone(domain, id, etag, tombstone) {
            if (tombstone.domain !== domain || tombstone.commentId !== id || tombstone.id !== syncTombstoneId(id))
                throw new Error('Deletion intent does not match its comment.');
            try {
                // The SDK's DeleteOperationInput omits this field, but its DeleteOperation type
                // includes it and transactional batch forwards the complete operation to Cosmos.
                const deletion: DeleteOperation = { operationType: 'Delete', id, ifMatch: etag };
                const response = await getContainer().items.batch([
                    deletion,
                    { operationType: 'Upsert', resourceBody: tombstone }
                ], domain);
                const failed = response.result?.find(result => result.statusCode >= 400 && result.statusCode !== 424)?.statusCode;
                const code = failed ?? response.code;
                if (code === 412) return 'conflict';
                if (code === 404) return 'not_found';
                if (response.result?.length !== 2 || !code || code < 200 || code >= 300 || response.result.some(result => result.statusCode >= 400))
                    throw new Error('Comment deletion transaction failed.');
                return 'ok';
            } catch (error) {
                const code = Number(errorCode(error));
                if (code === 412) return 'conflict';
                if (code === 404) return 'not_found';
                throw error;
            }
        },
        async deleteTombstone(domain, commentId, expectedVersion) {
            const target = getContainer().item(syncTombstoneId(commentId), domain);
            try {
                const response = await target.read<DbSyncTombstone>();
                if (response.resource?.type !== 'tombstone' || !response.etag) return 'not_found';
                if (expectedVersion !== undefined && response.resource.syncVersion !== expectedVersion) return 'conflict';
                await target.delete({ accessCondition: { type: 'IfMatch', condition: response.etag } });
                return 'ok';
            } catch (error) {
                const code = Number(errorCode(error));
                if (code === 412) return 'conflict';
                if (code === 404) return 'not_found';
                throw error;
            }
        },
        async listNotificationPending() {
            const { resources } = await getContainer().items.query<Record<string, unknown>>({
                query: 'SELECT * FROM c WHERE c.notificationPending = true AND IS_DEFINED(c.projectId) AND IS_DEFINED(c.path)'
            }).fetchAll();
            return resources.map(resource => withoutSystemProperties<DbComment>(resource));
        },
        async list(domain, path, limit, originFilter) {
            const filter = originSql(originFilter);
            const resources = await queryAll<Record<string, unknown>>(
                domain,
                `SELECT TOP @limit * FROM c WHERE c.domain = @domain AND ${pathFilter}${filter.clause} ORDER BY c.createdAt DESC`,
                [...filter.parameters, ...pathParameters(path), { name: '@limit', value: limit }]);
            return resources.map(resource => withoutSystemProperties<DbComment>(resource));
        },
        async listAll(domain, limit, originFilter) {
            const filter = originSql(originFilter);
            // Rate-limit counters and the comment numbers' sequence share the partition; they have no `path`
            const resources = await queryAll<Record<string, unknown>>(
                domain,
                `SELECT TOP @limit * FROM c WHERE c.domain = @domain AND IS_DEFINED(c.path)${filter.clause} ORDER BY c.createdAt DESC`,
                [...filter.parameters, { name: '@limit', value: limit }]);
            return resources.map(resource => withoutSystemProperties<DbComment>(resource));
        },
        async get(domain, id): Promise<StoredComment | null> {
            try {
                const response = await getContainer().item(id, domain).read<Record<string, unknown>>();
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
                const { resource } = await getContainer().item(id, domain).read<DbSubmission>();
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
                const response = await getContainer().items.batch(operations, receipt.domain);
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
            await getContainer().items.create<DbComment>(comment);
        },
        async replace(comment, etag): Promise<ConditionalWriteResult> {
            try {
                await getContainer().item(comment.id, comment.domain).replace<DbComment>(comment, {
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
                await getContainer().item(id, domain).delete({
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
                `SELECT c.id, c.domain, c.path, c.origin, c.private, c.authorId, c.resolved, c.createdAt, c.activity,
                    IIF(IS_DEFINED(c.activity), {"items": []}, {"items": ARRAY(SELECT VALUE {"authorId": i.authorId, "deletedAt": i.deletedAt} FROM i IN c.thread.items)}) AS thread
                 FROM c WHERE c.domain = @domain AND IS_STRING(c.path)`, []);
        },
        async appendThreadItem(domain, id, item, maxItems, updatedAt): Promise<AppendResult> {
            // Item and activity cursor share one etag-protected write. A patch cannot derive
            // a cursor for legacy threads or record the actor's latest sequence atomically.
            const target = getContainer().item(id, domain);
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
            await getContainer().items.create<DbScreenshot>(screenshot);
        },
        async replaceScreenshot(comment, etag, screenshot) {
            // One partition transaction: a failed metadata write never destroys the old image.
            try {
                const response = await getContainer().items.batch([
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
                const { resource } = await getContainer().item(screenshotDocumentId(commentId), domain).read<Record<string, unknown>>();
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
                await getContainer().item(screenshotDocumentId(commentId), domain).delete();
            } catch (error) {
                if (errorCode(error) !== 404)
                    throw error;
            }
        },
        async nextCommentNumber(domain) {
            const container = getContainer();
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
            const container = getContainer();
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
