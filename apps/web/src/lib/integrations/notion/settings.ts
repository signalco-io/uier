import { workspacePk, type DbProject } from '../../app/model';
import { getAppStore, updateDoc } from '../../app/store';
import { setIntegrationBinding } from '../connection';
import type { IntegrationSync } from '../model';
import { array, boundedName, NotionApiError, notionId, object, propertyId, richText, type JsonObject } from './client';
import { isNotionConfigured } from './config';
import { notionAdmin, NotionSession, storedNotionConnection, type NotionServices } from './connection';
import type { NotionConnection, NotionSchema, NotionSettingsView } from './model';
import { defaultNotionMapping, validateNotionMapping } from './page';

export function parseNotionSchema(source: JsonObject): NotionSchema {
    const schema: NotionSchema = {};
    for (const [name, raw] of Object.entries(object(source.properties))) {
        const property = object(raw); const id = propertyId(property.id); const type = typeof property.type === 'string' ? property.type : '';
        schema[id] = { name: boundedName(property.name, boundedName(name)), type,
            ...(['select', 'status'].includes(type) ? { options: array(object(property[type]).options).map(value => object(value).name).filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100) } : {}) };
    }
    return schema;
}
function sourceName(source: JsonObject) { return boundedName(richText(source.title), 'Notion database'); }
async function adminSession(project: DbProject, userId: string, services: NotionServices) {
    const store = services.store ?? getAppStore(); const current = await notionAdmin(project, userId, store);
    const connection = await storedNotionConnection(current, store);
    if (!connection || !isNotionConfigured()) throw new NotionApiError(503, 'not_configured');
    return { project: current, connection, session: new NotionSession(connection, services), store };
}
export async function getNotionSettings(project: DbProject, userId: string, services: NotionServices = {}): Promise<NotionSettingsView> {
    const store = services.store ?? getAppStore();
    await notionAdmin(project, userId, store);
    const connection = await storedNotionConnection(project, store);
    if (!connection || connection.statusCode === 'disconnected') return { configured: isNotionConfigured(), status: 'not_connected', enabled: false, needsReviewCount: 0 };
    const review = await Promise.all((['failed', 'ambiguous'] as const).map(status => store.query<IntegrationSync>({
        type: 'notion-sync', pk: `notion:${project.id}`, where: { connectionId: connection.id, status }, limit: 1000 })));
    const ledgers = review.flat();
    const config = connection.config;
    return { configured: isNotionConfigured(), status: connection.status, statusCode: connection.statusCode, enabled: connection.enabled,
        notionWorkspaceName: config.notionWorkspaceName, dataSourceId: config.dataSourceId, dataSourceName: config.dataSourceName,
        mapping: config.mapping, schema: config.schema, lastSyncedAt: connection.lastSyncedAt, pausedUntil: connection.pausedUntil,
        ...(connection.backfill ? { backfill: { queued: connection.backfill.queued, total: connection.backfill.threadIds.length, done: connection.backfill.done } } : {}),
        needsReviewCount: ledgers.length, needsReviewCountCapped: review.some(page => page.length === 1000) };
}
export async function loadNotionDataSources(project: DbProject, userId: string, services: NotionServices = {}) {
    const { session } = await adminSession(project, userId, services);
    const result: { id: string; name: string; databaseId: string }[] = [];
    let cursor: string | undefined;
    do {
        const response = await session.request('POST', '/v1/search', { filter: { property: 'object', value: 'data_source' }, page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {}) });
        for (const raw of array(response.results)) {
            const source = object(raw);
            if (source.object !== 'data_source' || source.in_trash) continue;
            const parent = object(source.parent);
            result.push({ id: notionId(source.id), name: sourceName(source), databaseId: notionId(parent.database_id) });
            if (result.length >= 500) return result;
        }
        cursor = response.has_more && typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
    } while (cursor);
    return result;
}
export async function loadNotionSchema(project: DbProject, userId: string, dataSourceId: string, services: NotionServices = {}) {
    const { session } = await adminSession(project, userId, services);
    const source = await session.request('GET', `/v1/data_sources/${encodeURIComponent(notionId(dataSourceId))}`);
    if (source.object !== 'data_source' || source.in_trash) throw new NotionApiError(404, 'data_source_missing');
    const schema = parseNotionSchema(source);
    return { schema, mapping: defaultNotionMapping(schema), dataSourceName: sourceName(source) };
}
export async function saveNotionMapping(project: DbProject, userId: string, input: { dataSourceId: string; mapping: unknown }, services: NotionServices = {}) {
    const { project: currentProject, connection, session, store } = await adminSession(project, userId, services);
    const source = await session.request('GET', `/v1/data_sources/${encodeURIComponent(notionId(input.dataSourceId))}`);
    if (source.object !== 'data_source' || source.in_trash) throw new NotionApiError(404, 'data_source_missing');
    const schema = parseNotionSchema(source);
    const mapping = validateNotionMapping(input.mapping, schema);
    await notionAdmin(currentProject, userId, store);
    const saved = await updateDoc<NotionConnection>(connection.pk, connection.id, value => {
        if (value.connectedBy !== connection.connectedBy || value.grantId !== connection.grantId || value.destinationRevision !== connection.destinationRevision)
            throw new NotionApiError(409, 'connection_changed');
        return { ...value, enabled: true, status: 'connected', statusCode: undefined,
            destinationRevision: value.destinationRevision + 1, updatedAt: new Date().toISOString(),
            config: { ...value.config, dataSourceId: notionId(source.id), databaseId: notionId(object(source.parent).database_id),
                dataSourceName: sourceName(source), schema, mapping, schemaCheckedAt: new Date().toISOString(),
                maxFileUploadBytes: value.config.maxFileUploadBytes ?? 5 * 1024 * 1024 } };
    }, store);
    if (!saved) throw new NotionApiError(409, 'connection_changed');
    await setIntegrationBinding(project.workspaceId, project.id, 'notion', { connectionId: saved.id,
        since: currentProject.integrations?.notion?.since ?? new Date().toISOString() }, store);
    return getNotionSettings(project, userId, services);
}

/** The duplicated template id is a page/database id, never assumed to be a data-source id. */
export async function applyNotionTemplate(project: DbProject, userId: string, templateId: unknown, services: NotionServices = {}) {
    if (typeof templateId !== 'string') return;
    const { session } = await adminSession(project, userId, services);
    const id = notionId(templateId);
    let database: JsonObject | undefined;
    try { database = await session.request('GET', `/v1/databases/${encodeURIComponent(id)}`); }
    catch (error) { if (!(error instanceof NotionApiError && error.status === 404)) throw error; }
    if (!database) {
        let cursor: string | undefined;
        for (let page = 0; page < 5 && !database; page++) {
            const children = await session.request('GET', `/v1/blocks/${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
            const child = array(children.results).map(object).find(block => block.type === 'child_database');
            if (child) database = await session.request('GET', `/v1/databases/${encodeURIComponent(notionId(child.id))}`);
            cursor = children.has_more && typeof children.next_cursor === 'string' ? children.next_cursor : undefined;
            if (!cursor) break;
        }
    }
    const dataSource = array(database?.data_sources).map(object)[0];
    if (!dataSource) return;
    const result = await loadNotionSchema(project, userId, notionId(dataSource.id), services);
    try { validateNotionMapping(result.mapping, result.schema); }
    catch { return; }
    await saveNotionMapping(project, userId, { dataSourceId: notionId(dataSource.id), mapping: result.mapping }, services);
}
