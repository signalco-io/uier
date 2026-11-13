import { archiveSql } from './archiveFilter';
import { getScreenshotBlobStore, storeScreenshotBytes, type ScreenshotBlobStore } from '../screenshots/blobStore';
import { originSql } from './originFilter';
import { authorSql } from './authorFilter';
import { visibilitySql } from './visibilityFilter';
import { commentPageCursorSql, completeCommentPage } from './commentPage';
import { withThreadActivity } from '../comments/activity';
import { withNotificationEvent } from '../notifications/events';
import type { Container, DeleteOperation, OperationInput, SqlParameter } from '@azure/cosmos';
import { commentSequenceId, isCommentDocument, screenshotDocumentId, syncTombstoneId, type DbComment, type DbCommentActivity, type DbCounter, type DbScreenshot, type DbSequence, type DbSubmission, type DbSyncTombstone, type DbRecordingUpload } from '../db/schema';
import { cosmosDataContainerComments } from '../db/client';
import { cosmosMeasurement, cosmosPoint, cosmosQueryAll } from '../db/diagnostics';
import { syncPendingPageLimit, type AppendResult, type CommentsStore, type ConditionalWriteResult, type StoredComment } from './commentsStore';
import { candidateBudget, commentCandidateProjectionFor, CommentQueryBudgetError, normalizeCandidate, throwIfQueryAborted, validateCandidatePredicate, type CommentQueryCandidate } from './commentQuerySource';
import { withCommentQueryMetadata } from './queryMetadata';

function errorCode(error: unknown): number | string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: number | string }).code
        : typeof error === 'object' && error !== null && 'cause' in error ? errorCode(error.cause) : undefined;
}

/** Canonical reads omit Cosmos system properties and internal query optimization fields. */
function withoutSystemProperties<T = DbComment>(resource: Record<string, unknown>): T {
    return Object.fromEntries(Object.entries(resource).filter(([key]) => !key.startsWith('_') && key !== 'queryMetadata')) as T;
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

export function createCosmosCommentsStore(getContainer: () => Container = cosmosDataContainerComments, getBlobs: () => ScreenshotBlobStore = getScreenshotBlobStore): CommentsStore {
    async function queryAll<T>(operation: string, domain: string, query: string, parameters: SqlParameter[]) {
        const resources = await cosmosQueryAll(getContainer().items.query<T>({
            query,
            parameters: [{ name: '@domain', value: domain }, ...parameters]
        }, { partitionKey: domain }), { operation: `comments.${operation}`, container: getContainer().id, partition: 'single' });
        return resources;
    }
    const store: CommentsStore = {
        async queryCandidates(domain, options = {}) {
            validateCandidatePredicate(options.predicate);
            const budget = candidateBudget(options);
            throwIfQueryAborted(options.signal);
            const visibility = visibilitySql(options.visibility);
            const origin = originSql(options.origin);
            const author = authorSql(options.authorId);
            const container = getContainer();
            const deadline = AbortSignal.timeout(budget.durationMs);
            const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
            // Scope and visibility are mandatory WHERE terms, ahead of any optional query expression.
            // There is no TOP: a resource budget rejects the entire operation rather than returning
            // a recent window that could falsely appear to be the complete filtered result.
            const iterator = container.items.query<CommentQueryCandidate>({
                query: `SELECT ${commentCandidateProjectionFor(options.includeText !== false)} FROM c WHERE c.domain = @domain AND IS_STRING(c.path)`
                    + visibility.clause + origin.clause + author.clause + archiveSql(options.archive)
                    + (options.predicate ? ` AND (${options.predicate.clause})` : ''),
                parameters: [{ name: '@domain', value: domain }, ...visibility.parameters, ...origin.parameters, ...author.parameters,
                    ...(options.predicate?.parameters ?? [])]
            }, { partitionKey: domain, maxItemCount: 100, abortSignal: signal });
            const measurement = cosmosMeasurement({ operation: 'comments.query-candidates', container: container.id, partition: 'single' });
            const start = performance.now();
            const candidates: CommentQueryCandidate[] = [];
            let bytes = 0, requestCharge = 0;
            const checkBudget = () => {
                throwIfQueryAborted(options.signal);
                if (candidates.length > budget.candidates || bytes > budget.bytes || requestCharge > budget.requestCharge
                    || performance.now() - start > budget.durationMs) throw new CommentQueryBudgetError();
            };
            try {
                // Empty pages can still carry continuation. Only the SDK decides when the query ends.
                while (iterator.hasMoreResults()) {
                    checkBudget();
                    const response = await iterator.fetchNext();
                    measurement.add(response, response.resources?.length ?? 0, true);
                    requestCharge += Number(response.requestCharge ?? 0);
                    for (const row of response.resources ?? []) {
                        const candidate = normalizeCandidate(row);
                        bytes += Buffer.byteLength(JSON.stringify(candidate));
                        candidates.push(candidate);
                        checkBudget();
                    }
                    checkBudget();
                }
                measurement.finish();
                return candidates;
            } catch (error) {
                measurement.add(error, 0);
                measurement.finish(true);
                throwIfQueryAborted(options.signal);
                if (deadline.aborted) throw new CommentQueryBudgetError();
                throw error;
            }
        },
        async listRealtime(domain) {
            return queryAll('realtime', domain,
                'SELECT c.id, c.domain, c.path, c.private, c.authorId, c._etag AS revision FROM c WHERE c.domain = @domain AND IS_STRING(c.path)', []);
        },
        async listSyncPending(options = {}) {
            // No production outbox predates syncKey. Audit missing keys explicitly on adoption;
            // don't use a non-indexed fallback expression that requires fetching the full queue.
            const parameters: SqlParameter[] = [{ name: '@limit', value: syncPendingPageLimit(options) }];
            if (options.after) parameters.push({ name: '@after', value: options.after });
            const resources = await cosmosQueryAll(getContainer().items.query<Record<string, unknown>>({
                query: "SELECT TOP @limit * FROM c WHERE c.syncPending = true AND IS_DEFINED(c.projectId) AND IS_STRING(c.syncKey) AND (IS_DEFINED(c.path) OR c.type = 'tombstone')"
                    + (options.after ? ' AND c.syncKey > @after' : '') + ' ORDER BY c.syncKey ASC',
                parameters
            }), { operation: 'comments.sync-pending', container: getContainer().id, partition: 'cross' });
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
            const resources = await cosmosQueryAll(getContainer().items.query<Record<string, unknown>>({
                query: 'SELECT * FROM c WHERE c.notificationPending = true AND IS_DEFINED(c.projectId) AND IS_DEFINED(c.path)'
            }), { operation: 'comments.notification-pending', container: getContainer().id, partition: 'cross' });
            return resources.map(resource => withoutSystemProperties<DbComment>(resource));
        },
        async list(domain, path, limit, originFilter, authorId, archive) {
            const filter = originSql(originFilter);
            const author = authorSql(authorId);
            const resources = await queryAll<Record<string, unknown>>(
                'list', domain,
                `SELECT TOP @limit * FROM c WHERE c.domain = @domain AND ${pathFilter}${filter.clause}${author.clause}${archiveSql(archive)} ORDER BY c.createdAt DESC`,
                [...filter.parameters, ...author.parameters, ...pathParameters(path), { name: '@limit', value: limit }]);
            return resources.map(resource => withoutSystemProperties<DbComment>(resource));
        },
        async listAll(domain, limit, originFilter, authorId, archive) {
            const filter = originSql(originFilter);
            const author = authorSql(authorId);
            // Rate-limit counters and the comment numbers' sequence share the partition; they have no `path`
            const resources = await queryAll<Record<string, unknown>>(
                'listAll', domain,
                `SELECT TOP @limit * FROM c WHERE c.domain = @domain AND IS_DEFINED(c.path)${filter.clause}${author.clause}${archiveSql(archive)} ORDER BY c.createdAt DESC`,
                [...filter.parameters, ...author.parameters, { name: '@limit', value: limit }]);
            return resources.map(resource => withoutSystemProperties<DbComment>(resource));
        },
        async listPage(domain, { limit, before, path, originFilter, authorId, archive, visibility }) {
            const origin = originSql(originFilter);
            const author = authorSql(authorId);
            const visible = visibilitySql(visibility);
            const cursor = commentPageCursorSql(before);
            const where = `c.domain = @domain AND IS_STRING(c.path) AND IS_STRING(c.createdAt)${path === undefined ? '' : ` AND ${pathFilter}`}`
                + `${visible.clause}${origin.clause}${author.clause}${archiveSql(archive)}${cursor.clause}`;
            const parameters = [...visible.parameters, ...origin.parameters, ...author.parameters, ...cursor.parameters,
                ...(path === undefined ? [] : pathParameters(path)), { name: '@limit', value: Math.max(1, Math.min(1000, Math.trunc(limit))) }];
            const read = async (operation: string, query: string, extra: SqlParameter[] = []) =>
                (await queryAll<Record<string, unknown>>(operation, domain, query, [...parameters, ...extra])).map(resource => withoutSystemProperties<DbComment>(resource));
            const first = await read('listPage', `SELECT TOP @limit * FROM c WHERE ${where} ORDER BY c.createdAt DESC`);
            return completeCommentPage(first, limit, createdAt =>
                read('listPageTies', `SELECT TOP @limit * FROM c WHERE ${where} AND c.createdAt = @tieAt ORDER BY c.id DESC`, [{ name: '@tieAt', value: createdAt }]));
        },
        async listChangedSince(domain, since, limit) {
            // `_ts` is the server's write time in seconds; one second earlier never skips a write.
            const resources = await queryAll<Record<string, unknown> & { _ts: number }>(
                'changedSince', domain,
                'SELECT TOP @limit * FROM c WHERE c.domain = @domain AND IS_STRING(c.path) AND c._ts >= @since ORDER BY c._ts ASC',
                [{ name: '@since', value: Math.floor(since / 1000) }, { name: '@limit', value: Math.max(1, Math.min(1000, Math.trunc(limit))) }]);
            return resources.filter(resource => isCommentDocument(resource))
                .map(resource => ({ comment: withoutSystemProperties<DbComment>(resource), changedAt: resource._ts * 1000 }));
        },
        async get(domain, id): Promise<StoredComment | null> {
            try {
                const response = await cosmosPoint(() => getContainer().item(id, domain).read<Record<string, unknown>>(),
                    { operation: 'comments.get', container: getContainer().id, partition: 'single' });
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
        async commitSubmission(receipt, comment, etag, screenshot, recording) {
            const image = screenshot ? await storeScreenshotBytes(screenshot, getBlobs()) : undefined;
            const prepared = withCommentQueryMetadata(comment);
            const operations: OperationInput[] = [
                { operationType: 'Create', resourceBody: receipt },
                etag
                    ? { operationType: 'Replace', id: comment.id, resourceBody: prepared, ifMatch: etag }
                    : { operationType: 'Create', resourceBody: prepared },
                ...(image ? [{ operationType: 'Create' as const, resourceBody: image }] : []),
                ...(recording ? [{ operationType: 'Replace' as const, id: recording.doc.id, resourceBody: recording.doc, ifMatch: recording.etag }] : [])
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
        async getRecordingUpload(domain, id) {
            try {
                const { resource, etag } = await getContainer().item(id, domain).read<DbRecordingUpload>();
                return resource?.type === 'recording-upload' && etag ? { doc: withoutSystemProperties<DbRecordingUpload>(resource as unknown as Record<string, unknown>), etag } : null;
            } catch (error) { if (errorCode(error) === 404) return null; throw error; }
        },
        async createRecordingUpload(doc) { await getContainer().items.create(doc); },
        async replaceRecordingUpload(doc, etag) {
            try {
                await getContainer().item(doc.id, doc.domain).replace(doc, { accessCondition: { type: 'IfMatch', condition: etag } });
                return 'ok';
            } catch (error) { if (errorCode(error) === 404) return 'not_found'; if (errorCode(error) === 412) return 'conflict'; throw error; }
        },
        async deleteRecordingUpload(domain, id, etag) {
            try {
                await getContainer().item(id, domain).delete({ accessCondition: { type: 'IfMatch', condition: etag } });
                return 'ok';
            } catch (error) { if (errorCode(error) === 404) return 'not_found'; if (errorCode(error) === 412) return 'conflict'; throw error; }
        },
        async listRecordingUploads(continuation) {
            const page = await cosmosPoint(() => getContainer().items.query<{ domain: string; id: string }>({
                query: "SELECT c.domain, c.id FROM c WHERE c.type = 'recording-upload'"
            }, { maxItemCount: 100, continuationToken: continuation }).fetchNext(),
            { operation: 'comments.recording-metadata', container: getContainer().id, partition: 'cross' });
            return { items: page.resources, continuation: page.continuationToken || undefined };
        },
        async create(comment) {
            await getContainer().items.create<DbComment>(withCommentQueryMetadata(comment));
        },
        async replace(comment, etag): Promise<ConditionalWriteResult> {
            try {
                await getContainer().item(comment.id, comment.domain).replace<DbComment>(withCommentQueryMetadata(comment), {
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
            return await queryAll<DbCommentActivity>('activity', domain,
                `SELECT c.id, c.domain, c.path, c.origin, c.private, c.authorId, c.resolved, c.inProgress, c.archivedAt, {"outcome": c.verification.outcome} AS verification, c.createdAt, c.activity,
                    IIF(IS_DEFINED(c.activity), {"items": []}, {"items": ARRAY(SELECT VALUE {"authorId": i.authorId, "deletedAt": i.deletedAt} FROM i IN c.thread.items)}) AS thread
                 FROM c WHERE c.domain = @domain AND IS_STRING(c.path)`, []);
        },
        async latestActivity(domain, visibleTo) {
            // One scalar over indexed fields (automatic /* indexing), however many threads the partition holds
            const visibility = visibilitySql(visibleTo);
            const [latest] = await queryAll<string | undefined>('latest-activity', domain,
                `SELECT VALUE MAX(c.updatedAt) FROM c WHERE c.domain = @domain AND IS_STRING(c.path) AND IS_STRING(c.updatedAt)${visibility.clause}`,
                visibility.parameters);
            return typeof latest === 'string' ? latest : undefined;
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
                        ...withNotificationEvent(withThreadActivity(current, item.authorId ?? 'legacy', Boolean(item.agent)), item.authorId ?? 'legacy', 'reply', updatedAt),
                        thread: { ...current.thread, items: [...current.thread.items, item] }, updatedAt
                    };
                    await target.replace(withCommentQueryMetadata(updated), { accessCondition: { type: 'IfMatch', condition: stored.etag } });
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
        async listScreenshotsBefore(before, continuation) {
            const page = await cosmosPoint(() => getContainer().items.query<{ domain: string; commentId: string; itemId?: string; _etag: string }>({
                query: "SELECT c.domain, c.commentId, c.itemId, c._etag FROM c WHERE c.type = 'screenshot' AND IS_STRING(c.data) AND c.createdAt < @before",
                parameters: [{ name: '@before', value: before }]
            }, { maxItemCount: 100, continuationToken: continuation }).fetchNext(),
                { operation: 'comments.screenshot-metadata', container: getContainer().id, partition: 'cross' });
            return { items: page.resources.map(image => ({ domain: image.domain, commentId: image.commentId, itemId: image.itemId, etag: image._etag })),
                continuation: page.continuationToken || undefined };
        },
        async createScreenshot(screenshot) {
            await getContainer().items.create<DbScreenshot>(await storeScreenshotBytes(screenshot, getBlobs()));
        },
        async replaceScreenshot(comment, etag, screenshot) {
            const previous = await store.getScreenshot(comment.domain, comment.id);
            const image = await storeScreenshotBytes(screenshot, getBlobs());
            // Only references participate in Cosmos; uncommitted immutable blobs are swept later.
            try {
                const response = await getContainer().items.batch([
                    { operationType: 'Replace', id: comment.id, resourceBody: withCommentQueryMetadata(comment), ifMatch: etag },
                    { operationType: 'Upsert', resourceBody: image }
                ], comment.domain);
                const codes = [response.code, ...(response.result ?? []).map(result => result.statusCode)]
                    .filter((code): code is number => typeof code === 'number');
                if (codes.includes(412)) return 'conflict';
                if (codes.includes(404)) return 'not_found';
                if (response.result?.length !== 2 || codes.some(code => code < 200 || code >= 300))
                    throw new Error('Screenshot replacement transaction failed.');
                if (previous?.blob && previous.blob !== image.blob) {
                    await getBlobs().delete(previous.blob).catch(() => console.error('[screenshots] Previous blob cleanup needs retry'));
                }
                return 'ok';
            } catch (error) {
                // The SDK may wrap a top-level failure in Error.cause.
                const code = errorCode(error) ?? (error instanceof Error ? errorCode(error.cause) : undefined);
                if (code === 412) return 'conflict';
                if (code === 404) return 'not_found';
                throw error;
            }
        },
        async getScreenshot(domain, commentId, itemId) {
            try {
                const { resource } = await getContainer().item(screenshotDocumentId(commentId, itemId), domain).read<Record<string, unknown>>();
                return resource?.type === 'screenshot'
                    ? withoutSystemProperties(resource) as unknown as DbScreenshot
                    : null;
            } catch (error) {
                if (errorCode(error) === 404)
                    return null;
                throw error;
            }
        },
        async deleteScreenshot(domain, commentId, etag, itemId) {
            const target = getContainer().item(screenshotDocumentId(commentId, itemId), domain);
            try {
                const current = await target.read<DbScreenshot>();
                if (!current.resource || !current.etag || (etag && etag !== current.etag)) return;
                await target.delete({ accessCondition: { type: 'IfMatch', condition: current.etag } });
                // A failed delete is safe: no pointer remains and the Blob sweep retries it.
                if (current.resource.blob) await getBlobs().delete(current.resource.blob);
            } catch (error) {
                if (errorCode(error) !== 404 && errorCode(error) !== 412) throw error;
            }
        },
        async migrateScreenshots() {
            const resources = await cosmosQueryAll(getContainer().items.query<DbScreenshot & { _etag: string; _ts: number }>({
                query: "SELECT TOP 20 * FROM c WHERE c.type = 'screenshot' AND IS_STRING(c.data)"
            }), { operation: 'comments.legacy-images', container: getContainer().id, partition: 'cross' });
            const { resource: settings } = await getContainer().read();
            let migrated = 0, failed = 0;
            for (const legacy of resources) {
                try {
                    const metadata = withoutSystemProperties<DbScreenshot>(legacy as unknown as Record<string, unknown>);
                    // Replacing a Cosmos item resets _ts; retain the original expiry.
                    const lifetime = metadata.ttl ?? settings?.defaultTtl;
                    if (lifetime && lifetime > 0) metadata.ttl = Math.max(1, legacy._ts + lifetime - Math.floor(Date.now() / 1000));
                    const image = await storeScreenshotBytes(metadata, getBlobs());
                    await getContainer().item(legacy.id, legacy.domain).replace(image, { accessCondition: { type: 'IfMatch', condition: legacy._etag } });
                    migrated++;
                } catch (error) {
                    if (![404, 412].includes(Number(errorCode(error)))) { failed++; console.error('[screenshots] Legacy migration needs retry'); }
                }
            }
            return { migrated, failed };
        },
        async sweepScreenshotBlobs(now) {
            // Persist progress: avoid reading every live image's owner on every five-minute tick.
            const stateItem = getContainer().item('$blob_sweep', '$screenshots');
            let state: { continuation?: string; nextAt?: number } | undefined;
            try { state = (await stateItem.read<NonNullable<typeof state>>()).resource; }
            catch (error) { if (errorCode(error) !== 404) throw error; }
            if ((state?.nextAt ?? 0) > now) return { removed: 0, failed: 0 };
            const page = await getBlobs().listBefore(new Date(now - 60 * 60_000), state?.continuation);
            let removed = 0, failed = 0;
            for (const blob of page.items) {
                try {
                    const owner = await store.get(blob.domain, blob.commentId);
                    const target = getContainer().item(screenshotDocumentId(blob.commentId, blob.itemId), blob.domain);
                    let image: { resource?: DbScreenshot; etag?: string } = {};
                    try { image = await target.read<DbScreenshot>(); }
                    catch (error) { if (errorCode(error) !== 404) throw error; }
                    const live = blob.itemId ? owner?.comment.thread.items.some(item => item.id === blob.itemId && !item.deletedAt && item.screenshot) : owner?.comment.screenshot;
                    if (!live || image.resource?.blob !== blob.name) {
                        await getBlobs().delete(blob.name, blob.etag);
                        if (!live && image.resource?.blob === blob.name && image.etag)
                            await store.deleteScreenshot(blob.domain, blob.commentId, image.etag, blob.itemId);
                        removed++;
                    }
                } catch { failed++; console.error('[screenshots] Blob cleanup needs retry'); }
            }
            if (!failed) await getContainer().items.upsert({ id: '$blob_sweep', domain: '$screenshots', type: 'blob-sweep', ttl: -1,
                ...(page.continuation ? { continuation: page.continuation } : { nextAt: now + 60 * 60_000 }) });
            return { removed, failed };
        },
        async deleteSequence(domain) {
            try {
                await getContainer().item(commentSequenceId, domain).delete();
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
                    'sequence-floor', domain,
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
        async getCounter(domain, id) {
            try {
                const { resource } = await getContainer().item(id, domain).read<DbCounter>();
                return resource?.type === 'counter' ? resource.count : 0;
            } catch (error) {
                if (errorCode(error) === 404) return 0;
                throw error;
            }
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
    return store;
}
