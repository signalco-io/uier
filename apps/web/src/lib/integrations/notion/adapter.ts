import { screenshotBytes } from '../../screenshots/blobStore';
import { createHash } from 'node:crypto';
import { updateDoc } from '../../app/store';
import { getProjectScreenshot } from '../../review/comments';
import { memberActor } from '../../review/actor';
import type { IntegrationAdapter, IntegrationDeliveryContext, IntegrationOperation, IntegrationResult } from '../model';
import { IntegrationControlError } from '../delivery';
import { array, isNotionPageUrl, NotionApiError, notionId, object, pageProperty, richText, sameId, type JsonObject } from './client';
import { isNotionConfigured } from './config';
import { GrantLeaseError, NotionSession, pauseNotion, revokeNotionAdmin, type NotionServices } from './connection';
import type { BlockRecord, BlockSpec, NotionConnection, NotionPageRecord, NotionState } from './model';
import { blockHash, canonicalProperties, emptyNotionProperties, notionBlocks, notionHash, notionProperties, validateNotionMapping } from './page';
import { parseNotionSchema } from './settings';
import { probeNotionConnections } from './probe';

const waitResult = (code: string, delay = 60_000): IntegrationResult => ({ status: 'waiting', code, retryAt: new Date(Date.now() + delay).toISOString() });
const silent = { mode: 'silent' };
const pathId = (id: string) => encodeURIComponent(notionId(id));

/** All network calls go through the shared lease/authority/budget boundary. */
export function createNotionAdapter(services: NotionServices = {}): IntegrationAdapter {
    return { provider: 'notion', isConfigured: isNotionConfigured, maxRunMs: 8 * 60_000, maxCalls: 150,
        maintenance: input => probeNotionConnections(input, services),
        revokeAdmin: (workspaceId, userId) => revokeNotionAdmin(workspaceId, userId, services.store),
        externalLink(connection, ledger) {
            const state = ledger.state as NotionState; const page = state.page;
            return page && !page.trashed && !page.scrubbed && sameId(page.dataSourceId, (connection as NotionConnection).config.dataSourceId)
                && sameId(page.notionWorkspaceId, (connection as NotionConnection).config.notionWorkspaceId) ? page.url || null : null;
        },
        validateExternalLink(url) { return isNotionPageUrl(url.href); },
        async deliver(ctx) {
            const connection = ctx.connection as NotionConnection;
            const session = new NotionSession(connection, services, true);
            let state: NotionState = structuredClone(ctx.ledger.state);
            const persist = async (clearAttempt = false) => {
                if (Buffer.byteLength(JSON.stringify(state)) > 1_400_000) throw new NotionApiError(409, 'cleanup_history_full');
                await ctx.checkpoint(state, { clearAttempt });
            };
            const read = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
                try { return await ctx.read(signal => session.raw(method, path, body, signal)); }
                catch (error) {
                    if (!(error instanceof NotionApiError && error.status === 401 && error.code === 'unauthorized')) throw error;
                    await session.refresh(send => ctx.read(send));
                    return ctx.read(signal => session.raw(method, path, body, signal));
                }
            };
            const write = async (step: string, method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown,
                metadata: JsonObject = {}, repeatable = false): Promise<JsonObject> => {
                const operation: IntegrationOperation = { step, metadata, planHash: notionHash(body ?? { path, method }), repeatable };
                for (let authRetry = 0; authRetry < 2; authRetry++) {
                    try { return await ctx.operation(operation, signal => session.raw(method, path, body, signal)); }
                    catch (error) {
                        if (error instanceof NotionApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
                            // A definitive API rejection did not apply this operation. It is safe to plan again.
                            await persist(true);
                            if (error.status === 401 && error.code === 'unauthorized' && authRetry === 0) { await session.refresh(send => ctx.read(send)); continue; }
                        }
                        throw error;
                    }
                }
                throw new NotionApiError(401, 'needs_reconnect');
            };
            const verifyPage = async (page: NotionPageRecord, allowScrubbed = false) => {
                const grant = await session.grant();
                if (!sameId(page.notionWorkspaceId, grant.notionWorkspaceId)) throw new NotionApiError(403, 'retired_grant_unavailable');
                const actual = await read('GET', `/v1/pages/${pathId(page.id)}`);
                const parent = object(actual.parent);
                const correctParent = sameId(parent.data_source_id, page.dataSourceId)
                    || (page.databaseId !== undefined && sameId(parent.database_id, page.databaseId));
                const uierIds = [page.mapping, ...(page.pastMappings ?? [])].map(mapping => richText(pageProperty(actual, mapping.uierId).rich_text));
                if (actual.object !== 'page' || !sameId(actual.id, page.id) || !correctParent || !sameId(object(actual.created_by).id, page.botId)
                    || (!uierIds.includes(ctx.ledger.threadId) && !(allowScrubbed && (page.scrubbed || page.scrubPending || ctx.ledger.attempt?.step === 'scrub_page') && uierIds.every(id => id === ''))))
                    throw new NotionApiError(409, 'ownership_conflict');
                return actual;
            };
            const children = async (page: NotionPageRecord) => {
                const blocks: JsonObject[] = []; let cursor: string | undefined;
                do {
                    const response = await read('GET', `/v1/blocks/${pathId(page.id)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
                    blocks.push(...array(response.results).map(object).filter(block => !block.in_trash));
                    cursor = response.has_more && typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
                    if (blocks.length > 1000) throw new NotionApiError(409, 'too_many_blocks');
                } while (cursor);
                return blocks;
            };
            const pageById = (id: unknown) => [state.page, ...(state.retired ?? [])].find(page => page && sameId(page.id, id));
            const queryPages = async (dataSourceId: string, mapping: NotionPageRecord['mapping'], botId: string, databaseId?: string) => {
                const found: JsonObject[] = []; let cursor: string | undefined;
                do {
                    const response = await read('POST', `/v1/data_sources/${pathId(dataSourceId)}/query`, { page_size: 100,
                        filter: { property: mapping.uierId, rich_text: { equals: ctx.ledger.threadId } }, ...(cursor ? { start_cursor: cursor } : {}) });
                    for (const raw of array(response.results)) {
                        const page = object(raw); if (page.in_trash) continue;
                        if (page.object !== 'page' || !(sameId(object(page.parent).data_source_id, dataSourceId)
                            || (databaseId !== undefined && sameId(object(page.parent).database_id, databaseId)))
                            || !sameId(object(page.created_by).id, botId) || richText(pageProperty(page, mapping.uierId).rich_text) !== ctx.ledger.threadId)
                            throw new NotionApiError(409, 'ownership_conflict');
                        found.push(page);
                    }
                    if (found.length > 1) throw new NotionApiError(409, 'duplicate_pages');
                    cursor = response.has_more && typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
                } while (cursor);
                return found;
            };
            const recordPage = (actual: JsonObject, metadata: JsonObject): NotionPageRecord => ({ id: notionId(actual.id),
                url: typeof actual.url === 'string' && isNotionPageUrl(actual.url) ? actual.url : '',
                dataSourceId: notionId(metadata.dataSourceId), databaseId: typeof metadata.databaseId === 'string' ? notionId(metadata.databaseId) : undefined,
                notionWorkspaceId: notionId(metadata.notionWorkspaceId), botId: notionId(metadata.botId),
                mapping: metadata.mapping as NotionPageRecord['mapping'], blocks: [],
                propertiesHash: typeof metadata.propertiesHash === 'string' ? metadata.propertiesHash : undefined });
            const adoptCreated = (actual: JsonObject, metadata: JsonObject) => {
                const page = recordPage(actual, metadata);
                if (state.page && !sameId(state.page.id, page.id)) state.retired = [...(state.retired ?? []), state.page];
                state.page = page;
                state.rebuild = true;
            };
            const reconcileAttempt = async (): Promise<IntegrationResult | undefined> => {
                const attempt = ctx.ledger.attempt;
                if (!attempt) return;
                const metadata = object(attempt.metadata);
                if (attempt.step === 'create_page') {
                    const found = await queryPages(notionId(metadata.dataSourceId), metadata.mapping as NotionPageRecord['mapping'], notionId(metadata.botId), typeof metadata.databaseId === 'string' ? metadata.databaseId : undefined);
                    if (!found.length) {
                        state.reconciliationCount = (state.reconciliationCount ?? 0) + 1; await persist();
                        return state.reconciliationCount >= 8 ? { status: 'ambiguous', code: 'create_unconfirmed' } : waitResult('create_unconfirmed');
                    }
                    adoptCreated(found[0]!, metadata); state.reconciliationCount = 0; await persist(true); return;
                }
                if (attempt.step === 'upload_create') {
                    // A lost empty upload allocation contains no image bytes. Abandon it; it expires unattached.
                    state.upload = undefined; await persist(true); return;
                }
                if (attempt.step === 'upload_send') {
                    const upload = state.upload;
                    if (upload && sameId(upload.id, metadata.uploadId)) {
                        const actual = await read('GET', `/v1/file_uploads/${pathId(upload.id)}`).catch(error => {
                            if (error instanceof NotionApiError && error.status === 404) return null; throw error;
                        });
                        if (actual?.status === 'uploaded') upload.sent = true;
                        else state.upload = undefined; // A send is never blindly repeated.
                    }
                    await persist(true); return;
                }
                const page = pageById(metadata.pageId);
                if (!page) throw new NotionApiError(409, 'attempt_target_missing');
                await verifyPage(page, true);
                // Scrubbing and trashing the verified page supersedes any prior content edit.
                // A missing append response must not keep a known private page readable.
                if (ctx.mode === 'cleanup') {
                    if (attempt.step === 'scrub_page') page.scrubPending = true;
                    state.reconciliationCount = 0; await persist(true); return;
                }
                if (attempt.step === 'append_blocks') {
                    const actual = await children(page); const hashes = array(metadata.hashes).map(String); const keys = array(metadata.keys).map(String);
                    const afterId = metadata.afterId;
                    const start = typeof afterId === 'string' ? actual.findIndex(block => sameId(block.id, afterId)) + 1 : 0;
                    if ((typeof afterId === 'string' && start === 0) || keys.length !== hashes.length || !keys.length) throw new NotionApiError(409, 'append_unconfirmed');
                    const matches = actual.slice(start, start + hashes.length);
                    if (matches.length !== hashes.length || matches.some((block, index) => blockHash(block) !== hashes[index])) {
                        state.reconciliationCount = (state.reconciliationCount ?? 0) + 1; await persist();
                        return state.reconciliationCount >= 8 ? { status: 'ambiguous', code: 'append_unconfirmed' } : waitResult('append_unconfirmed');
                    }
                    keys.forEach((key, index) => {
                        if (!page.blocks.some(block => block.key === key)) page.blocks.push({ key, id: notionId(matches[index]!.id), type: String(matches[index]!.type), hash: hashes[index]! });
                    });
                    if (keys.includes('screenshot') && state.upload) { state.upload.attached = true; page.screenshot = { revision: state.upload.revision, fileUploadId: state.upload.id }; }
                    state.reconciliationCount = 0;
                } else if (attempt.step === 'block_update') {
                    const record = page.blocks.find(block => sameId(block.id, metadata.blockId));
                    const actual = await read('GET', `/v1/blocks/${pathId(String(metadata.blockId))}`).catch(error => {
                        if (error instanceof NotionApiError && error.status === 404) return null; throw error;
                    });
                    if (record) {
                        if (!actual || actual.in_trash) page.blocks = page.blocks.filter(block => block.id !== record.id);
                        else if (!sameId(object(actual.parent).page_id, page.id)) throw new NotionApiError(409, 'block_moved');
                        else record.hash = blockHash(actual) === metadata.hash ? String(metadata.hash) : '';
                    }
                } else if (attempt.step === 'block_delete') {
                    const actual = await read('GET', `/v1/blocks/${pathId(String(metadata.blockId))}`).catch(error => {
                        if (error instanceof NotionApiError && error.status === 404) return { in_trash: true }; throw error;
                    });
                    if (actual.in_trash) page.blocks = page.blocks.filter(block => !sameId(block.id, metadata.blockId));
                } else if (attempt.step === 'rebuild_page' || attempt.step === 'scrub_page') {
                    const actual = await children(page);
                    if (!actual.length) { page.blocks = []; page.propertiesHash = undefined; page.screenshot = undefined;
                        if (attempt.step === 'scrub_page') page.scrubbed = true;
                    }
                } else if (attempt.step === 'trash_page' || attempt.step === 'untrash_page') {
                    page.trashed = Boolean((await verifyPage(page, true)).in_trash);
                } else if (attempt.step === 'update_properties') page.propertiesHash = undefined;
                else throw new NotionApiError(409, 'unknown_attempt');
                await persist(true);
            };
            const cleanupPage = async (page: NotionPageRecord) => {
                if (page.scrubbed && page.trashed && !page.scrubPending) return;
                let actual: JsonObject;
                try { actual = await verifyPage(page, true); }
                catch (error) {
                    // An inaccessible page is not proof that its copied content was removed.
                    if (error instanceof NotionApiError && error.status === 404) throw new NotionApiError(403, 'cleanup_blocked');
                    throw error;
                }
                if (actual.in_trash && (!page.scrubbed || page.scrubPending)) {
                    await write('untrash_page', 'PATCH', `/v1/pages/${pathId(page.id)}`, { in_trash: false, notifications: silent }, { pageId: page.id }, true);
                    page.trashed = false; await persist(true);
                }
                if (!page.scrubbed || page.scrubPending) {
                    const source = await read('GET', `/v1/data_sources/${pathId(page.dataSourceId)}`);
                    const properties = emptyNotionProperties(page.mapping, parseNotionSchema(source));
                    for (const mapping of page.pastMappings ?? []) Object.assign(properties, emptyNotionProperties(mapping, parseNotionSchema(source)));
                    await verifyPage(page, true);
                    await write('scrub_page', 'PATCH', `/v1/pages/${pathId(page.id)}`, { properties, erase_content: true, notifications: silent }, { pageId: page.id }, true);
                    page.scrubbed = true; page.scrubPending = false; page.blocks = []; page.screenshot = undefined; page.propertiesHash = undefined; await persist(true);
                }
                if (!page.trashed) {
                    await verifyPage(page, true);
                    await write('trash_page', 'PATCH', `/v1/pages/${pathId(page.id)}`, { in_trash: true, notifications: silent }, { pageId: page.id }, true);
                    page.trashed = true; await persist(true);
                }
            };
            const cleanupAllPages = async (): Promise<IntegrationResult> => {
                const failures: NotionApiError[] = [];
                const retain = (attempt: NonNullable<IntegrationDeliveryContext['ledger']['attempt']>) => {
                    state.retiredAttempts ??= [];
                    const sameKnownCleanup = (value: typeof attempt) => attempt.repeatable && value.repeatable && value.step === attempt.step
                        && value.planHash === attempt.planHash && sameId(object(value.metadata).pageId, object(attempt.metadata).pageId);
                    if (!state.retiredAttempts.some(value => value.operationId === attempt.operationId || sameKnownCleanup(value))) state.retiredAttempts.push(structuredClone(attempt));
                };
                const failed = async (error: unknown) => {
                    if (!(error instanceof NotionApiError)) throw error;
                    failures.push(error);
                    if (error.status === 429 || error.status === 529) await pauseNotion(session, error);
                    // Known-id cleanup is repeatable. Preserve incomplete scrubbing explicitly
                    // before releasing its core operation slot to clean another reachable page.
                    if (ctx.ledger.attempt) {
                        const attempt = ctx.ledger.attempt;
                        if (!attempt.repeatable) throw error;
                        retain(attempt);
                        if (attempt.step === 'scrub_page') {
                            const target = pageById(object(attempt.metadata).pageId); if (target) target.scrubPending = true;
                        }
                        await persist(true);
                    }
                };
                const attempt = ctx.ledger.attempt;
                if (attempt) {
                    if (!['upload_create', 'upload_send'].includes(attempt.step)) {
                        retain(attempt);
                        if (attempt.step === 'scrub_page') {
                            const target = pageById(object(attempt.metadata).pageId); if (target) target.scrubPending = true;
                        }
                    }
                    // Unknown creates retain their original database/workspace/bot/mapping before
                    // another known page may use the core's single operation slot for cleanup.
                    await persist(true);
                }
                const known = [...new Map([...(state.page ? [state.page] : []), ...(state.retired ?? [])].map(page => [page.id, page])).values()];
                for (const page of known) {
                    try { await cleanupPage(page); }
                    catch (error) { await failed(error); }
                }
                let unconfirmed = false;
                for (const receipt of [...(state.retiredAttempts ?? [])]) {
                    if (['upload_create', 'upload_send'].includes(receipt.step)) {
                        state.retiredAttempts = state.retiredAttempts!.filter(value => value.operationId !== receipt.operationId);
                        continue;
                    }
                    if (receipt.step !== 'create_page') continue;
                    const metadata = object(receipt.metadata);
                    try {
                        const grant = await session.grant();
                        if (!sameId(metadata.notionWorkspaceId, grant.notionWorkspaceId)) throw new NotionApiError(403, 'retired_grant_unavailable');
                        const matches = await queryPages(notionId(metadata.dataSourceId), metadata.mapping as NotionPageRecord['mapping'],
                            notionId(metadata.botId), typeof metadata.databaseId === 'string' ? metadata.databaseId : undefined);
                        if (!matches.length) { unconfirmed = true; continue; }
                        const recovered = pageById(matches[0]!.id) ?? recordPage(matches[0]!, metadata);
                        if (!pageById(recovered.id)) {
                            if (!state.page && sameId(recovered.dataSourceId, connection.config.dataSourceId)
                                && sameId(recovered.notionWorkspaceId, connection.config.notionWorkspaceId)) state.page = recovered;
                            else state.retired = [...(state.retired ?? []), recovered];
                        }
                        state.retiredAttempts = state.retiredAttempts!.filter(value => value.operationId !== receipt.operationId);
                        await persist();
                        await cleanupPage(recovered);
                    } catch (error) { await failed(error); }
                }
                state.retiredAttempts = state.retiredAttempts?.filter(receipt => {
                    const target = pageById(object(receipt.metadata).pageId);
                    return !target || !target.scrubbed || !target.trashed || target.scrubPending;
                });
                if (unconfirmed) state.reconciliationCount = (state.reconciliationCount ?? 0) + 1;
                state.upload = undefined; await persist();
                const limited = failures.find(error => error.status === 429 || error.status === 529);
                if (limited) return waitResult(limited.rateLimitReason ?? limited.code, limited.retryAfter ?? 60_000);
                if (failures.some(error => error.status === 401)) return { status: 'needs_reconnect', code: 'needs_reconnect' };
                if (failures.some(error => error.status > 0 && error.status < 500)) return { status: 'ambiguous', code: 'cleanup_blocked' };
                if (failures.length) return waitResult('cleanup_incomplete');
                if (state.retiredAttempts?.length) return unconfirmed && (state.reconciliationCount ?? 0) < 8
                    ? waitResult('create_unconfirmed') : { status: 'ambiguous', code: 'cleanup_blocked' };
                return { status: ctx.ledger.deletion ? 'accepted' : 'suppressed', code: 'content_removed' };
            };
            try {
                if (ctx.mode === 'cleanup') return await cleanupAllPages();
                try {
                    const reconciliation = await reconcileAttempt(); if (reconciliation) return reconciliation;
                } catch (error) {
                    const attempt = ctx.ledger.attempt;
                    if (!(error instanceof NotionApiError) || !attempt || attempt.destinationRevision === connection.destinationRevision
                        || ![400, 403, 404].includes(error.status)) throw error;
                    // A new grant cannot necessarily inspect the previous destination. Keep its
                    // uncertainty as a recovery receipt while allowing the new binding to progress.
                    if (attempt.step === 'scrub_page') {
                        const target = pageById(object(attempt.metadata).pageId); if (target) target.scrubPending = true;
                    }
                    state.retiredAttempts = [...(state.retiredAttempts ?? []), structuredClone(attempt)];
                    await persist(true);
                }
                if (state.retiredAttempts?.length) {
                    const retained = await session.grant();
                    for (const attempt of [...state.retiredAttempts]) {
                        const metadata = object(attempt.metadata);
                        if (attempt.step !== 'create_page' || !sameId(metadata.notionWorkspaceId, retained.notionWorkspaceId)) continue;
                        let found: JsonObject[];
                        try { found = await queryPages(notionId(metadata.dataSourceId), metadata.mapping as NotionPageRecord['mapping'],
                            notionId(metadata.botId), typeof metadata.databaseId === 'string' ? metadata.databaseId : undefined); }
                        catch (error) {
                            if (error instanceof NotionApiError && [400, 403, 404].includes(error.status)) continue; throw error;
                        }
                        if (!found.length) continue;
                        const recovered = recordPage(found[0]!, metadata);
                        if (!pageById(recovered.id)) state.retired = [...(state.retired ?? []), recovered];
                        state.retiredAttempts = state.retiredAttempts.filter(value => value.operationId !== attempt.operationId);
                        await persist();
                    }
                }
                if (!ctx.feedback) throw new NotionApiError(400, 'feedback_missing');
                const grant = await session.grant(); const config = connection.config;
                if (!config.dataSourceId || !config.mapping) return { status: 'paused', code: 'mapping_invalid' };
                const dataSourceId = notionId(config.dataSourceId);
                const schemaDue = !config.schemaCheckedAt || Date.now() - Date.parse(config.schemaCheckedAt) > 24 * 60 * 60_000;
                if (!config.schema || schemaDue || !config.maxFileUploadBytes) {
                    const source = await read('GET', `/v1/data_sources/${pathId(dataSourceId)}`);
                    if (source.in_trash) return { status: 'paused', code: 'data_source_missing' };
                    const me = await read('GET', '/v1/users/me'); const limit = object(object(me.bot).workspace_limits).max_file_upload_size_in_bytes;
                    config.schema = parseNotionSchema(source); config.schemaCheckedAt = new Date().toISOString();
                    config.maxFileUploadBytes = typeof limit === 'number' && limit > 0 ? Math.min(limit, 5 * 1024 * 1024 * 1024) : 5 * 1024 * 1024;
                    await updateDoc<NotionConnection>(connection.pk, connection.id, current => current.destinationRevision !== connection.destinationRevision ? current
                        : ({ ...current, config: { ...current.config, schema: config.schema, schemaCheckedAt: config.schemaCheckedAt, maxFileUploadBytes: config.maxFileUploadBytes } }), session.store);
                }
                const mapping = validateNotionMapping(config.mapping, config.schema ?? {});
                if (state.retiredAttempts?.some(attempt => attempt.step === 'create_page'
                    && sameId(object(attempt.metadata).dataSourceId, dataSourceId)
                    && sameId(object(attempt.metadata).notionWorkspaceId, grant.notionWorkspaceId)))
                    return { status: 'ambiguous', code: 'create_unconfirmed' };
                if (state.page && (!sameId(state.page.dataSourceId, dataSourceId) || !sameId(state.page.notionWorkspaceId, grant.notionWorkspaceId))) {
                    state.retired = [...(state.retired ?? []), state.page]; state.page = undefined; state.upload = undefined; state.rebuild = false; await persist();
                }
                if (state.page) {
                    let actual: JsonObject;
                    try { actual = await verifyPage(state.page, true); }
                    catch (error) {
                        if (!(error instanceof NotionApiError && error.status === 404)) throw error;
                        actual = { in_trash: true };
                    }
                    if (actual.in_trash && !state.page.scrubbed) {
                        state.page.trashed = true;
                        if (state.removedAtVersion === undefined) { state.removedAtVersion = ctx.through; await persist(); return { status: 'accepted', code: 'page_removed_in_notion' }; }
                        if (ctx.through <= state.removedAtVersion) return { status: 'accepted', code: 'page_removed_in_notion' };
                        state.retired = [...(state.retired ?? []), state.page]; state.page = undefined; state.removedAtVersion = undefined; await persist();
                    } else if (state.page.scrubbed || state.page.trashed) {
                        await write('untrash_page', 'PATCH', `/v1/pages/${pathId(state.page.id)}`, { in_trash: false, notifications: silent }, { pageId: state.page.id }, true);
                        state.page.trashed = false; state.page.blocks = []; state.rebuild = false; await persist(true);
                    }
                }
                if (!state.page) {
                    const matches = await queryPages(dataSourceId, mapping, grant.botId, config.databaseId);
                    const metadata = { dataSourceId, databaseId: config.databaseId, notionWorkspaceId: grant.notionWorkspaceId, botId: grant.botId, mapping };
                    if (matches.length) { adoptCreated(matches[0]!, metadata); await persist(); }
                    else {
                        const properties = notionProperties(ctx.feedback.context, mapping);
                        const actual = await write('create_page', 'POST', '/v1/pages', { parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties },
                            { ...metadata, propertiesHash: notionHash(canonicalProperties(properties)) });
                        adoptCreated(actual, metadata); state.page!.propertiesHash = notionHash(canonicalProperties(properties)); state.rebuild = false; await persist(true);
                    }
                }
                const page = state.page!;
                if (notionHash(page.mapping) !== notionHash(mapping)) {
                    page.pastMappings = [...(page.pastMappings ?? []), page.mapping]; page.mapping = mapping; page.propertiesHash = undefined; await persist();
                }
                let screenshot: { fileUploadId: string; revision: string } | undefined;
                let screenshotNote: string | undefined;
                if (ctx.feedback.context.screenshot.state === 'protected') {
                    const actor = await memberActor(ctx.project, connection.connectedBy);
                    if (!actor || actor.kind !== 'member' || !actor.isAdmin) throw new NotionApiError(401, 'member_left');
                    const saved = await getProjectScreenshot(ctx.project, actor, ctx.ledger.threadId);
                    const bytes = await screenshotBytes(saved); const revision = saved.revision ?? createHash('sha256').update(bytes).digest('hex');
                    if (ctx.feedback.context.screenshot.revision !== undefined && ctx.feedback.context.screenshot.revision !== saved.revision)
                        throw new IntegrationControlError('projection_changed');
                    if (bytes.length > (config.maxFileUploadBytes ?? 5 * 1024 * 1024)) screenshotNote = 'Screenshot too large for this Notion plan.';
                    else if (page.screenshot?.revision === revision) screenshot = { fileUploadId: page.screenshot.fileUploadId, revision };
                    else {
                        if (state.upload?.revision !== revision || (!state.upload.attached && Date.parse(state.upload.expiryTime) <= Date.now() + 60_000)) state.upload = undefined;
                        if (!state.upload) {
                            const allocation = await write('upload_create', 'POST', '/v1/file_uploads', { mode: 'single_part', filename: `uier-screenshot.${saved.contentType.split('/')[1]}`, content_type: saved.contentType });
                            const expiryTime = typeof allocation.expiry_time === 'string' && Number.isFinite(Date.parse(allocation.expiry_time)) ? allocation.expiry_time : new Date(Date.now() + 60 * 60_000).toISOString();
                            state.upload = { id: notionId(allocation.id), revision, expiryTime, sent: false, attached: false }; await persist(true);
                        }
                        if (!state.upload.sent) {
                            const form = new FormData(); form.set('file', new Blob([new Uint8Array(bytes)], { type: saved.contentType }), `screenshot.${saved.contentType.split('/')[1]}`);
                            await write('upload_send', 'POST', `/v1/file_uploads/${pathId(state.upload.id)}/send`, form, { uploadId: state.upload.id });
                            state.upload.sent = true; await persist(true);
                        }
                        screenshot = { fileUploadId: state.upload.id, revision };
                    }
                }
                const desired = notionBlocks(ctx.feedback.context, screenshot, screenshotNote);
                if (state.rebuild) {
                    const actual = await children(page);
                    if (actual.length === desired.length && actual.every((block, index) => blockHash(block) === desired[index]!.hash))
                        page.blocks = desired.map((spec, index) => ({ key: spec.key, id: notionId(actual[index]!.id), type: spec.block.type, hash: spec.hash }));
                    else {
                        await verifyPage(page, true);
                        await write('rebuild_page', 'PATCH', `/v1/pages/${pathId(page.id)}`, { erase_content: true, notifications: silent }, { pageId: page.id }, true);
                        page.blocks = [];
                    }
                    state.rebuild = false; await persist(true);
                }
                const properties = notionProperties(ctx.feedback.context, mapping, screenshot?.fileUploadId);
                const propertiesHash = notionHash(canonicalProperties(properties));
                if (page.propertiesHash !== propertiesHash) {
                    await verifyPage(page, true);
                    await write('update_properties', 'PATCH', `/v1/pages/${pathId(page.id)}`, { properties, notifications: silent }, { pageId: page.id }, true);
                    page.propertiesHash = propertiesHash; page.scrubbed = false; page.scrubPending = false;
                    if (screenshot && mapping.screenshot) { page.screenshot = screenshot; if (state.upload) state.upload.attached = true; }
                    await persist(true);
                }
                const desiredByKey = new Map(desired.map(spec => [spec.key, spec]));
                for (const record of [...page.blocks]) {
                    const next = desiredByKey.get(record.key);
                    if (!next || next.block.type !== record.type || (record.type === 'image' && record.hash !== next.hash)) {
                        const actual = await read('GET', `/v1/blocks/${pathId(record.id)}`).catch(error => {
                            if (error instanceof NotionApiError && error.status === 404) return { in_trash: true, parent: { page_id: page.id } }; throw error;
                        });
                        if (!sameId(object(actual.parent).page_id, page.id)) throw new NotionApiError(409, 'block_moved');
                        await verifyPage(page, true);
                        if (!actual.in_trash) await write('block_delete', 'DELETE', `/v1/blocks/${pathId(record.id)}`, undefined, { pageId: page.id, blockId: record.id }, true);
                        page.blocks = page.blocks.filter(block => block.id !== record.id); await persist(true);
                    }
                }
                for (let index = 0; index < desired.length;) {
                    const spec = desired[index]!;
                    const existing = page.blocks.find(block => block.key === spec.key);
                    if (existing) {
                        if (existing.hash !== spec.hash) {
                            const actual = await read('GET', `/v1/blocks/${pathId(existing.id)}`).catch(error => {
                                if (error instanceof NotionApiError && error.status === 404) return null; throw error;
                            });
                            if (!actual || actual.in_trash) { page.blocks = page.blocks.filter(block => block.id !== existing.id); await persist(); continue; }
                            if (!sameId(object(actual.parent).page_id, page.id)) throw new NotionApiError(409, 'block_moved');
                            await verifyPage(page, true);
                            await write('block_update', 'PATCH', `/v1/blocks/${pathId(existing.id)}`, { [spec.block.type]: spec.block[spec.block.type] },
                                { pageId: page.id, blockId: existing.id, hash: spec.hash }, true);
                            existing.hash = spec.hash; await persist(true);
                        }
                        index++; continue;
                    }
                    const batch: BlockSpec[] = [];
                    const after = index > 0 ? page.blocks.find(block => block.key === desired[index - 1]!.key)?.id : undefined;
                    while (index < desired.length && batch.length < 100 && !page.blocks.some(block => block.key === desired[index]!.key)) batch.push(desired[index++]!);
                    await verifyPage(page, true);
                    const appended = await write('append_blocks', 'PATCH', `/v1/blocks/${pathId(page.id)}/children`, { children: batch.map(spec => spec.block),
                        position: after ? { type: 'after_block', after_block: { id: after } } : { type: 'start' }, notifications: silent },
                        { pageId: page.id, afterId: after, keys: batch.map(spec => spec.key), hashes: batch.map(spec => spec.hash) });
                    const blocks = array(appended.results).map(object);
                    if (blocks.length !== batch.length) throw new NotionApiError(0, 'append_response_incomplete');
                    batch.forEach((spec, i) => page.blocks.push({ key: spec.key, id: notionId(blocks[i]!.id), type: spec.block.type, hash: spec.hash }));
                    if (batch.some(spec => spec.key === 'screenshot') && screenshot) { page.screenshot = screenshot; if (state.upload) state.upload.attached = true; }
                    await persist(true);
                }
                if (!screenshot) page.screenshot = undefined;
                await persist();
                return { status: 'accepted', ...(screenshotNote ? { code: 'screenshot_too_large' } : {}) };
            } catch (error) {
                if (error instanceof IntegrationControlError) throw error;
                if (error instanceof GrantLeaseError) return waitResult('credential_busy');
                if (!(error instanceof NotionApiError)) throw error;
                if (error.code === 'public_api_request_blocked' || error.rateLimitReason === 'public_api_request_blocked') return { status: 'paused', code: 'request_blocked' };
                if (error.status === 429 || error.status === 529) { await pauseNotion(session, error); return waitResult(error.rateLimitReason ?? error.code, error.retryAfter ?? 60_000); }
                if (error.status === 401) return { status: 'needs_reconnect', code: error.code };
                if (error.status === 403) return ctx.mode === 'cleanup' || ['cleanup_blocked', 'retired_grant_unavailable'].includes(error.code)
                    ? { status: 'ambiguous', code: 'cleanup_blocked' } : { status: 'paused', code: 'insufficient_capabilities' };
                if (error.status === 404) return { status: 'paused', code: 'data_source_missing' };
                if (error.status === 409) return { status: 'ambiguous', code: error.code };
                if (error.status === 400) return { status: 'paused', code: 'mapping_invalid' };
                if (error.status === 0 || error.status >= 500) return waitResult(error.code);
                return { status: 'failed', code: error.code };
            }
        } };
}
export const notionAdapter = createNotionAdapter();
