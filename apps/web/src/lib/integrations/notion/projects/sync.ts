import { randomUUID } from 'node:crypto';
import { projectRefPk, workspacePk, type AppDoc, type DbProject, type DbProjectRef } from '../../../app/model';
import { getAppStore, updateDoc, type AppMutation, type AppStore } from '../../../app/store';
import { sha256Hex } from '../../../app/tokens';
import { keyedHash } from '../../../comments/environment';
import { ensureProjectPublicId } from '../../../app/projectPublicIds';
import { notionWorkspaceAuthority } from './authority';
import { NotionApiError, notionId, normalizedId, object, array, sameId, type JsonObject } from '../client';
import { isNotionConfigured } from '../config';
import { NotionSession, pauseNotion, type NotionServices } from '../connection';
import type { NotionGrant } from '../model';
import { projectFromNotionRow, validateProjectMapping } from './mapping';
import type { NotionProjectsConnection, NotionProjectRow } from './model';
import { projectSourceSchema } from './settings';

export const notionProjectRowKey = (sourceId: string, rowId: string) => `notion_row_${sha256Hex(JSON.stringify([normalizedId(sourceId), normalizedId(rowId)]))}`;
const currentLease = (connection: NotionProjectsConnection, observed: NotionProjectsConnection) => connection.enabled
    && connection.destinationRevision === observed.destinationRevision && connection.grantId === observed.grantId
    && connection.connectedBy === observed.connectedBy && connection.lease?.id === observed.lease?.id
    && Date.parse(connection.lease?.until ?? '') > Date.now();

async function commitRow(connection: NotionProjectsConnection, row: JsonObject, schema: ReturnType<typeof projectSourceSchema>['schema'],
    session: NotionSession, store: AppStore) {
    const rowId = notionId(row.id); const dataSourceId = connection.config.dataSourceId!;
    if (!sameId(object(row.parent).data_source_id, dataSourceId)) throw new NotionApiError(400, 'row_invalid');
    const fields = projectFromNotionRow(row, connection.config.mapping!, schema);
    if (!fields) return false;
    const key = notionProjectRowKey(dataSourceId, rowId);
    for (let attempt = 0; attempt < 8; attempt++) {
        const guards = await notionWorkspaceAuthority(connection.workspaceId, connection.connectedBy, store);
        const retained = await store.get<NotionProjectsConnection>(connection.pk, connection.id);
        const grant = connection.grantId ? await store.get<NotionGrant>(connection.pk, connection.grantId) : null;
        const used = await session.grant();
        if (!retained || !currentLease(retained.doc, connection) || !grant || used.generation !== grant.doc.generation) throw new NotionApiError(409, 'connection_changed');
        const receipt = await store.get<NotionProjectRow>(connection.pk, key);
        // Existing receipts remain authoritative across key rotation. New codes need the app's
        // server-held secret: public workspace/row identifiers must not reveal a review code.
        const projectId = receipt?.doc.projectId ?? (BigInt(`0x${keyedHash('notion-project-code-v1', JSON.stringify([connection.workspaceId, key]))}`)
            % (36n ** 12n)).toString(36).padStart(12, '0');
        const existing = await store.get<DbProject>(connection.pk, projectId);
        if (receipt && (!existing || existing.doc.automaticallyManaged?.rowKey !== key || existing.doc.automaticallyManaged.connectionId !== connection.id
            || existing.doc.transfer || existing.doc.workspaceId !== connection.workspaceId)) return false;
        if (!receipt && existing) return false;
        if (await store.get<AppDoc>('project-deletion', projectId)) return false;
        if (!receipt) {
            // Claim before creating the project. Its source key distinguishes a lost-write replay from a collision.
            const ref: DbProjectRef & { notionRowKey: string } = { type: 'project-ref', pk: projectRefPk(projectId), id: projectId, workspaceId: connection.workspaceId, notionRowKey: key };
            if (!await store.create(ref)) {
                const claimed = (await store.get<typeof ref>(ref.pk, ref.id))?.doc;
                if (claimed?.type !== 'project-ref' || claimed.workspaceId !== connection.workspaceId || claimed.notionRowKey !== key) return false;
            }
        }
        const now = new Date().toISOString();
        const project: DbProject = existing ? { ...existing.doc, ...fields, updatedAt: now } : { type: 'project', pk: workspacePk(connection.workspaceId),
            id: projectId, workspaceId: connection.workspaceId, ...fields, access: 'invited', createdBy: connection.connectedBy, createdAt: now, updatedAt: now,
            automaticallyManaged: { provider: 'notion', connectionId: connection.id, rowKey: key } };
        if (existing && existing.doc.name === fields.name && existing.doc.status === fields.status && JSON.stringify(existing.doc.urls) === JSON.stringify(fields.urls)) {
            await ensureProjectPublicId(existing.doc, store); return true;
        }
        const operations: AppMutation[] = [...guards,
            { kind: 'replace', doc: retained.doc, etag: retained.etag }, { kind: 'replace', doc: grant.doc, etag: grant.etag },
            existing ? { kind: 'replace', doc: project, etag: existing.etag } : { kind: 'create', doc: project }];
        if (!receipt) operations.push({ kind: 'create', doc: { type: 'notion-project-row', id: key, pk: connection.pk, workspaceId: connection.workspaceId,
            connectionId: connection.id, dataSourceId, rowId, projectId } satisfies NotionProjectRow });
        if (await store.transact(operations)) { await ensureProjectPublicId(project, store); return true; }
    }
    throw new NotionApiError(409, 'connection_changed');
}

/** Local writes only. Keep the row receipt so every future import leaves this project alone. */
export async function makeNotionProjectManual(workspaceId: string, projectId: string, userId: string, store = getAppStore()) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const guards = await notionWorkspaceAuthority(workspaceId, userId, store);
        const current = await store.get<DbProject>(workspacePk(workspaceId), projectId);
        if (current?.doc.type !== 'project' || current.doc.workspaceId !== workspaceId || current.doc.transfer) throw new NotionApiError(404, 'project_missing');
        if (!current.doc.automaticallyManaged) return;
        const { automaticallyManaged: _managed, ...manual } = current.doc;
        if (await store.transact([...guards, { kind: 'replace', doc: { ...manual, updatedAt: new Date().toISOString() }, etag: current.etag }])) return;
    }
    throw new NotionApiError(409, 'connection_changed');
}

/** Bounded leased polling, called inside the existing scheduled Notion provider turn. */
export async function syncNotionProjects(input: { deadline: number; maxCalls?: number }, services: NotionServices = {}) {
    const store = services.store ?? getAppStore(); let calls = 0; let deferred = 0;
    const maxCalls = input.maxCalls ?? 20;
    if (!isNotionConfigured() || Date.now() >= input.deadline || maxCalls <= 0) return { calls, deferred };
    const pending = await store.query<NotionProjectsConnection>({ type: 'notion-projects-connection', where: { enabled: true }, limit: 20,
        orderBy: 'nextAttemptAt', dueBefore: new Date().toISOString() });
    for (const observed of pending) {
        if (Date.now() >= input.deadline || calls >= maxCalls) { deferred++; break; }
        const lease = { id: randomUUID(), until: new Date(Math.min(Date.now() + 60_000, input.deadline + 1000)).toISOString() };
        let claimed = false;
        const connection = await updateDoc<NotionProjectsConnection>(observed.pk, observed.id, current => {
            claimed = false;
            if (!current.enabled || current.destinationRevision !== observed.destinationRevision || Date.parse(current.nextAttemptAt) > Date.now()
                || (current.lease && Date.parse(current.lease.until) > Date.now())) return current;
            claimed = true; return { ...current, lease };
        }, store);
        if (!claimed || !connection) continue;
        const session = new NotionSession(connection, services, true);
        const run = async <T>(send: (signal: AbortSignal) => Promise<T>) => {
            if (calls >= maxCalls || Date.now() >= input.deadline) throw new NotionApiError(429, 'sync_budget');
            const current = (await store.get<NotionProjectsConnection>(connection.pk, connection.id))?.doc;
            if (!current || !currentLease(current, connection)) throw new NotionApiError(409, 'connection_changed');
            calls++; return send(AbortSignal.timeout(Math.max(1, Math.min(20_000, Math.floor(input.deadline - Date.now())))));
        };
        const request = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
            try { return await run(signal => session.raw(method, path, body, signal)); }
            catch (error) {
                if (!(error instanceof NotionApiError && error.status === 401 && error.code === 'unauthorized')) throw error;
                await session.refresh(run); return run(signal => session.raw(method, path, body, signal));
            }
        };
        const save = async (change: (value: NotionProjectsConnection) => NotionProjectsConnection) => {
            await updateDoc<NotionProjectsConnection>(connection.pk, connection.id, value => currentLease(value, connection) ? change(value) : value, store);
        };
        try {
            const source = projectSourceSchema(await request('GET', `/v1/data_sources/${encodeURIComponent(notionId(connection.config.dataSourceId))}`));
            validateProjectMapping(connection.config.mapping, source.schema);
            let cursor = connection.cursor; let skipped = cursor ? connection.skippedRows ?? 0 : 0;
            for (let page = 0; page < 5; page++) {
                const response = await request('POST', `/v1/data_sources/${encodeURIComponent(source.dataSourceId)}/query`,
                    { page_size: 25, sorts: [{ timestamp: 'created_time', direction: 'ascending' }], ...(cursor ? { start_cursor: cursor } : {}) });
                if (!Array.isArray(response.results) || typeof response.has_more !== 'boolean') throw new NotionApiError(0, 'invalid_response');
                for (const raw of array(response.results)) {
                    if (Date.now() >= input.deadline) throw new NotionApiError(429, 'sync_budget');
                    try { if (!await commitRow(connection, object(raw), source.schema, session, store)) skipped++; }
                    catch (error) { if (error instanceof NotionApiError && ['row_invalid', 'invalid_notion_id'].includes(error.code)) skipped++; else throw error; }
                }
                const next = response.has_more ? response.next_cursor : undefined;
                if (response.has_more && (typeof next !== 'string' || !next || next.length > 256 || next === cursor)) throw new NotionApiError(0, 'invalid_response');
                cursor = typeof next === 'string' ? next : undefined;
                await save(value => ({ ...value, cursor, skippedRows: skipped, status: 'connected', statusCode: undefined, failures: 0,
                    nextAttemptAt: new Date(Date.now() + (cursor ? 0 : 5 * 60_000)).toISOString(), ...(!cursor ? { lastSyncedAt: new Date().toISOString() } : {}) }));
                if (!cursor) break;
            }
        } catch (error) {
            deferred++;
            if (error instanceof NotionApiError && error.status === 429 && error.code !== 'sync_budget') await pauseNotion(session, error);
            await save(value => ({ ...value, failures: (value.failures ?? 0) + 1,
                statusCode: error instanceof NotionApiError ? error.code : 'sync_failed',
                ...(error instanceof NotionApiError && ['validation_error', 'invalid_cursor'].includes(error.code) ? { cursor: undefined } : {}),
                // Recovery remains scheduled, including schema repair and temporary database access failures.
                nextAttemptAt: new Date(Date.now() + Math.max(error instanceof NotionApiError ? error.retryAfter ?? 0 : 0,
                    Math.min(60 * 60_000, 30_000 * 2 ** Math.min(value.failures ?? 0, 7)))).toISOString() }));
        } finally {
            await updateDoc<NotionProjectsConnection>(connection.pk, connection.id, value => value.lease?.id === lease.id ? { ...value, lease: undefined } : value, store);
        }
    }
    return { calls, deferred };
}
