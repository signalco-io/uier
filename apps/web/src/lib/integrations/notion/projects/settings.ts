import { workspacePk } from '../../../app/model';
import { getAppStore, type AppMutation } from '../../../app/store';
import { array, boundedName, NotionApiError, notionId, object, richText, type JsonObject } from '../client';
import { isNotionConfigured } from '../config';
import { NotionSession, type NotionServices } from '../connection';
import type { NotionGrant } from '../model';
import { parseNotionSchema } from '../settings';
import { notionWorkspaceAuthority } from './authority';
import { validateProjectMapping } from './mapping';
import { notionProjectsConnectionId, type NotionProjectsConnection, type NotionProjectsView } from './model';

async function adminSession(workspaceId: string, userId: string, services: NotionServices) {
    const store = services.store ?? getAppStore();
    await notionWorkspaceAuthority(workspaceId, userId, store);
    const connection = (await store.get<NotionProjectsConnection>(workspacePk(workspaceId), notionProjectsConnectionId))?.doc;
    if (connection?.type !== 'notion-projects-connection') throw new NotionApiError(401, 'needs_reconnect');
    return { store, connection, session: new NotionSession(connection, services) };
}
export async function getNotionProjectsSettings(workspaceId: string, userId: string, services: NotionServices = {}): Promise<NotionProjectsView> {
    const store = services.store ?? getAppStore();
    await notionWorkspaceAuthority(workspaceId, userId, store);
    const current = (await store.get<NotionProjectsConnection>(workspacePk(workspaceId), notionProjectsConnectionId))?.doc;
    return { configured: isNotionConfigured(), connected: Boolean(current && current.statusCode !== 'disconnected'),
        enabled: current?.enabled ?? false, status: current?.status ?? 'needs_reconnect', statusCode: current?.statusCode,
        config: current?.config ?? {}, lastSyncedAt: current?.lastSyncedAt, skippedRows: current?.skippedRows };
}
export async function loadNotionProjectSources(workspaceId: string, userId: string, services: NotionServices = {}) {
    const { session, store } = await adminSession(workspaceId, userId, services);
    const result: { id: string; name: string }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
        const response = await session.request('POST', '/v1/search', { filter: { property: 'object', value: 'data_source' }, page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {}) });
        for (const raw of array(response.results)) {
            const source = object(raw);
            if (source.object === 'data_source' && !source.in_trash) result.push({ id: notionId(source.id), name: boundedName(richText(source.title), 'Notion database') });
        }
        cursor = response.has_more && typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
        if (!cursor) break;
    }
    await notionWorkspaceAuthority(workspaceId, userId, store);
    await session.grant();
    return result;
}
export async function loadNotionProjectSchema(workspaceId: string, userId: string, dataSourceId: string, services: NotionServices = {}) {
    const { session, store } = await adminSession(workspaceId, userId, services);
    const source = await session.request('GET', `/v1/data_sources/${encodeURIComponent(notionId(dataSourceId))}`);
    const result = projectSourceSchema(source);
    await notionWorkspaceAuthority(workspaceId, userId, store);
    await session.grant();
    return result;
}
export function projectSourceSchema(source: JsonObject) {
    if (source.object !== 'data_source' || source.in_trash || source.archived) throw new NotionApiError(404, 'data_source_missing');
    return { schema: parseNotionSchema(source), dataSourceId: notionId(source.id), databaseId: notionId(object(source.parent).database_id),
        dataSourceName: boundedName(richText(source.title), 'Notion database') };
}
export async function saveNotionProjectMapping(workspaceId: string, userId: string, dataSourceId: string, mapping: unknown, services: NotionServices = {}) {
    const { connection, session, store } = await adminSession(workspaceId, userId, services);
    const source = projectSourceSchema(await session.request('GET', `/v1/data_sources/${encodeURIComponent(notionId(dataSourceId))}`));
    const validated = validateProjectMapping(mapping, source.schema);
    const grant = await session.grant();
    await changeNotionProjects(workspaceId, userId, current => {
        if (current.destinationRevision !== connection.destinationRevision || current.grantId !== grant.id) throw new NotionApiError(409, 'connection_changed');
        return { ...current, enabled: true, status: 'connected', statusCode: undefined, lease: undefined, cursor: undefined, skippedRows: 0,
            failures: 0, destinationRevision: current.destinationRevision + 1, config: { ...current.config, ...source, mapping: validated },
            nextAttemptAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }, services, grant.generation);
}
/** Off and disconnect need no provider credentials. Both invalidate an in-flight worker's lease. */
export async function changeNotionProjects(workspaceId: string, userId: string,
    change: (current: NotionProjectsConnection) => NotionProjectsConnection, services: NotionServices = {}, generation?: number, disconnect = false) {
    const store = services.store ?? getAppStore();
    for (let attempt = 0; attempt < 8; attempt++) {
        const guards = await notionWorkspaceAuthority(workspaceId, userId, store);
        const stored = await store.get<NotionProjectsConnection>(workspacePk(workspaceId), notionProjectsConnectionId);
        if (stored?.doc.type !== 'notion-projects-connection') throw new NotionApiError(409, 'connection_changed');
        const grant = stored.doc.grantId ? await store.get<NotionGrant>(stored.doc.pk, stored.doc.grantId) : null;
        if (generation !== undefined && (!grant || grant.doc.generation !== generation || grant.doc.status !== 'connected')) throw new NotionApiError(409, 'connection_changed');
        const operations: AppMutation[] = [...guards, { kind: 'replace', doc: change(stored.doc), etag: stored.etag }];
        if (grant && (disconnect || generation !== undefined)) {
            const { tokens: _tokens, refreshLease: _lease, ...metadata } = grant.doc;
            operations.push({ kind: 'replace', doc: disconnect ? { ...metadata, status: 'revoked', generation: metadata.generation + 1 } : grant.doc, etag: grant.etag });
        }
        if (await store.transact(operations)) return;
    }
    throw new NotionApiError(409, 'connection_changed');
}
export async function stopNotionProjects(workspaceId: string, userId: string, disconnect: boolean, services: NotionServices = {}) {
    await changeNotionProjects(workspaceId, userId, current => ({ ...current, enabled: false, lease: undefined, cursor: undefined,
        destinationRevision: current.destinationRevision + 1, ...(disconnect ? { status: 'needs_reconnect', statusCode: 'disconnected' } : {}),
        updatedAt: new Date().toISOString() }), services, undefined, disconnect);
}
