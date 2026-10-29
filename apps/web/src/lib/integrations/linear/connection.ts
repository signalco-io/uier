import { randomUUID } from 'node:crypto';
import { memberId, workspacePk, type DbMember, type DbProject } from '../../app/model';
import { getAppStore, updateDoc } from '../../app/store';
import { sha256Hex } from '../../app/tokens';
import { PUBLIC_PROJECT_ID } from '../../comments/publicProject';
import { disconnectIntegration, setIntegrationBinding } from '../connection';
import { acquireGrantLease, releaseGrantLease, saveGrantLease, GrantLeaseError } from '../grants';
import { createOauthState, consumeOauthState } from '../oauthState';
import { decryptSecret, encryptSecret } from '../secrets';
import { bounded, field, linearGraphql, linearToken, LinearApiError, object, uuid, type LinearToken } from './client';
import { isLinearConfigured, linearCallback, linearConfig, linearKey } from './config';
import type { LinearConnection, LinearGrant, LinearInstallation, LinearSelection } from './model';

export class LinearSetupError extends Error {
    constructor(public readonly code: string) { super('Linear could not complete this connection. Try again from project settings.'); this.name = 'LinearSetupError'; }
}
const grantIdFor = (clientId: string, organizationId: string) => `linear_grant_${sha256Hex(`${clientId}:${organizationId}`)}`;
const claimPkFor = (clientId: string, organizationId: string) => `linear-installation:${sha256Hex(`${clientId}:${organizationId}`)}`;
export const grantId = (organizationId: string) => grantIdFor(linearConfig().clientId, organizationId);
export const claimPk = (organizationId: string) => claimPkFor(linearConfig().clientId, organizationId);
const selectionId = (projectId: string) => `linear_selection_${projectId}`;
const nowIso = () => new Date().toISOString();
const secretContext = (grant: Pick<LinearGrant, 'workspaceId' | 'organizationId' | 'id'>, field: string) =>
    ({ provider: 'linear', workspaceId: grant.workspaceId, subjectId: grant.id, projectId: grant.organizationId, field });

export async function requireLinearAdmin(project: DbProject, userId: string) {
    const store = getAppStore();
    const current = (await store.get<DbProject>(workspacePk(project.workspaceId), project.id))?.doc;
    const member = (await store.get<DbMember>(workspacePk(project.workspaceId), memberId(userId)))?.doc;
    if (!current || current.type !== 'project' || current.workspaceId !== project.workspaceId || current.id === PUBLIC_PROJECT_ID
        || member?.type !== 'member' || member.workspaceId !== current.workspaceId || member.userId !== userId || member.role !== 'admin')
        throw new LinearSetupError('admin_required');
    return current;
}

export async function linearConnection(project: DbProject): Promise<LinearConnection | null> {
    const store = getAppStore();
    const selection = (await store.get<LinearSelection>(project.pk, selectionId(project.id)))?.doc;
    const id = project.integrations?.linear?.connectionId ?? (selection?.type === 'linear-selection' && selection.projectId === project.id ? selection.connectionId : undefined);
    const connection = id ? (await store.get<LinearConnection>(project.pk, id))?.doc : null;
    return connection?.type === 'linear-connection' && connection.provider === 'linear' && connection.projectId === project.id
        && connection.workspaceId === project.workspaceId ? connection : null;
}

export async function currentLinearGrant(connection: LinearConnection) {
    const grant = (await getAppStore().get<LinearGrant>(connection.pk, connection.grantId))?.doc;
    if (!grant || grant.type !== 'linear-grant' || grant.provider !== 'linear' || grant.workspaceId !== connection.workspaceId
        || grant.clientId !== linearConfig().clientId) throw new LinearSetupError('grant_unavailable');
    return grant;
}

async function grantAuthority(grant: LinearGrant, connection?: LinearConnection, operationId?: string, clientId = linearConfig().clientId) {
    const store = getAppStore();
    const claim = (await store.get<LinearInstallation>(claimPkFor(clientId, grant.organizationId), 'owner'))?.doc;
    if (!claim || claim.type !== 'linear-installation-claim' || claim.workspaceId !== grant.workspaceId || claim.grantId !== grant.id
        || claim.status !== 'active' || grant.clientId !== clientId || claim.clientId !== clientId
        || (claim.operation && claim.operation.id !== operationId && Date.parse(claim.operation.until) > Date.now())) return false;
    const candidates = connection ? [connection] : (await store.query<LinearConnection>({ type: 'linear-connection', pk: grant.pk, limit: 1000 }))
        .filter(candidate => candidate.grantId === grant.id || candidate.retiredGrantIds?.includes(grant.id));
    for (const candidate of candidates) {
        const latest = (await store.get<LinearConnection>(candidate.pk, candidate.id))?.doc;
        if (!latest || (latest.grantId !== grant.id && !latest.retiredGrantIds?.includes(grant.id)) || latest.statusCode === 'disconnected' || latest.statusCode === 'member_left') continue;
        const member = (await store.get<DbMember>(latest.pk, memberId(latest.connectedBy)))?.doc;
        const project = (await store.get<DbProject>(latest.pk, latest.projectId))?.doc;
        if (member?.type === 'member' && member.role === 'admin' && member.userId === latest.connectedBy && member.workspaceId === grant.workspaceId
            && project?.type === 'project' && project.workspaceId === grant.workspaceId && project.id !== PUBLIC_PROJECT_ID) return true;
    }
    if (!connection && candidates.length === 1000) throw new LinearSetupError('installation_authority_limit');
    return false;
}

async function claimInstallation(organizationId: string, workspaceId: string, operationId: string, clientId = linearConfig().clientId) {
    const store = getAppStore();
    const pk = claimPkFor(clientId, organizationId);
    const time = nowIso();
    const next: LinearInstallation = { type: 'linear-installation-claim', provider: 'linear', pk, id: 'owner', organizationId,
        clientId, workspaceId, grantId: grantIdFor(clientId, organizationId), status: 'reserved',
        operation: { id: operationId, until: new Date(Date.now() + 120_000).toISOString() }, reservedBy: operationId, createdAt: time, updatedAt: time };
    if (await store.create(next)) return next;
    const stale = await store.get<LinearInstallation>(pk, 'owner');
    if (stale?.doc.type === 'linear-installation-claim' && stale.doc.status === 'reserved'
        && (!stale.doc.operation || Date.parse(stale.doc.operation.until) <= Date.now())) {
        const committed = (await store.get<LinearGrant>(workspacePk(stale.doc.workspaceId), stale.doc.grantId))?.doc;
        if (!committed?.access && !committed?.refresh)
            await store.replace({ ...stale.doc, status: 'vacant', operation: undefined, updatedAt: time }, stale.etag);
    }
    const saved = await updateDoc<LinearInstallation>(pk, 'owner', current => {
        if (current.status === 'vacant') return { ...next, createdAt: current.createdAt };
        if (current.type !== next.type || current.clientId !== next.clientId || current.organizationId !== organizationId || current.workspaceId !== workspaceId)
            throw new LinearSetupError('installation_owned_by_another_workspace');
        if (current.operation && current.operation.id !== operationId && Date.parse(current.operation.until) > Date.now()) throw new LinearSetupError('installation_busy');
        return { ...current, operation: next.operation, updatedAt: time };
    }, store);
    if (!saved) throw new LinearSetupError('installation_changed');
    return saved;
}

async function assertClaim(organizationId: string, workspaceId: string, operationId: string) {
    const claim = (await getAppStore().get<LinearInstallation>(claimPk(organizationId), 'owner'))?.doc;
    if (!claim || claim.workspaceId !== workspaceId || claim.operation?.id !== operationId
        || Date.parse(claim.operation.until) <= Date.now() || claim.status === 'vacant') throw new LinearSetupError('installation_changed');
}

async function releaseClaim(organizationId: string, operationId: string, active: boolean, clientId = linearConfig().clientId) {
    await updateDoc<LinearInstallation>(claimPkFor(clientId, organizationId), 'owner', current => current.operation?.id !== operationId ? current
        : ({ ...current, operation: undefined, status: active ? 'active' : current.status, updatedAt: nowIso() }));
}

function encryptedTokens(grant: Pick<LinearGrant, 'workspaceId' | 'organizationId' | 'id'>, token: LinearToken) {
    return { access: encryptSecret(token.accessToken, secretContext(grant, 'access'), linearKey()),
        refresh: encryptSecret(token.refreshToken, secretContext(grant, 'refresh'), linearKey()), expiresAt: token.expiresAt, scopes: token.scopes };
}

async function attachGrant(project: DbProject, userId: string, grant: LinearGrant) {
    const operationId = `attach:${randomUUID()}`;
    await claimInstallation(grant.organizationId, project.workspaceId, operationId);
    try {
        await requireLinearAdmin(project, userId);
        const latest = (await getAppStore().get<LinearGrant>(grant.pk, grant.id))?.doc;
        if (!latest || latest.status !== 'connected' || latest.generation !== grant.generation) throw new LinearSetupError('grant_changed');
        return await attachGrantLocked(project, userId, grant);
    } finally { await releaseClaim(grant.organizationId, operationId, true); }
}

async function attachGrantLocked(project: DbProject, userId: string, grant: LinearGrant) {
    const store = getAppStore();
    const existing = await linearConnection(project);
    const compatible = existing && existing.statusCode !== 'disconnected';
    const sameGrant = existing?.grantId === grant.id;
    const time = nowIso();
    const connection: LinearConnection = compatible ? { ...existing, connectedBy: userId, grantId: grant.id,
        ...(!sameGrant ? { enabled: false, config: {}, destinationRevision: existing.destinationRevision + 1,
            retiredGrantIds: [...new Set([...(existing.retiredGrantIds ?? []), existing.grantId])] } : {}), status: 'connected', statusCode: undefined, updatedAt: time } : { type: 'linear-connection', provider: 'linear', pk: project.pk, id: `linear_${project.id}_${randomUUID()}`,
        workspaceId: project.workspaceId, projectId: project.id, connectedBy: userId, grantId: grant.id,
        enabled: false, status: 'connected', destinationRevision: 1, config: {}, createdAt: time, updatedAt: time };
    if (compatible) {
        await updateDoc<LinearConnection>(connection.pk, connection.id, current => {
            if (current.grantId !== existing.grantId || current.destinationRevision !== existing.destinationRevision) throw new LinearSetupError('connection_changed');
            return { ...connection, destinationRevision: sameGrant ? current.destinationRevision : current.destinationRevision + 1 };
        });
    } else {
        if (existing && project.integrations?.linear?.connectionId === existing.id) await disconnectIntegration(project, 'linear');
        if (!await store.create(connection)) throw new LinearSetupError('connection_conflict');
    }
    const selection: LinearSelection = { type: 'linear-selection', pk: project.pk, id: selectionId(project.id), projectId: project.id, connectionId: connection.id };
    if (!await store.create(selection)) await updateDoc<LinearSelection>(selection.pk, selection.id, current => ({ ...current, connectionId: connection.id }));
    return connection;
}

export async function beginLinearConnect(input: { userId: string; workspaceId: string; projectId: string; baseUrl: string }) {
    if (!isLinearConfigured()) throw new LinearSetupError('not_configured');
    const supplied = { id: input.projectId, workspaceId: input.workspaceId } as DbProject;
    const project = await requireLinearAdmin(supplied, input.userId);
    const current = await linearConnection(project);
    if (!current || current.status === 'connected') {
        const grants = await getAppStore().query<LinearGrant>({ type: 'linear-grant', pk: project.pk, where: { status: 'connected', clientId: linearConfig().clientId } });
        const usable = [] as LinearGrant[];
        for (const grant of grants) {
            const claim = (await getAppStore().get<LinearInstallation>(claimPk(grant.organizationId), 'owner'))?.doc;
            if (claim?.operation && Date.parse(claim.operation.until) > Date.now()) throw new LinearSetupError('installation_busy');
            if (await grantAuthority(grant)) usable.push(grant);
        }
        if (usable.length === 1) {
            await attachGrant(project, input.userId, usable[0]!);
            return new URL(`/app/projects/${project.id}/settings?linear=connected#linear`, input.baseUrl).href;
        }
    }
    const state = await createOauthState({ provider: 'linear', userId: input.userId, workspaceId: project.workspaceId,
        projectId: project.id, pkce: true, key: linearKey(), metadata: current ? { grantId: current.grantId } : undefined });
    const url = new URL(linearConfig().authorizeUrl);
    url.search = new URLSearchParams({ client_id: linearConfig().clientId, redirect_uri: linearCallback(input.baseUrl), response_type: 'code',
        scope: 'read,write', actor: 'app', prompt: 'consent', state: state.state,
        code_challenge: state.codeChallenge!, code_challenge_method: 'S256' }).toString();
    return url.href;
}

export async function finishLinearConnect(input: { userId: string; code?: string; state?: unknown; error?: string; baseUrl: string }) {
    const state = await consumeOauthState({ provider: 'linear', userId: input.userId, state: input.state, key: linearKey() });
    if (!state) throw new LinearSetupError('invalid_state');
    const result = { workspaceId: state.workspaceId, projectId: state.projectId };
    const project = await requireLinearAdmin({ id: state.projectId, workspaceId: state.workspaceId } as DbProject, input.userId);
    if (input.error === 'access_denied') return { ...result, status: 'denied' as const };
    if (input.error || !input.code || !state.codeVerifier || !isLinearConfigured()) return { ...result, status: 'failed' as const };
    let organizationId: string | undefined;
    let claimed = false; let installed: LinearGrant | undefined;
    const operationId = state.id + ':' + sha256Hex(String(input.state));
    try {
        if (state.metadata?.grantId) {
            const known = (await getAppStore().get<LinearGrant>(project.pk, state.metadata.grantId))?.doc;
            if (known?.type === 'linear-grant' && known.clientId === linearConfig().clientId) {
                organizationId = known.organizationId;
                await claimInstallation(organizationId, project.workspaceId, operationId); claimed = true;
                const latest = (await getAppStore().get<LinearGrant>(known.pk, known.id))?.doc;
                if (latest?.refreshLease && Date.parse(latest.refreshLease.until) > Date.now()) throw new LinearSetupError('refresh_busy');
            }
        }
        const token = await linearToken({ code: input.code, code_verifier: state.codeVerifier, redirect_uri: linearCallback(input.baseUrl), grant_type: 'authorization_code' });
        const identity = await linearGraphql(token.accessToken, 'UierLinearIdentity',
            'query UierLinearIdentity { viewer { id app active } organization { id name urlKey } }', {}, data => {
                const viewer = field(data, 'viewer'); const organization = field(data, 'organization');
                if (!uuid(viewer.id) || viewer.app !== true || viewer.active !== true || !uuid(organization.id)
                    || !bounded(organization.name, 100) || typeof organization.urlKey !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(organization.urlKey)) throw new LinearSetupError('invalid_identity');
                return { appUserId: viewer.id, organizationId: organization.id, organizationName: bounded(organization.name, 100), organizationSlug: organization.urlKey };
            });
        if (claimed && organizationId && organizationId !== identity.organizationId) {
            await releaseClaim(organizationId, operationId, true); claimed = false;
        }
        organizationId = identity.organizationId;
        await claimInstallation(organizationId, project.workspaceId, operationId); claimed = true;
        const store = getAppStore();
        const id = grantId(organizationId); const time = nowIso();
        const previous = (await store.get<LinearGrant>(project.pk, id))?.doc;
        const grant: LinearGrant = { type: 'linear-grant', provider: 'linear', id, pk: project.pk, workspaceId: project.workspaceId,
            clientId: linearConfig().clientId, ...identity, authorizedBy: input.userId, generation: (previous?.generation ?? 0) + 1,
            status: 'connected', createdAt: previous?.createdAt ?? time, updatedAt: time,
            ...encryptedTokens({ id, workspaceId: project.workspaceId, organizationId }, token) };
        await requireLinearAdmin(project, input.userId);
        await assertClaim(organizationId, project.workspaceId, operationId);
        installed = grant;
        if (!await store.create(grant)) {
            const stored = await store.get<LinearGrant>(project.pk, id);
            if (!stored || stored.doc.generation !== previous?.generation || stored.doc.workspaceId !== project.workspaceId
                || (stored.doc.refreshLease && Date.parse(stored.doc.refreshLease.until) > Date.now()) || await store.replace(grant, stored.etag) !== 'ok')
                throw new LinearSetupError('grant_changed');
        }
        await assertClaim(organizationId, project.workspaceId, operationId);
        await attachGrantLocked(await requireLinearAdmin(project, input.userId), input.userId, grant);
        await releaseClaim(organizationId, operationId, true);
        return { ...result, status: 'connected' as const };
    } catch {
        if (claimed && organizationId) {
            if (installed && !await grantAuthority(installed, undefined, operationId).catch(() => true)) {
                const observed = installed;
                await updateDoc<LinearGrant>(observed.pk, observed.id, current => current.generation !== observed.generation ? current
                    : { ...current, status: 'disconnected', access: undefined, refresh: undefined, refreshLease: undefined,
                        generation: current.generation + 1, updatedAt: nowIso() }).catch(() => undefined);
            }
            const committed = (await getAppStore().get<LinearGrant>(project.pk, grantId(organizationId)))?.doc;
            if (!committed?.access && !committed?.refresh) await updateDoc<LinearInstallation>(claimPk(organizationId), 'owner', current =>
                current.operation?.id !== operationId || current.reservedBy !== operationId || current.status !== 'reserved' ? current
                    : { ...current, status: 'vacant', operation: undefined, updatedAt: nowIso() }).catch(() => undefined);
            await releaseClaim(organizationId, operationId, false).catch(() => undefined);
        }
        return { ...result, status: 'failed' as const };
    }
}

export type LinearCall = <T>(send: (signal: AbortSignal) => Promise<T>) => Promise<T>;
const defaultCall: LinearCall = send => send(AbortSignal.timeout(20_000));

export async function linearAccessToken(connection: LinearConnection, call: LinearCall = defaultCall, force = false) {
    const store = getAppStore();
    const grant = await currentLinearGrant(connection);
    const claim = (await store.get<LinearInstallation>(claimPk(grant.organizationId), 'owner'))?.doc;
    if (claim?.operation && Date.parse(claim.operation.until) > Date.now()) throw new GrantLeaseError('busy');
    if (grant.status !== 'connected' || !grant.access || !grant.refresh || !await grantAuthority(grant, connection)) throw new LinearSetupError('needs_reconnect');
    if (grant.pausedUntil && Date.parse(grant.pausedUntil) > Date.now()) throw new LinearApiError('rate_limited', 429, grant.pausedUntil, undefined, true);
    if (!force && !grant.refreshStartedAt && grant.expiresAt && Date.parse(grant.expiresAt) > Date.now() + 60_000)
        return decryptSecret(grant.access, secretContext(grant, 'access'), linearKey());
    const authorize = (current: LinearGrant) => grantAuthority(current, connection);
    const leased = await acquireGrantLease<LinearGrant>({ pk: grant.pk, id: grant.id, authorize }, store);
    if (!leased) throw new LinearSetupError('needs_reconnect');
    try {
        const current = leased.grant;
        if (!force && !current.refreshStartedAt && current.expiresAt && Date.parse(current.expiresAt) > Date.now() + 60_000) {
            await releaseGrantLease({ pk: grant.pk, id: grant.id, lease: leased.lease }, store);
            return decryptSecret(current.access!, secretContext(current, 'access'), linearKey());
        }
        const started = current.refreshStartedAt ? Date.parse(current.refreshStartedAt) : Date.now();
        if (Date.now() - started > 30 * 60_000) throw new LinearSetupError('refresh_recovery_expired');
        await updateDoc<LinearGrant>(grant.pk, grant.id, value => {
            if (value.refreshLease?.id !== leased.lease.id) throw new GrantLeaseError('busy');
            return { ...value, refreshStartedAt: value.refreshStartedAt ?? nowIso() };
        });
        const refreshToken = decryptSecret(current.refresh!, secretContext(current, 'refresh'), linearKey());
        const token = await call(signal => linearToken({ refresh_token: refreshToken, grant_type: 'refresh_token' }, signal));
        const saved = await saveGrantLease<LinearGrant>({ pk: grant.pk, id: grant.id, lease: leased.lease, authorize,
            update: value => ({ ...value, ...encryptedTokens(value, token), refreshStartedAt: undefined, updatedAt: nowIso() }) }, store);
        if (!saved?.access) throw new LinearSetupError('grant_changed');
        return decryptSecret(saved.access, secretContext(saved, 'access'), linearKey());
    } catch (error) {
        if (error instanceof LinearApiError && error.code === 'invalid_grant' || error instanceof LinearSetupError && error.code === 'refresh_recovery_expired')
            await invalidateLinearGrant(grant, 'needs_reconnect');
        else await releaseGrantLease({ pk: grant.pk, id: grant.id, lease: leased.lease }, store).catch(() => undefined);
        throw error;
    }
}

export async function invalidateLinearGrant(grant: LinearGrant, code: string) {
    const invalidated = await updateDoc<LinearGrant>(grant.pk, grant.id, current => current.generation !== grant.generation ? current : ({ ...current,
        status: 'needs_reconnect', statusCode: code, access: undefined, refresh: undefined, refreshLease: undefined,
        generation: current.generation + 1, updatedAt: nowIso() }));
    if (invalidated?.status !== 'needs_reconnect' || invalidated.generation !== grant.generation + 1) return;
    for (const connection of await getAppStore().query<LinearConnection>({ type: 'linear-connection', pk: grant.pk, where: { grantId: grant.id } })) {
        const latest = (await getAppStore().get<LinearGrant>(grant.pk, grant.id))?.doc;
        if (latest?.generation !== invalidated.generation || latest.status !== 'needs_reconnect') return;
        await updateDoc<LinearConnection>(connection.pk, connection.id, current => current.updatedAt !== connection.updatedAt ? current
            : ({ ...current, status: 'needs_reconnect', statusCode: code, updatedAt: nowIso() }));
    }
}

export async function pauseLinearGrant(grant: LinearGrant, retryAt: string) {
    await updateDoc<LinearGrant>(grant.pk, grant.id, current => ({ ...current, pausedUntil: retryAt, updatedAt: nowIso() }));
}

export async function wipeUnusedLinearGrant(workspaceId: string, id: string) {
    const store = getAppStore();
    const grant = (await store.get<LinearGrant>(workspacePk(workspaceId), id))?.doc;
    if (!grant || grant.type !== 'linear-grant') return;
    const operationId = `disconnect:${randomUUID()}`;
    await claimInstallation(grant.organizationId, workspaceId, operationId, grant.clientId);
    try {
    if (await grantAuthority(grant, undefined, operationId, grant.clientId)) return;
    let token: string | undefined;
    try { token = isLinearConfigured() && grant.clientId === linearConfig().clientId && grant.access
        ? decryptSecret(grant.access, secretContext(grant, 'access'), linearKey()) : undefined; }
    catch { /* Local erasure still completes when an obsolete key cannot revoke the remote grant. */ }
    // Disable locally first so a late refresh cannot resurrect the grant.
    await updateDoc<LinearGrant>(grant.pk, grant.id, current => ({ ...current, status: 'disconnected', access: undefined,
        refresh: undefined, refreshLease: undefined, generation: current.generation + 1, updatedAt: nowIso() }));
    if (token) await fetch(linearConfig().revokeUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => undefined);
    await updateDoc<LinearInstallation>(claimPkFor(grant.clientId, grant.organizationId), 'owner', current => current.workspaceId !== workspaceId ? current
        : ({ ...current, status: 'disconnected', operation: undefined, updatedAt: nowIso() }));
    } finally { await releaseClaim(grant.organizationId, operationId, false, grant.clientId); }
}

export async function disconnectLinear(project: DbProject, userId: string) {
    const current = await requireLinearAdmin(project, userId);
    const connection = await linearConnection(current);
    if (!connection) return;
    if (current.integrations?.linear?.connectionId === connection.id) await disconnectIntegration(current, 'linear');
    else await updateDoc<LinearConnection>(connection.pk, connection.id, value => ({ ...value, enabled: false, status: 'needs_reconnect', statusCode: 'disconnected', updatedAt: nowIso() }));
    for (const id of new Set([connection.grantId, ...(connection.retiredGrantIds ?? [])])) await wipeUnusedLinearGrant(current.workspaceId, id);
}

export async function setLinearEnabled(project: DbProject, userId: string, enabled: boolean) {
    const current = await requireLinearAdmin(project, userId);
    const connection = await linearConnection(current);
    if (!connection) throw new LinearSetupError('destination_required');
    if (!enabled) {
        await updateDoc<LinearConnection>(connection.pk, connection.id, value => {
            if (value.destinationRevision !== connection.destinationRevision || value.connectedBy !== connection.connectedBy)
                throw new LinearSetupError('connection_changed');
            return { ...value, enabled: false, updatedAt: nowIso() };
        });
        return;
    }
    if (!uuid(connection.config.teamId)) throw new LinearSetupError('destination_required');
    const grant = await currentLinearGrant(connection);
    if (grant.status !== 'connected' || !grant.access || !grant.refresh || !await grantAuthority(grant, connection)) throw new LinearSetupError('needs_reconnect');
    await updateDoc<LinearConnection>(connection.pk, connection.id, value => ({ ...value, enabled, status: 'connected', statusCode: undefined, updatedAt: nowIso() }));
    if (!current.integrations?.linear) await setIntegrationBinding(current.workspaceId, current.id, 'linear', { connectionId: connection.id, since: nowIso() });
}
