import { workspacePk, type DbProject } from '../../app/model';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import { isLocalRuntime } from '../../comments/environment';
import { PUBLIC_PROJECT_ID } from '../../comments/publicProject';
import { disconnectIntegration, IntegrationAccessError, setIntegrationBinding } from '../connection';
import { acquireGrantLease, GrantLeaseError, releaseGrantLease, saveGrantLease } from '../grants';
import { consumeOauthState, createOauthState } from '../oauthState';
import { decryptSecret, encryptSecret, type SecretContext } from '../secrets';
import { boundedName, NotionApiError, NotionClient, notionId, object, sameId, type JsonObject } from './client';
import { isNotionConfigured, notionAuthorizeUrl, notionKey, notionRedirectUri } from './config';
import type { NotionConnection, NotionGrant } from './model';

export type NotionServices = { store?: AppStore; client?: NotionClient };
export const notionConnectionId = (projectId: string) => `notion_${projectId}`;
export const notionGrantId = (projectId: string) => `notion_grant_${projectId}`;
const context = (grant: Pick<NotionGrant, 'workspaceId' | 'projectId' | 'id'>, field: string): SecretContext =>
    ({ provider: 'notion', workspaceId: grant.workspaceId, projectId: grant.projectId, subjectId: grant.id, field });

export async function notionAdmin(project: DbProject, userId: string, store: AppStore = getAppStore()) {
    const current = (await store.get<DbProject>(workspacePk(project.workspaceId), project.id))?.doc;
    const member = (await store.get<import('../../app/model').DbMember>(workspacePk(project.workspaceId), `member_${userId}`))?.doc;
    if (project.id === PUBLIC_PROJECT_ID || !current || current.type !== 'project' || current.workspaceId !== project.workspaceId
        || member?.type !== 'member' || member.role !== 'admin' || member.workspaceId !== project.workspaceId) throw new IntegrationAccessError();
    return current;
}
export async function storedNotionConnection(project: DbProject, store: AppStore = getAppStore()) {
    const current = (await store.get<NotionConnection>(workspacePk(project.workspaceId), notionConnectionId(project.id)))?.doc;
    return current?.type === 'notion-connection' && current.provider === 'notion' && current.projectId === project.id
        && current.workspaceId === project.workspaceId ? current : null;
}
function tokenResponse(value: JsonObject, existing?: NotionGrant) {
    if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 16_000
        || (value.refresh_token !== undefined && value.refresh_token !== null && (typeof value.refresh_token !== 'string' || !value.refresh_token || value.refresh_token.length > 16_000)))
        throw new NotionApiError(0, 'invalid_oauth_response');
    const botId = notionId(value.bot_id ?? existing?.botId);
    const workspaceId = notionId(value.workspace_id ?? existing?.notionWorkspaceId);
    if (existing && (!sameId(botId, existing.botId) || !sameId(workspaceId, existing.notionWorkspaceId)))
        throw new NotionApiError(401, 'grant_identity_changed');
    return { access: value.access_token, refresh: typeof value.refresh_token === 'string' ? value.refresh_token : undefined,
        botId, notionWorkspaceId: workspaceId, notionWorkspaceName: boundedName(value.workspace_name, existing?.notionWorkspaceName) };
}

export async function beginNotionConnect(input: { userId: string; workspaceId: string; projectId: string; baseUrl: string }, services: NotionServices = {}) {
    if (!isNotionConfigured()) throw new NotionApiError(503, 'not_configured');
    const store = services.store ?? getAppStore();
    const project = (await store.get<DbProject>(workspacePk(input.workspaceId), input.projectId))?.doc;
    if (!project) throw new IntegrationAccessError();
    await notionAdmin(project, input.userId, store);
    const { state } = await createOauthState({ provider: 'notion', ...input, pkce: false }, store);
    const url = new URL(notionAuthorizeUrl());
    url.search = new URLSearchParams({ client_id: process.env.NOTION_CLIENT_ID!, redirect_uri: notionRedirectUri(input.baseUrl),
        response_type: 'code', owner: 'user', state }).toString();
    return url.href;
}
export async function finishNotionConnect(input: { userId: string; state: unknown; code?: unknown; error?: unknown; baseUrl: string }, services: NotionServices = {}) {
    const store = services.store ?? getAppStore();
    const state = await consumeOauthState({ provider: 'notion', userId: input.userId, state: input.state, expected: { intent: 'connect' } }, store);
    if (!state) throw new NotionApiError(400, 'invalid_oauth_state');
    const result = { workspaceId: state.workspaceId, projectId: state.projectId };
    const project = (await store.get<DbProject>(workspacePk(state.workspaceId), state.projectId))?.doc;
    if (!project) throw new IntegrationAccessError();
    await notionAdmin(project, input.userId, store);
    if (input.error === 'access_denied') return { ...result, status: 'denied' as const };
    if (input.error || !isNotionConfigured() || typeof input.code !== 'string' || !input.code || input.code.length > 4096)
        return { ...result, status: 'failed' as const };
    let installedGrant: NotionGrant | undefined;
    let installedConnection: NotionConnection | undefined;
    try {
        const token = await (services.client ?? new NotionClient()).oauth({ grant_type: 'authorization_code', code: input.code,
            redirect_uri: notionRedirectUri(input.baseUrl) });
        const data = tokenResponse(token);
        // Recheck after the exchange, before credentials or a destination can be installed.
        await notionAdmin(project, input.userId, store);
        const id = notionGrantId(project.id);
        const pk = workspacePk(project.workspaceId);
        const previous = (await store.get<NotionGrant>(pk, id))?.doc;
        const grant: NotionGrant = { type: 'notion-grant', provider: 'notion', id, pk, workspaceId: project.workspaceId, projectId: project.id,
            connectedBy: input.userId, botId: data.botId, notionWorkspaceId: data.notionWorkspaceId, notionWorkspaceName: data.notionWorkspaceName,
            generation: (previous?.generation ?? 0) + 1, status: 'connected', issuedAt: new Date().toISOString() };
        grant.tokens = { access: encryptSecret(data.access, context(grant, 'access'), notionKey()),
            ...(data.refresh ? { refresh: encryptSecret(data.refresh, context(grant, 'refresh'), notionKey()) } : {}) };
        installedGrant = await store.create(grant) ? grant
            : await updateDoc<NotionGrant>(pk, id, current => ({ ...grant, generation: current.generation + 1 }), store) ?? undefined;
        if (!installedGrant) throw new NotionApiError(409, 'connection_changed');
        await notionAdmin(project, input.userId, store);
        const oldConnection = await storedNotionConnection(project, store);
        const sameWorkspace = oldConnection && sameId(oldConnection.config.notionWorkspaceId, data.notionWorkspaceId);
        const connection: NotionConnection = { type: 'notion-connection', provider: 'notion', pk, id: notionConnectionId(project.id),
            workspaceId: project.workspaceId, projectId: project.id, connectedBy: input.userId, enabled: sameWorkspace ? oldConnection.enabled : false,
            status: 'connected', destinationRevision: (oldConnection?.destinationRevision ?? 0) + 1, grantId: id,
            config: { ...(sameWorkspace ? oldConnection.config : {}), notionWorkspaceId: data.notionWorkspaceId, notionWorkspaceName: data.notionWorkspaceName },
            createdAt: oldConnection?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
        installedConnection = await store.create(connection) ? connection
            : await updateDoc<NotionConnection>(pk, connection.id, current => ({ ...connection,
                destinationRevision: Math.max(current.destinationRevision + 1, connection.destinationRevision) }), store) ?? undefined;
        const retainedGrant = (await store.get<NotionGrant>(pk, id))?.doc;
        if (!installedConnection || retainedGrant?.generation !== installedGrant.generation || retainedGrant.tokens?.access !== installedGrant.tokens?.access)
            throw new NotionApiError(409, 'connection_changed');
        await notionAdmin(project, input.userId, store);
        if (!sameWorkspace && project.integrations?.notion) await setIntegrationBinding(project.workspaceId, project.id, 'notion', null, store, oldConnection?.id);
        if (token.duplicated_template_id) {
            try { await (await import('./settings')).applyNotionTemplate(project, input.userId, token.duplicated_template_id, services); }
            catch { /* A valid grant remains available for the explicit database picker. */ }
        }
        return { ...result, status: 'connected' as const };
    } catch (error) {
        // A consumed callback cannot be retried. Do not leave an unused token pair behind when
        // installing its destination failed, and never erase a newer authorization's credentials.
        if (installedGrant) {
            const observed = installedGrant;
            await updateDoc<NotionGrant>(observed.pk, observed.id, current => {
                if (current.generation !== observed.generation || current.tokens?.access !== observed.tokens?.access) return current;
                const { tokens: _tokens, refreshLease: _lease, ...metadata } = current;
                return { ...metadata, status: 'needs_reconnect', generation: current.generation + 1 };
            }, store).catch(() => null);
        }
        if (installedConnection) {
            const observed = installedConnection;
            await updateDoc<NotionConnection>(observed.pk, observed.id, current => current.destinationRevision !== observed.destinationRevision ? current
                : { ...current, enabled: false, status: 'needs_reconnect', statusCode: 'setup_incomplete', updatedAt: new Date().toISOString() }, store).catch(() => null);
        }
        if (error instanceof IntegrationAccessError) throw error;
        return { ...result, status: 'failed' as const };
    }
}

/** A binding/grant is re-read before every credential use, including configuration actions. */
export class NotionSession {
    private usedGeneration?: number;
    readonly store: AppStore;
    readonly client: NotionClient;
    constructor(readonly connection: NotionConnection, services: NotionServices = {}, private readonly requireEnabled = false) {
        this.store = services.store ?? getAppStore(); this.client = services.client ?? new NotionClient();
    }
    async grant() {
        if (!isNotionConfigured()) throw new NotionApiError(503, 'not_configured');
        const current = (await this.store.get<NotionConnection>(this.connection.pk, this.connection.id))?.doc;
        const grant = current?.grantId ? (await this.store.get<NotionGrant>(current.pk, current.grantId))?.doc : null;
        if (!current || current.type !== 'notion-connection' || current.provider !== 'notion' || current.projectId !== this.connection.projectId
            || current.workspaceId !== this.connection.workspaceId || !grant || grant.type !== 'notion-grant' || grant.provider !== 'notion'
            || grant.projectId !== current.projectId || grant.workspaceId !== current.workspaceId || grant.connectedBy !== current.connectedBy
            || !grant.tokens || grant.status !== 'connected' || current.status === 'needs_reconnect') throw new NotionApiError(401, 'needs_reconnect');
        const member = (await this.store.get<import('../../app/model').DbMember>(workspacePk(current.workspaceId), `member_${current.connectedBy}`))?.doc;
        if (member?.type !== 'member' || member.role !== 'admin' || member.workspaceId !== current.workspaceId) {
            await this.invalidate('member_left', grant);
            throw new NotionApiError(401, 'member_left');
        }
        const project = (await this.store.get<DbProject>(workspacePk(current.workspaceId), current.projectId))?.doc;
        if (!project || project.type !== 'project' || project.workspaceId !== current.workspaceId || project.id === PUBLIC_PROJECT_ID)
            throw new NotionApiError(401, 'binding_changed');
        if (this.requireEnabled) {
            if (!current.enabled || current.destinationRevision !== this.connection.destinationRevision
                || project?.integrations?.notion?.connectionId !== current.id) throw new NotionApiError(401, 'binding_changed');
        }
        type Gate = import('../../app/model').AppDoc & { pausedUntil?: string };
        const botPause = (await this.store.get<Gate>(`notion-rate:${grant.botId}`, 'calls'))?.doc.pausedUntil;
        const workspacePause = (await this.store.get<Gate>(`notion-workspace-rate:${grant.notionWorkspaceId}`, 'pause'))?.doc.pausedUntil;
        const pausedUntil = Math.max(...[grant.pausedUntil, botPause, workspacePause].map(value => value ? Date.parse(value) || 0 : 0));
        if (pausedUntil > Date.now()) throw new NotionApiError(429, 'rate_limited', pausedUntil - Date.now());
        return grant;
    }
    async raw(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal) {
        const scheduledGrant = await this.grant();
        await this.pace(scheduledGrant, signal);
        const grant = await this.grant(); this.usedGeneration = grant.generation;
        return this.client.request(method, path, { token: decryptSecret(grant.tokens!.access, context(grant, 'access'), notionKey()), body, signal });
    }
    async request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
        try { return await this.raw(method, path, body); }
        catch (error) {
            if (!(error instanceof NotionApiError && error.status === 401 && error.code === 'unauthorized')) throw error;
            await this.refresh();
            return this.raw(method, path, body);
        }
    }
    async refresh(run: <T>(send: (signal: AbortSignal) => Promise<T>) => Promise<T> = send => send(AbortSignal.timeout(20_000))) {
        const latest = await this.grant();
        if (this.usedGeneration !== undefined && latest.generation > this.usedGeneration) return;
        if (!latest.tokens?.refresh) { await this.invalidate('invalid_grant', latest); throw new NotionApiError(401, 'invalid_grant'); }
        const authorize = async (grant: NotionGrant) => {
            const retained = await this.grant();
            return retained.id === grant.id && retained.connectedBy === grant.connectedBy && retained.generation === grant.generation;
        };
        const acquired = await acquireGrantLease<NotionGrant>({ pk: latest.pk, id: latest.id, authorize }, this.store);
        if (!acquired) throw new NotionApiError(401, 'needs_reconnect');
        try {
            const response = tokenResponse(await run(async signal => {
                const retained = await this.grant();
                if (retained.generation !== acquired.grant.generation || retained.refreshLease?.id !== acquired.lease.id
                    || Date.parse(retained.refreshLease.until) <= Date.now()) throw new GrantLeaseError('invalid_lease');
                return this.client.oauth({ grant_type: 'refresh_token',
                    refresh_token: decryptSecret(retained.tokens!.refresh!, context(retained, 'refresh'), notionKey()) }, signal);
            }), acquired.grant);
            const saved = await saveGrantLease<NotionGrant>({ pk: latest.pk, id: latest.id, lease: acquired.lease, authorize,
                update: grant => ({ ...grant, tokens: { access: encryptSecret(response.access, context(grant, 'access'), notionKey()),
                    ...(response.refresh ? { refresh: encryptSecret(response.refresh, context(grant, 'refresh'), notionKey()) } : {}) }, issuedAt: new Date().toISOString() }) }, this.store);
            if (!saved) throw new NotionApiError(401, 'needs_reconnect');
            this.usedGeneration = saved.generation;
        } catch (error) {
            if (error instanceof NotionApiError && ['invalid_grant', 'grant_identity_changed'].includes(error.code)) await this.invalidate('invalid_grant', acquired.grant);
            else await releaseGrantLease({ pk: latest.pk, id: latest.id, lease: acquired.lease }, this.store);
            throw error;
        }
    }
    async invalidate(code: string, observed: NotionGrant) {
        const saved = await updateDoc<NotionGrant>(observed.pk, observed.id, current => {
            if (current.generation !== observed.generation || current.connectedBy !== observed.connectedBy) return current;
            const { tokens: _tokens, refreshLease: _lease, ...metadata } = current;
            return { ...metadata, generation: current.generation + 1, status: 'needs_reconnect' };
        }, this.store);
        if (saved?.status === 'needs_reconnect' && !saved.tokens && saved.generation === observed.generation + 1)
            await updateDoc<NotionConnection>(this.connection.pk, this.connection.id, current => current.connectedBy !== observed.connectedBy
                || current.destinationRevision !== this.connection.destinationRevision || current.grantId !== observed.id ? current
                : ({ ...current, status: 'needs_reconnect', enabled: false, statusCode: code, updatedAt: new Date().toISOString() }), this.store);
    }
    private async pace(grant: NotionGrant, signal?: AbortSignal) {
        const interval = isLocalRuntime() && process.env.NOTION_REQUEST_INTERVAL_MS === '0' ? 0 : 400;
        if (!interval) return;
        type Gate = import('../../app/model').AppDoc & { nextAt: number };
        const id = 'calls'; const pk = `notion-rate:${grant.botId}`;
        const now = Date.now(); let slot = now;
        if (!await this.store.create<Gate>({ type: 'notion-rate', pk, id, nextAt: now + interval, ttl: 600 }))
            await updateDoc<Gate>(pk, id, current => { slot = Math.max(Date.now(), current.nextAt ?? 0); return { ...current, nextAt: slot + interval }; }, this.store);
        const wait = Math.max(0, slot - Date.now());
        if (wait > 5000 || signal?.aborted) throw new NotionApiError(429, 'local_rate_limit', Math.max(1000, wait));
        if (wait) await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(done, wait);
            const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new NotionApiError(429, 'local_rate_limit', wait)); };
            function done() { signal?.removeEventListener('abort', abort); resolve(); }
            signal?.addEventListener('abort', abort, { once: true });
        });
    }
}
export async function pauseNotion(session: NotionSession, error: NotionApiError) {
    const grant = await session.grant().catch(() => null);
    if (!grant) return;
    const workspaceLimit = error.rateLimitReason?.includes('space') === true;
    const pausedUntil = new Date(Date.now() + (error.retryAfter ?? 60_000)).toISOString();
    type Pause = import('../../app/model').AppDoc & { pausedUntil: string; nextAt?: number };
    const identity = workspaceLimit ? { pk: `notion-workspace-rate:${grant.notionWorkspaceId}`, id: 'pause' } : { pk: `notion-rate:${grant.botId}`, id: 'calls' };
    const gate: Pause = { type: 'notion-rate', ...identity, pausedUntil, ttl: Math.max(600, Math.ceil((error.retryAfter ?? 60_000) / 1000) + 60) };
    if (!await session.store.create(gate)) await updateDoc<Pause>(identity.pk, identity.id, value => ({ ...value, pausedUntil, ttl: gate.ttl }), session.store);
    const grants = await session.store.query<NotionGrant>({ type: 'notion-grant', limit: 1000, where: workspaceLimit
        ? { notionWorkspaceId: grant.notionWorkspaceId } : { botId: grant.botId } });
    for (const item of grants) {
        await updateDoc<NotionGrant>(item.pk, item.id, current => ({ ...current, pausedUntil }), session.store);
        await updateDoc<NotionConnection>(item.pk, notionConnectionId(item.projectId), current => current.grantId !== item.id ? current
            : ({ ...current, pausedUntil }), session.store);
    }
}
export async function revokeNotionAdmin(workspaceId: string, userId: string, store = getAppStore()) {
    for (const grant of await store.query<NotionGrant>({ type: 'notion-grant', pk: workspacePk(workspaceId), where: { connectedBy: userId } })) {
        await updateDoc<NotionGrant>(grant.pk, grant.id, current => {
            if (current.connectedBy !== userId) return current;
            const { tokens: _tokens, refreshLease: _lease, ...metadata } = current;
            return { ...metadata, status: 'needs_reconnect', generation: current.generation + 1 };
        }, store);
    }
}
export async function disconnectNotion(project: DbProject, userId: string, services: NotionServices = {}) {
    const store = services.store ?? getAppStore(); const current = await notionAdmin(project, userId, store);
    const connection = await storedNotionConnection(current, store);
    const observedGrant = connection?.grantId ? (await store.get<NotionGrant>(connection.pk, connection.grantId))?.doc : null;
    if (current.integrations?.notion) await disconnectIntegration(current, 'notion', store);
    else if (connection) await updateDoc<NotionConnection>(connection.pk, connection.id, value => ({ ...value, enabled: false, status: 'needs_reconnect', statusCode: 'disconnected' }), store);
    if (connection?.grantId && observedGrant) await updateDoc<NotionGrant>(connection.pk, connection.grantId, grant => {
        if (grant.generation !== observedGrant.generation || grant.connectedBy !== observedGrant.connectedBy) return grant;
        const { tokens: _tokens, refreshLease: _lease, ...metadata } = grant;
        return { ...metadata, status: 'revoked', generation: grant.generation + 1 };
    }, store);
}
export { GrantLeaseError };
