import { getAppStore, updateDoc } from '../../app/store';
import { NotionApiError } from './client';
import { isNotionConfigured } from './config';
import { NotionSession, type NotionServices } from './connection';
import type { NotionConnection } from './model';
import { validateNotionMapping } from './page';
import { parseNotionSchema } from './settings';
import type { AppDoc } from '../../app/model';

type ProbeCursor = AppDoc & { type: 'notion-probe-cursor'; afterId?: string };
const cursorIdentity = { pk: 'integrations:worker', id: 'notion-probes' };

/** Hourly authorized read-only recovery probes, inside the caller's provider allowance. */
export async function probeNotionConnections(input: { deadline: number; maxCalls?: number }, services: NotionServices = {}) {
    let calls = 0; let deferred = 0;
    if (!isNotionConfigured() || Date.now() >= input.deadline || (input.maxCalls !== undefined && input.maxCalls <= 0)) return { calls, deferred };
    const store = services.store ?? getAppStore();
    const afterId = (await store.get<ProbeCursor>(cursorIdentity.pk, cursorIdentity.id))?.doc.afterId;
    const query = { type: 'notion-connection' as const, where: { enabled: true, status: 'paused' }, limit: 100, orderBy: 'id' as const };
    let rows = await store.query<NotionConnection>({ ...query, ...(afterId ? { afterId } : {}) });
    if (!rows.length && afterId) rows = await store.query<NotionConnection>(query);
    let visited: string | undefined;
    for (const [index, connection] of rows.entries()) {
        if (Date.now() >= input.deadline || calls >= (input.maxCalls ?? 10)) { deferred += rows.length - index; break; }
        visited = connection.id;
        if (!['mapping_invalid', 'data_source_missing', 'insufficient_capabilities'].includes(connection.statusCode ?? '') || !connection.config.dataSourceId) continue;
        if (Date.now() - Date.parse(String(connection.config.probeAt ?? '1970-01-01')) < 60 * 60_000) continue;
        const session = new NotionSession(connection, services, true);
        const run = async <T>(send: (signal: AbortSignal) => Promise<T>) => {
            if (Date.now() >= input.deadline || calls >= (input.maxCalls ?? 10)) throw new NotionApiError(429, 'probe_budget');
            await session.grant();
            if (Date.now() >= input.deadline || calls >= (input.maxCalls ?? 10)) throw new NotionApiError(429, 'probe_budget');
            calls++;
            return send(AbortSignal.timeout(Math.max(1, Math.min(20_000, input.deadline - Date.now()))));
        };
        const stillCurrent = (value: NotionConnection) => value.destinationRevision === connection.destinationRevision && value.connectedBy === connection.connectedBy
            && value.grantId === connection.grantId && value.enabled && value.status === 'paused' && value.statusCode === connection.statusCode;
        try {
            await session.grant();
            await updateDoc<NotionConnection>(connection.pk, connection.id, value => stillCurrent(value)
                ? { ...value, config: { ...value.config, probeAt: new Date().toISOString() } } : value, store);
            const request = () => run(signal => session.raw('GET', `/v1/data_sources/${encodeURIComponent(connection.config.dataSourceId!)}`, undefined, signal));
            let source;
            try { source = await request(); }
            catch (error) {
                if (!(error instanceof NotionApiError && error.status === 401 && error.code === 'unauthorized')) throw error;
                await session.refresh(run); source = await request();
            }
            if (source.in_trash) continue;
            const schema = parseNotionSchema(source); validateNotionMapping(connection.config.mapping, schema);
            await updateDoc<NotionConnection>(connection.pk, connection.id, value => stillCurrent(value) ? { ...value,
                status: 'connected', statusCode: undefined, updatedAt: new Date().toISOString(),
                config: { ...value.config, schema, schemaCheckedAt: new Date().toISOString() } } : value, store);
        } catch { deferred++; /* A probe failure never resets a grant or claims successful sending. */ }
    }
    if (visited !== undefined || !rows.length) {
        const cursor: ProbeCursor = { ...cursorIdentity, type: 'notion-probe-cursor', ...(visited ? { afterId: visited } : {}) };
        if (!await store.create(cursor)) await updateDoc<ProbeCursor>(cursor.pk, cursor.id, current => ({ ...current, afterId: cursor.afterId }), store);
    }
    return { calls, deferred };
}
