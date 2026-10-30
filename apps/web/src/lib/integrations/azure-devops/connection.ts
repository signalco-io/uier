import { randomUUID } from 'node:crypto';
import { memberId, workspacePk, type DbMember, type DbProject } from '../../app/model';
import { getAppStore, updateDoc } from '../../app/store';
import { sha256Hex } from '../../app/tokens';
import { PUBLIC_PROJECT_ID } from '../../comments/publicProject';
import { disconnectIntegration, setIntegrationBinding } from '../connection';
import { acquireGrantLease, releaseGrantLease, saveGrantLease } from '../grants';
import { consumeOauthState, createOauthState } from '../oauthState';
import { decryptSecret, encryptSecret } from '../secrets';
import { AzureDevOpsApiError, azureDevOpsProfileUrl, azureDevOpsRequest, azureDevOpsToken, bounded, object, type AzureDevOpsToken } from './client';
import { azureDevOpsCallback, azureDevOpsConfig, azureDevOpsKey, azureDevOpsScopes, guid, isAzureDevOpsConfigured, validOrganization } from './config';
import type { AzureDevOpsConnection, AzureDevOpsGrant, AzureDevOpsSelection } from './model';

export class AzureDevOpsSetupError extends Error {
    constructor(public readonly code: string) { super('Azure DevOps could not complete this connection. Try again from project settings.'); this.name = 'AzureDevOpsSetupError'; }
}
const selectionId = (projectId: string) => `azure_devops_selection_${projectId}`;
export const azureDevOpsGrantId = (connectionId: string) => `azure_devops_grant_${sha256Hex(connectionId)}`;
const nowIso = () => new Date().toISOString();
const secretContext = (grant: Pick<AzureDevOpsGrant, 'workspaceId' | 'projectId' | 'id' | 'connectionId'>, field: string) =>
    ({ provider: 'azure-devops', workspaceId: grant.workspaceId, subjectId: `${grant.id}:${grant.connectionId}`, projectId: grant.projectId, field });

export async function requireAzureDevOpsAdmin(project: DbProject, userId: string) {
    const store = getAppStore();
    const current = (await store.get<DbProject>(workspacePk(project.workspaceId), project.id))?.doc;
    const member = (await store.get<DbMember>(workspacePk(project.workspaceId), memberId(userId)))?.doc;
    if (!current || current.type !== 'project' || current.workspaceId !== project.workspaceId || current.id === PUBLIC_PROJECT_ID
        || member?.type !== 'member' || member.workspaceId !== current.workspaceId || member.userId !== userId || member.role !== 'admin')
        throw new AzureDevOpsSetupError('admin_required');
    return current;
}

/** The bound connection, or before a destination is saved, the one this project's selection points to. */
export async function azureDevOpsConnection(project: DbProject): Promise<AzureDevOpsConnection | null> {
    const store = getAppStore();
    const selection = (await store.get<AzureDevOpsSelection>(project.pk, selectionId(project.id)))?.doc;
    const id = project.integrations?.['azure-devops']?.connectionId
        ?? (selection?.type === 'azure-devops-selection' && selection.projectId === project.id ? selection.connectionId : undefined);
    const connection = id ? (await store.get<AzureDevOpsConnection>(project.pk, id))?.doc : null;
    return connection?.type === 'azure-devops-connection' && connection.provider === 'azure-devops' && connection.projectId === project.id
        && connection.workspaceId === project.workspaceId ? connection : null;
}

export async function currentAzureDevOpsGrant(connection: AzureDevOpsConnection) {
    const grant = (await getAppStore().get<AzureDevOpsGrant>(connection.pk, connection.grantId))?.doc;
    if (!grant || grant.type !== 'azure-devops-grant' || grant.provider !== 'azure-devops' || grant.workspaceId !== connection.workspaceId
        || grant.connectionId !== connection.id || grant.projectId !== connection.projectId || grant.clientId !== azureDevOpsConfig().clientId)
        throw new AzureDevOpsSetupError('grant_unavailable');
    return grant;
}

/** A grant belongs to exactly one connection; it is usable only while that connection's admin still is one. */
async function grantAuthority(grant: AzureDevOpsGrant) {
    const store = getAppStore();
    const connection = (await store.get<AzureDevOpsConnection>(grant.pk, grant.connectionId))?.doc;
    if (connection?.type !== 'azure-devops-connection' || connection.grantId !== grant.id || connection.projectId !== grant.projectId
        || connection.workspaceId !== grant.workspaceId || connection.statusCode === 'disconnected' || connection.statusCode === 'member_left') return false;
    const member = (await store.get<DbMember>(connection.pk, memberId(connection.connectedBy)))?.doc;
    const project = (await store.get<DbProject>(connection.pk, connection.projectId))?.doc;
    return member?.type === 'member' && member.role === 'admin' && member.userId === connection.connectedBy && member.workspaceId === grant.workspaceId
        && project?.type === 'project' && project.workspaceId === grant.workspaceId && project.id !== PUBLIC_PROJECT_ID;
}

function encryptedTokens(grant: Pick<AzureDevOpsGrant, 'workspaceId' | 'projectId' | 'id' | 'connectionId'>, token: AzureDevOpsToken) {
    return { access: encryptSecret(token.accessToken, secretContext(grant, 'access'), azureDevOpsKey()),
        refresh: encryptSecret(token.refreshToken, secretContext(grant, 'refresh'), azureDevOpsKey()), expiresAt: token.expiresAt, scopes: token.scopes };
}

export async function beginAzureDevOpsConnect(input: { userId: string; workspaceId: string; projectId: string; baseUrl: string }) {
    if (!isAzureDevOpsConfigured()) throw new AzureDevOpsSetupError('not_configured');
    const project = await requireAzureDevOpsAdmin({ id: input.projectId, workspaceId: input.workspaceId } as DbProject, input.userId);
    const state = await createOauthState({ provider: 'azure-devops', userId: input.userId, workspaceId: project.workspaceId,
        projectId: project.id, pkce: true, key: azureDevOpsKey() });
    const url = new URL(azureDevOpsConfig().authorizeUrl);
    url.search = new URLSearchParams({ client_id: azureDevOpsConfig().clientId, response_type: 'code', response_mode: 'query',
        redirect_uri: azureDevOpsCallback(input.baseUrl), scope: azureDevOpsScopes.join(' '), prompt: 'select_account',
        state: state.state, code_challenge: state.codeChallenge!, code_challenge_method: 'S256' }).toString();
    return url.href;
}

/** The signed-in Microsoft user's Azure DevOps profile. Requires `vso.profile`. */
export async function azureDevOpsProfile(token: string, signal?: AbortSignal) {
    return azureDevOpsRequest(token, azureDevOpsProfileUrl('_apis/profile/profiles/me'), { signal, bucketKey: `profile:${sha256Hex(token)}` }, ({ body }) => {
        if (!object(body) || !guid(body.id) || !bounded(body.displayName, 100)) throw new AzureDevOpsApiError('invalid_identity');
        return { id: body.id.toLowerCase(), displayName: bounded(body.displayName, 100) };
    });
}

export async function finishAzureDevOpsConnect(input: { userId: string; code?: string; state?: unknown; error?: string; baseUrl: string }) {
    const state = await consumeOauthState({ provider: 'azure-devops', userId: input.userId, state: input.state, key: azureDevOpsKey() });
    if (!state) throw new AzureDevOpsSetupError('invalid_state');
    const result = { workspaceId: state.workspaceId, projectId: state.projectId };
    const project = await requireAzureDevOpsAdmin({ id: state.projectId, workspaceId: state.workspaceId } as DbProject, input.userId);
    if (input.error === 'access_denied') return { ...result, status: 'denied' as const };
    if (input.error || !input.code || !state.codeVerifier || !isAzureDevOpsConfigured()) return { ...result, status: 'failed' as const };
    let created: AzureDevOpsGrant | undefined;
    try {
        const token = await azureDevOpsToken({ grant_type: 'authorization_code', code: input.code, code_verifier: state.codeVerifier,
            redirect_uri: azureDevOpsCallback(input.baseUrl) });
        const profile = await azureDevOpsProfile(token.accessToken);
        const current = await requireAzureDevOpsAdmin(project, input.userId);
        const store = getAppStore();
        const existing = await azureDevOpsConnection(current);
        const time = nowIso();
        if (existing && existing.statusCode !== 'disconnected') {
            // Reconnect keeps the connection, destination and ledgers; only the credentials change.
            const stored = await store.get<AzureDevOpsGrant>(existing.pk, existing.grantId);
            if (stored?.doc.refreshLease && Date.parse(stored.doc.refreshLease.until) > Date.now()) throw new AzureDevOpsSetupError('refresh_busy');
            const identity = { id: existing.grantId, workspaceId: current.workspaceId, projectId: current.id, connectionId: existing.id };
            const grant: AzureDevOpsGrant = { type: 'azure-devops-grant', provider: 'azure-devops', pk: current.pk, ...identity,
                clientId: azureDevOpsConfig().clientId, userId: profile.id, userName: profile.displayName, authorizedBy: input.userId,
                generation: (stored?.doc.generation ?? 0) + 1, status: 'connected', createdAt: stored?.doc.createdAt ?? time, updatedAt: time,
                ...encryptedTokens(identity, token) };
            if (stored ? await store.replace(grant, stored.etag) !== 'ok' : !await store.create(grant)) throw new AzureDevOpsSetupError('grant_changed');
            const sameUser = stored?.doc.userId === profile.id;
            await updateDoc<AzureDevOpsConnection>(existing.pk, existing.id, value => {
                if (value.grantId !== existing.grantId || value.destinationRevision !== existing.destinationRevision) throw new AzureDevOpsSetupError('connection_changed');
                // Another Microsoft user may not reach the saved destination: sending waits for an explicit save.
                return { ...value, connectedBy: input.userId, status: 'connected', statusCode: undefined, enabled: sameUser && value.enabled, updatedAt: time };
            });
            return { ...result, status: 'connected' as const };
        }
        if (existing && current.integrations?.['azure-devops']?.connectionId === existing.id) await disconnectIntegration(current, 'azure-devops');
        const connectionId = `azure_devops_${current.id}_${randomUUID()}`;
        const identity = { id: azureDevOpsGrantId(connectionId), workspaceId: current.workspaceId, projectId: current.id, connectionId };
        created = { type: 'azure-devops-grant', provider: 'azure-devops', pk: current.pk, ...identity, clientId: azureDevOpsConfig().clientId,
            userId: profile.id, userName: profile.displayName, authorizedBy: input.userId, generation: 1, status: 'connected',
            createdAt: time, updatedAt: time, ...encryptedTokens(identity, token) };
        if (!await store.create(created)) throw new AzureDevOpsSetupError('grant_conflict');
        const connection: AzureDevOpsConnection = { type: 'azure-devops-connection', provider: 'azure-devops', pk: current.pk, id: connectionId,
            workspaceId: current.workspaceId, projectId: current.id, connectedBy: input.userId, grantId: created.id,
            enabled: false, status: 'connected', destinationRevision: 1, config: {}, createdAt: time, updatedAt: time };
        if (!await store.create(connection)) throw new AzureDevOpsSetupError('connection_conflict');
        const selection: AzureDevOpsSelection = { type: 'azure-devops-selection', pk: current.pk, id: selectionId(current.id), projectId: current.id, connectionId };
        if (!await store.create(selection)) await updateDoc<AzureDevOpsSelection>(selection.pk, selection.id, value => ({ ...value, connectionId }));
        return { ...result, status: 'connected' as const };
    } catch {
        // Never leave usable credentials behind a connection that was not created.
        if (created) await wipeAzureDevOpsGrant(created.workspaceId, created.id).catch(() => undefined);
        return { ...result, status: 'failed' as const };
    }
}

export type AzureDevOpsCall = <T>(send: (signal: AbortSignal) => Promise<T>) => Promise<T>;
const defaultCall: AzureDevOpsCall = send => send(AbortSignal.timeout(20_000));

/** A current access token; refreshes under a generation-fenced lease shortly before expiry or when forced. */
export async function azureDevOpsAccessToken(connection: AzureDevOpsConnection, call: AzureDevOpsCall = defaultCall, force = false) {
    const store = getAppStore();
    const grant = await currentAzureDevOpsGrant(connection);
    if (grant.status !== 'connected' || !grant.access || !grant.refresh || !await grantAuthority(grant)) throw new AzureDevOpsSetupError('needs_reconnect');
    if (grant.pausedUntil && Date.parse(grant.pausedUntil) > Date.now()) throw new AzureDevOpsApiError('rate_limited', 429, grant.pausedUntil, true);
    if (!force && grant.expiresAt && Date.parse(grant.expiresAt) > Date.now() + 60_000)
        return decryptSecret(grant.access, secretContext(grant, 'access'), azureDevOpsKey());
    const authorize = (current: AzureDevOpsGrant) => grantAuthority(current);
    const leased = await acquireGrantLease<AzureDevOpsGrant>({ pk: grant.pk, id: grant.id, authorize }, store);
    if (!leased) throw new AzureDevOpsSetupError('needs_reconnect');
    try {
        const current = leased.grant;
        if (current.generation !== grant.generation || (!force && current.expiresAt && Date.parse(current.expiresAt) > Date.now() + 60_000)) {
            await releaseGrantLease({ pk: grant.pk, id: grant.id, lease: leased.lease }, store);
            return decryptSecret(current.access!, secretContext(current, 'access'), azureDevOpsKey());
        }
        // Entra keeps a redeemed refresh token valid, so a lost response is retried with the same token.
        const refreshToken = decryptSecret(current.refresh!, secretContext(current, 'refresh'), azureDevOpsKey());
        const token = await call(signal => azureDevOpsToken({ grant_type: 'refresh_token', refresh_token: refreshToken }, signal));
        const saved = await saveGrantLease<AzureDevOpsGrant>({ pk: grant.pk, id: grant.id, lease: leased.lease, authorize,
            update: value => ({ ...value, ...encryptedTokens(value, token), forcedRefreshAt: force ? nowIso() : value.forcedRefreshAt, updatedAt: nowIso() }) }, store);
        if (!saved?.access) throw new AzureDevOpsSetupError('grant_changed');
        return decryptSecret(saved.access, secretContext(saved, 'access'), azureDevOpsKey());
    } catch (error) {
        if (error instanceof AzureDevOpsApiError && ['invalid_grant', 'interaction_required', 'invalid_client', 'unauthorized_client', 'consent_required'].includes(error.code))
            await invalidateAzureDevOpsGrant(grant, 'needs_reconnect');
        else await releaseGrantLease({ pk: grant.pk, id: grant.id, lease: leased.lease }, store).catch(() => undefined);
        throw error;
    }
}

export async function invalidateAzureDevOpsGrant(grant: AzureDevOpsGrant, code: string) {
    const invalidated = await updateDoc<AzureDevOpsGrant>(grant.pk, grant.id, current => current.generation !== grant.generation ? current : ({ ...current,
        status: 'needs_reconnect', statusCode: code, access: undefined, refresh: undefined, refreshLease: undefined,
        generation: current.generation + 1, updatedAt: nowIso() }));
    if (invalidated?.status !== 'needs_reconnect' || invalidated.generation !== grant.generation + 1) return;
    await updateDoc<AzureDevOpsConnection>(grant.pk, grant.connectionId, current => current.grantId !== grant.id || current.statusCode === 'disconnected' ? current
        : ({ ...current, status: 'needs_reconnect', statusCode: code, updatedAt: nowIso() }));
}

export async function pauseAzureDevOpsGrant(grant: AzureDevOpsGrant, retryAt: string) {
    await updateDoc<AzureDevOpsGrant>(grant.pk, grant.id, current => ({ ...current, pausedUntil: retryAt, updatedAt: nowIso() }));
}

/**
 * Local erasure of the credentials. The Microsoft identity platform has no per-token revocation for this
 * grant; people remove uier's consent in their Microsoft account or Entra admin center.
 */
export async function wipeAzureDevOpsGrant(workspaceId: string, id: string) {
    await updateDoc<AzureDevOpsGrant>(workspacePk(workspaceId), id, current => current.type !== 'azure-devops-grant' ? current : ({ ...current,
        status: 'disconnected', access: undefined, refresh: undefined, refreshLease: undefined, generation: current.generation + 1, updatedAt: nowIso() }));
}

export async function disconnectAzureDevOps(project: DbProject, userId: string) {
    const current = await requireAzureDevOpsAdmin(project, userId);
    const connection = await azureDevOpsConnection(current);
    if (!connection) return;
    if (current.integrations?.['azure-devops']?.connectionId === connection.id) await disconnectIntegration(current, 'azure-devops');
    else await updateDoc<AzureDevOpsConnection>(connection.pk, connection.id, value => ({ ...value, enabled: false, status: 'needs_reconnect',
        statusCode: 'disconnected', updatedAt: nowIso() }));
    await wipeAzureDevOpsGrant(current.workspaceId, connection.grantId);
}

/** Removing an admin wipes credentials of each connection that lost its connecting admin. */
export async function revokeAzureDevOpsAdmin(workspaceId: string) {
    for (const grant of await getAppStore().query<AzureDevOpsGrant>({ type: 'azure-devops-grant', pk: workspacePk(workspaceId), where: { status: 'connected' } }))
        if (!await grantAuthority(grant)) await wipeAzureDevOpsGrant(workspaceId, grant.id);
}

export async function setAzureDevOpsEnabled(project: DbProject, userId: string, enabled: boolean) {
    const current = await requireAzureDevOpsAdmin(project, userId);
    const connection = await azureDevOpsConnection(current);
    if (!connection) throw new AzureDevOpsSetupError('destination_required');
    if (!enabled) {
        await updateDoc<AzureDevOpsConnection>(connection.pk, connection.id, value => {
            if (value.destinationRevision !== connection.destinationRevision || value.connectedBy !== connection.connectedBy)
                throw new AzureDevOpsSetupError('connection_changed');
            return { ...value, enabled: false, updatedAt: nowIso() };
        });
        return;
    }
    if (!validOrganization(connection.config.organization) || !guid(connection.config.projectId)) throw new AzureDevOpsSetupError('destination_required');
    if (!isAzureDevOpsConfigured()) throw new AzureDevOpsSetupError('not_configured');
    const grant = await currentAzureDevOpsGrant(connection);
    if (grant.status !== 'connected' || !grant.access || !grant.refresh || !await grantAuthority(grant)) throw new AzureDevOpsSetupError('needs_reconnect');
    await updateDoc<AzureDevOpsConnection>(connection.pk, connection.id, value => ({ ...value, enabled, status: 'connected', statusCode: undefined, updatedAt: nowIso() }));
    if (!current.integrations?.['azure-devops']) await setIntegrationBinding(current.workspaceId, current.id, 'azure-devops', { connectionId: connection.id, since: nowIso() });
}
