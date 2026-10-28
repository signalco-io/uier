import { randomUUID } from 'node:crypto';
import { memberId, workspacePk, type DbMember, type DbProject } from '../../app/model';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import { sha256Hex } from '../../app/tokens';
import { PUBLIC_PROJECT_ID } from '../../comments/publicProject';
import { isLocalRuntime } from '../../comments/environment';
import { setIntegrationBinding, disconnectIntegration } from '../connection';
import { createOauthState, consumeOauthState } from '../oauthState';
import { acquireGrantLease, releaseGrantLease, saveGrantLease } from '../grants';
import { decryptSecret, encryptSecret } from '../secrets';
import { slackRequest, SlackApiError } from './client';
import { isSlackConfigured, slackAuthorizeUrl, slackId, slackLabel, slackScopes, slackSecretKey } from './config';
import type { SlackConnection, SlackGrant, SlackInstallationOwner } from './model';
import { SlackRateWait, withSlackRateLimit } from './rate';

export class SlackConnectionError extends Error {
    constructor(public readonly code: string) {
        super('Slack could not complete this connection. Check its access and try again.');
        this.name = 'SlackConnectionError';
    }
}

export const slackConnectionId = (projectId: string) => `slack_${projectId}`;
const grantId = (teamId: string, appId = process.env.SLACK_APP_ID) => `slack_grant_${sha256Hex(JSON.stringify([appId, teamId]))}`;
const ownerPk = (teamId: string, appId = process.env.SLACK_APP_ID) => `slack-installation:${sha256Hex(JSON.stringify([appId, teamId]))}`;
const secretContext = (grant: SlackGrant, field: string) => ({ provider: 'slack', workspaceId: grant.workspaceId, subjectId: grant.id, field });

export async function requireSlackProject(workspaceId: string, projectId: string, userId: string, store = getAppStore()) {
    const project = (await store.get<DbProject>(workspacePk(workspaceId), projectId))?.doc;
    const member = (await store.get<DbMember>(workspacePk(workspaceId), memberId(userId)))?.doc;
    if (!project || project.type !== 'project' || project.workspaceId !== workspaceId || project.id === PUBLIC_PROJECT_ID
        || member?.type !== 'member' || member.workspaceId !== workspaceId || member.userId !== userId || member.role !== 'admin') throw new SlackConnectionError('access_denied');
    return project;
}

export async function rawSlackConnection(project: DbProject, store = getAppStore()) {
    const connection = (await store.get<SlackConnection>(project.pk, slackConnectionId(project.id)))?.doc;
    return connection?.type === 'slack-connection' && connection.workspaceId === project.workspaceId && connection.projectId === project.id ? connection : null;
}

function callbackUrl(baseUrl: string) {
    const url = new URL('/app/slack/callback', baseUrl);
    if (url.origin !== 'https://uier.io' && !(isLocalRuntime() && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        throw new SlackConnectionError('invalid_callback');
    if (url.username || url.password) throw new SlackConnectionError('invalid_callback');
    return url.href;
}

export async function acquireOwner(workspaceId: string, teamId: string, nonce: string, appId = process.env.SLACK_APP_ID!, store = getAppStore()) {
    for (let n = 0; n < 8; n++) {
        const stored = await store.get<SlackInstallationOwner>(ownerPk(teamId, appId), 'owner');
        const released = stored?.doc.status === 'released' && stored.doc.generation === 0 && stored.doc.everCommitted !== true;
        if (stored && stored.doc.workspaceId !== workspaceId && !released) throw new SlackConnectionError('installation_owned_elsewhere');
        if (stored?.doc.operationLease && stored.doc.operationLease.id !== nonce && Date.parse(stored.doc.operationLease.until) > Date.now())
            throw new SlackConnectionError('installation_busy');
        const owner: SlackInstallationOwner = { ...(!released && stored?.doc ? stored.doc : { type: 'slack-installation-owner', pk: ownerPk(teamId, appId), id: 'owner',
            workspaceId, appId, teamId, grantId: grantId(teamId, appId), status: 'reserved', generation: 0, nonce }),
            operationLease: { id: nonce, until: new Date(Date.now() + 2 * 60_000).toISOString() } };
        if (!stored ? await store.create(owner) : await store.replace(owner, stored.etag) === 'ok') return owner;
    }
    throw new SlackConnectionError('installation_busy');
}

async function saveOwner(owner: SlackInstallationOwner, generation: number, store = getAppStore()) {
    const saved = await updateDoc<SlackInstallationOwner>(owner.pk, owner.id, current => {
        if (current.workspaceId !== owner.workspaceId || current.operationLease?.id !== owner.operationLease?.id
            || Date.parse(current.operationLease?.until ?? '') <= Date.now()) throw new SlackConnectionError('installation_lease_lost');
        if (current.generation !== owner.generation && current.generation !== generation) throw new SlackConnectionError('installation_lease_lost');
        return { ...current, status: 'active', generation, everCommitted: true };
    }, store);
    if (!saved) throw new SlackConnectionError('installation_lease_lost');
}

export async function releaseOwner(owner: SlackInstallationOwner, store = getAppStore()) {
    await updateDoc<SlackInstallationOwner>(owner.pk, owner.id, current => {
        if (current.operationLease?.id !== owner.operationLease?.id) return current;
        const { operationLease: _lease, ...next } = current;
        return next;
    }, store);
}

async function authorizedConnectionUses(grant: SlackGrant, store: AppStore) {
    const rows = await store.query<SlackConnection>({ type: 'slack-connection', pk: grant.pk,
        where: { grantId: grant.id, status: 'connected' }, limit: 1000 });
    // A bounded scan must not erase credentials still referenced beyond its last page.
    if (rows.length === 1000) return true;
    for (const connection of rows) {
        if (connection.workspaceId !== grant.workspaceId || connection.config.teamId !== grant.teamId) continue;
        try {
            const project = await requireSlackProject(connection.workspaceId, connection.projectId, connection.connectedBy, store);
            const current = await rawSlackConnection(project, store);
            if (current?.grantId === grant.id && current.status === 'connected' && current.connectedBy === connection.connectedBy) return true;
        } catch (error) { if (!(error instanceof SlackConnectionError && error.code === 'access_denied')) throw error; }
    }
    return false;
}

/** Finish or erase only this setup's generation while holding the installation operation lease. */
async function settleSlackSetup(owner: SlackInstallationOwner, setupNonce: string, expectedGeneration?: number, store = getAppStore()) {
    const held = await store.get<SlackInstallationOwner>(owner.pk, owner.id);
    if (!held || held.doc.workspaceId !== owner.workspaceId || held.doc.operationLease?.id !== owner.operationLease?.id
        || Date.parse(held.doc.operationLease?.until ?? '') <= Date.now()) return false;
    const grant = (await store.get<SlackGrant>(workspacePk(owner.workspaceId), owner.grantId))?.doc;
    if (!grant) {
        if (held.doc.status === 'reserved' && held.doc.generation === 0 && held.doc.everCommitted !== true && held.doc.nonce === setupNonce) {
            // AppStore.delete has no etag. Keep a reusable, conditionally replaced empty receipt instead.
            await updateDoc<SlackInstallationOwner>(owner.pk, owner.id, current => current.workspaceId !== owner.workspaceId
                || current.operationLease?.id !== owner.operationLease?.id || Date.parse(current.operationLease?.until ?? '') <= Date.now()
                || current.status !== 'reserved' || current.generation !== 0 || current.everCommitted === true || current.nonce !== setupNonce ? current
                : ({ ...current, status: 'released', operationLease: undefined }), store);
        }
        return false;
    }
    if (grant.setupNonce !== setupNonce || (expectedGeneration !== undefined && grant.generation !== expectedGeneration)) return false;
    if (await authorizedConnectionUses(grant, store)) {
        await saveOwner(held.doc, grant.generation, store);
        await updateDoc<SlackGrant>(grant.pk, grant.id, current => current.generation !== grant.generation || current.setupNonce !== setupNonce ? current
            : ({ ...current, setupNonce: undefined, setupPending: undefined }), store);
        return true;
    }
    const boundary = (await store.get<SlackInstallationOwner>(owner.pk, owner.id))?.doc;
    if (!boundary || boundary.workspaceId !== owner.workspaceId || boundary.operationLease?.id !== owner.operationLease?.id
        || Date.parse(boundary.operationLease?.until ?? '') <= Date.now()) return false;
    const wiped = await updateDoc<SlackGrant>(grant.pk, grant.id, current => current.generation !== grant.generation || current.setupNonce !== setupNonce ? current
        : ({ ...current, tokens: undefined, refreshStartedAt: undefined, status: 'needs_reconnect', setupNonce: undefined, setupPending: undefined }), store);
    if (!wiped || wiped.generation !== grant.generation || wiped.tokens) return false;
    await updateDoc<SlackInstallationOwner>(owner.pk, owner.id, current => {
        if (current.workspaceId !== owner.workspaceId || current.operationLease?.id !== owner.operationLease?.id
            || Date.parse(current.operationLease?.until ?? '') <= Date.now()
            || (current.generation !== held.doc.generation && current.generation !== grant.generation)) return current;
        return { ...current, status: 'disconnected', generation: grant.generation, everCommitted: true };
    }, store);
    for (const connection of await store.query<SlackConnection>({ type: 'slack-connection', pk: grant.pk,
        where: { grantId: grant.id }, limit: 1000 })) if (connection.setupNonce === setupNonce)
        await updateDoc<SlackConnection>(connection.pk, connection.id, current => current.setupNonce !== setupNonce ? current
            : ({ ...current, enabled: false, status: 'needs_reconnect', statusCode: 'setup_failed', setupNonce: undefined }), store);
    return false;
}

/** Recover expired local setup receipts without exchanging OAuth codes or touching provider data. */
export async function recoverSlackSetups(options: { workspaceId?: string; deadline?: number } = {}) {
    const store = getAppStore(); const deadline = options.deadline ?? Date.now() + 10_000;
    const pending = await store.query<SlackGrant>({ type: 'slack-grant', ...(options.workspaceId ? { pk: workspacePk(options.workspaceId) } : {}),
        where: { setupPending: true }, limit: 100 });
    const reserved = await store.query<SlackInstallationOwner>({ type: 'slack-installation-owner',
        where: { status: 'reserved', ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}) }, limit: 100 });
    const candidates = new Map<string, { owner: SlackInstallationOwner; nonce: string; generation?: number }>();
    for (const owner of reserved) candidates.set(owner.pk, { owner, nonce: owner.nonce });
    for (const grant of pending) {
        const owner = (await store.get<SlackInstallationOwner>(ownerPk(grant.teamId, grant.appId), 'owner'))?.doc;
        if (owner && grant.setupNonce && owner.workspaceId === grant.workspaceId) candidates.set(owner.pk, { owner, nonce: grant.setupNonce, generation: grant.generation });
    }
    for (const { owner, nonce, generation } of candidates.values()) {
        if (Date.now() >= deadline) break;
        if (owner.operationLease && Date.parse(owner.operationLease.until) > Date.now()) continue;
        let lease: SlackInstallationOwner | undefined;
        try { lease = await acquireOwner(owner.workspaceId, owner.teamId, randomUUID(), owner.appId); await settleSlackSetup(lease, nonce, generation); }
        catch (error) { if (!(error instanceof SlackConnectionError && error.code === 'installation_busy')) throw error; }
        finally { if (lease) await releaseOwner(lease); }
    }
}

function tokenFields(data: Record<string, unknown>) {
    if (data.token_type !== 'bot' || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16384
        || typeof data.refresh_token !== 'string' || !data.refresh_token || data.refresh_token.length > 16384
        || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 43200)
        throw new SlackConnectionError('rotation_required');
    return { access: data.access_token, refresh: data.refresh_token, expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() };
}

export async function beginSlackConnect(input: { userId: string; workspaceId: string; projectId: string; baseUrl: string }) {
    const project = await requireSlackProject(input.workspaceId, input.projectId, input.userId);
    if (!isSlackConfigured()) throw new SlackConnectionError('not_configured');
    await recoverSlackSetups({ workspaceId: project.workspaceId });
    const current = await rawSlackConnection(project);
    if (!current || current.status === 'connected') {
        const grants = await getAppStore().query<SlackGrant>({ type: 'slack-grant', pk: project.pk, where: { status: 'connected', appId: process.env.SLACK_APP_ID! }, limit: 1000 });
        const available: SlackGrant[] = [];
        for (const grant of grants) {
            const owner = (await getAppStore().get<SlackInstallationOwner>(ownerPk(grant.teamId), 'owner'))?.doc;
            if (grant.tokens && !grant.refreshStartedAt && owner?.status === 'active' && owner.workspaceId === project.workspaceId
                && owner.grantId === grant.id && owner.generation === grant.generation
                && (!owner.operationLease || Date.parse(owner.operationLease.until) <= Date.now())) available.push(grant);
        }
        if (available.length === 1) {
            const grant = available[0]!;
            const held = await acquireOwner(project.workspaceId, grant.teamId, randomUUID(), grant.appId);
            try {
                const retained = (await getAppStore().get<SlackGrant>(grant.pk, grant.id))?.doc;
                if (!retained?.tokens || retained.status !== 'connected' || retained.generation !== held.generation || retained.refreshStartedAt)
                    throw new SlackConnectionError('needs_reconnect');
                await attachSlackGrant(project, input.userId, retained);
            } finally { await releaseOwner(held); }
            return new URL(`/app/projects/${project.id}/settings?slack=connected#slack`, input.baseUrl).href;
        }
    }
    const state = await createOauthState({ provider: 'slack', ...input, pkce: false, key: slackSecretKey(),
        ...(current?.config.teamId ? { metadata: { teamId: current.config.teamId } } : {}) });
    const url = new URL(slackAuthorizeUrl());
    url.search = new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID!, scope: slackScopes.join(','),
        redirect_uri: callbackUrl(input.baseUrl), state: state.state }).toString();
    return url.href;
}

export async function finishSlackConnect(input: { userId: string; state: unknown; code?: string; error?: string; baseUrl: string }, store = getAppStore()) {
    const state = await consumeOauthState({ provider: 'slack', userId: input.userId, state: input.state, key: slackSecretKey() }, store);
    if (!state) throw new SlackConnectionError('invalid_state');
    const result = { workspaceId: state.workspaceId, projectId: state.projectId };
    const project = await requireSlackProject(state.workspaceId, state.projectId, input.userId, store);
    if (input.error) return { ...result, status: input.error === 'access_denied' ? 'denied' as const : 'failed' as const };
    if (!isSlackConfigured() || !input.code || input.code.length > 2048) return { ...result, status: 'failed' as const };
    const nonce = sha256Hex(String(input.state));
    let owner: SlackInstallationOwner | undefined;
    let setupTeamId = state.metadata?.teamId;
    const setupAppId = process.env.SLACK_APP_ID!;
    let candidate: SlackGrant | undefined;
    try {
        // A known-installation reconnect holds its global operation lease across exchange.
        if (state.metadata?.teamId && slackId(state.metadata.teamId)) owner = await acquireOwner(project.workspaceId, state.metadata.teamId, nonce, setupAppId, store);
        const data = await slackRequest('oauth.v2.access', { code: input.code, redirect_uri: callbackUrl(input.baseUrl) }, { oauth: true });
        const team = data.team as Record<string, unknown> | undefined;
        const scopes = typeof data.scope === 'string' ? data.scope.split(',') : [];
        if (data.token_type !== 'bot' || data.app_id !== process.env.SLACK_APP_ID || data.is_enterprise_install === true
            || !slackId(team?.id) || !slackId(data.bot_user_id) || !slackScopes.every(scope => scopes.includes(scope))
            || scopes.some(scope => !slackScopes.includes(scope as typeof slackScopes[number]))
            || (data.authed_user && typeof data.authed_user === 'object' && 'access_token' in data.authed_user))
            throw new SlackConnectionError('invalid_installation');
        const tokens = tokenFields(data);
        if (owner && owner.teamId !== team.id) { await releaseOwner(owner, store); owner = undefined; }
        setupTeamId = team.id;
        owner ??= await acquireOwner(project.workspaceId, team.id, nonce, setupAppId, store);
        const identity = await withSlackRateLimit({ appId: data.app_id as string, teamId: team.id }, 'auth.test', undefined,
            () => slackRequest('auth.test', {}, { token: tokens.access }));
        let teamHost: string;
        try {
            const teamUrl = new URL(String(identity.url));
            if (identity.team_id !== team.id || identity.user_id !== data.bot_user_id || teamUrl.protocol !== 'https:'
                || !/^[a-z0-9-]+\.slack\.com$/.test(teamUrl.hostname) || teamUrl.username || teamUrl.password || teamUrl.port) throw new Error();
            teamHost = teamUrl.hostname;
        } catch { throw new SlackConnectionError('invalid_installation'); }
        const prior = await store.get<SlackGrant>(project.pk, owner.grantId);
        if (prior?.doc.refreshLease && Date.parse(prior.doc.refreshLease.until) > Date.now()) throw new SlackConnectionError('installation_busy');
        await requireSlackProject(project.workspaceId, project.id, input.userId, store);
        const grant: SlackGrant = { type: 'slack-grant', provider: 'slack', pk: project.pk, id: owner.grantId,
            workspaceId: project.workspaceId, appId: data.app_id as string, teamId: team.id, teamName: slackLabel(team.name) || 'Slack workspace',
            botId: data.bot_user_id, teamHost, scopes, generation: (prior?.doc.generation ?? 0) + 1, status: 'connected', setupNonce: nonce, setupPending: true };
        grant.tokens = { access: encryptSecret(tokens.access, secretContext(grant, 'access'), slackSecretKey()),
            refresh: encryptSecret(tokens.refresh, secretContext(grant, 'refresh'), slackSecretKey()), expiresAt: tokens.expiresAt };
        candidate = grant;
        const held = (await store.get<SlackInstallationOwner>(owner.pk, owner.id))?.doc;
        if (!held || held.workspaceId !== owner.workspaceId || held.operationLease?.id !== nonce || Date.parse(held.operationLease.until) <= Date.now()
            || held.generation !== owner.generation) throw new SlackConnectionError('installation_lease_lost');
        if (!prior ? !await store.create(grant) : await store.replace(grant, prior.etag) !== 'ok') throw new SlackConnectionError('installation_busy');
        await saveOwner(owner, grant.generation, store);
        await attachSlackGrant(project, input.userId, grant, nonce, store);
        await requireSlackProject(project.workspaceId, project.id, input.userId, store);
        if (!await settleSlackSetup(owner, nonce, grant.generation, store)) throw new SlackConnectionError('access_denied');
        return { ...result, status: 'connected' as const };
    } catch {
        // A write may have committed before its response was lost; re-read the nonce-owned claim.
        if (!owner && setupTeamId && slackId(setupTeamId)) {
            const retained = (await store.get<SlackInstallationOwner>(ownerPk(setupTeamId, setupAppId), 'owner'))?.doc;
            if (retained?.workspaceId === project.workspaceId && retained.operationLease?.id === nonce) owner = retained;
        }
        if (owner) await settleSlackSetup(owner, nonce, candidate?.generation, store);
        return { ...result, status: 'failed' as const };
    } finally { if (owner) await releaseOwner(owner, store); }
}

async function grantAuthorized(connection: SlackConnection, grant: SlackGrant, allowUnbound: boolean) {
    try {
        const project = await requireSlackProject(connection.workspaceId, connection.projectId, connection.connectedBy);
        const current = await rawSlackConnection(project);
        return current?.grantId === grant.id && current.destinationRevision === connection.destinationRevision
            && current.connectedBy === connection.connectedBy && (current.status === 'connected' || (allowUnbound && current.status === 'paused'))
            && current.config.teamId === grant.teamId && grant.appId === process.env.SLACK_APP_ID
            && grant.workspaceId === project.workspaceId && grant.provider === 'slack'
            && (allowUnbound || (current.enabled && project.integrations?.slack?.connectionId === current.id));
    } catch { return false; }
}

export async function slackAccessToken(connection: SlackConnection, options: {
    allowUnbound?: boolean; refresh?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
} = {}) {
    const store = getAppStore();
    let grant = connection.grantId ? (await store.get<SlackGrant>(connection.pk, connection.grantId))?.doc : null;
    if (!grant?.tokens || grant.status !== 'connected' || !await grantAuthorized(connection, grant, options.allowUnbound === true))
        throw new SlackConnectionError('needs_reconnect');
    let owner = (await store.get<SlackInstallationOwner>(ownerPk(grant.teamId, grant.appId), 'owner'))?.doc;
    if (!owner || owner.workspaceId !== grant.workspaceId || owner.grantId !== grant.id || owner.status !== 'active'
        || owner.generation !== grant.generation) throw new SlackConnectionError('needs_reconnect');
    if (owner.operationLease && Date.parse(owner.operationLease.until) > Date.now()) throw new SlackConnectionError('installation_busy');
    if (grant.refreshStartedAt) { await invalidateSlackGrant(grant); throw new SlackConnectionError('refresh_uncertain'); }
    if (Date.parse(grant.tokens.expiresAt) > Date.now() + 60_000) return decryptSecret(grant.tokens.access, secretContext(grant, 'access'), slackSecretKey());
    owner = await acquireOwner(grant.workspaceId, grant.teamId, randomUUID(), grant.appId);
    let leased: Awaited<ReturnType<typeof acquireGrantLease<SlackGrant>>> | undefined;
    let refreshAttempted = false;
    try {
        leased = await acquireGrantLease<SlackGrant>({ pk: grant.pk, id: grant.id,
            authorize: current => grantAuthorized(connection, current, options.allowUnbound === true) });
        if (!leased?.grant.tokens) throw new SlackConnectionError('needs_reconnect');
        const retained = leased.grant;
        if (Date.parse(retained.tokens!.expiresAt) > Date.now() + 60_000) grant = retained;
        else {
            const refresh = decryptSecret(retained.tokens!.refresh, secretContext(retained, 'refresh'), slackSecretKey());
            const data = await withSlackRateLimit(retained, 'oauth.v2.access', undefined,
                async () => {
                    await updateDoc<SlackGrant>(retained.pk, retained.id, current => {
                        if (current.generation !== retained.generation || current.refreshLease?.id !== leased!.lease.id) throw new SlackConnectionError('installation_lease_lost');
                        return { ...current, refreshStartedAt: new Date().toISOString() };
                    });
                    refreshAttempted = true;
                    return (options.refresh ?? (payload => slackRequest('oauth.v2.access', payload, { oauth: true })))({ grant_type: 'refresh_token', refresh_token: refresh });
                });
            const tokens = tokenFields(data);
            const held = (await store.get<SlackInstallationOwner>(owner.pk, owner.id))?.doc;
            if (!held || held.operationLease?.id !== owner.operationLease?.id || Date.parse(held.operationLease?.until ?? '') <= Date.now()
                || held.workspaceId !== retained.workspaceId || held.generation !== retained.generation) throw new SlackConnectionError('installation_lease_lost');
            const saved = await saveGrantLease<SlackGrant>({ pk: retained.pk, id: retained.id, lease: leased.lease,
                authorize: current => grantAuthorized(connection, current, options.allowUnbound === true), update: current => ({ ...current,
                    tokens: { access: encryptSecret(tokens.access, secretContext(current, 'access'), slackSecretKey()),
                        refresh: encryptSecret(tokens.refresh, secretContext(current, 'refresh'), slackSecretKey()), expiresAt: tokens.expiresAt }, refreshStartedAt: undefined }) });
            if (!saved) throw new SlackConnectionError('needs_reconnect');
            grant = saved;
            await saveOwner(owner, saved.generation);
        }
        return decryptSecret(grant.tokens!.access, secretContext(grant, 'access'), slackSecretKey());
    } catch (error) {
        if (error instanceof SlackApiError && (!error.definitive || ['invalid_grant', 'invalid_refresh_token', 'token_revoked', 'invalid_auth'].includes(error.code)))
            await invalidateSlackGrant(grant);
        else if (leased && (!refreshAttempted || error instanceof SlackRateWait || (error instanceof Error && error.name === 'IntegrationControlError')
            || (error instanceof SlackApiError && error.definitive)))
            await updateDoc<SlackGrant>(grant.pk, grant.id, current => current.generation !== leased!.grant.generation ? current : ({ ...current, refreshStartedAt: undefined }));
        else if (leased) await invalidateSlackGrant(grant);
        throw error;
    } finally {
        if (leased) await releaseGrantLease({ pk: leased.grant.pk, id: leased.grant.id, lease: leased.lease });
        await releaseOwner(owner);
    }
}

export async function disconnectSlack(project: DbProject, userId: string) {
    project = await requireSlackProject(project.workspaceId, project.id, userId);
    const connection = await rawSlackConnection(project);
    if (!connection) return;
    const grant = connection.grantId ? (await getAppStore().get<SlackGrant>(connection.pk, connection.grantId))?.doc : undefined;
    const owner = grant ? await acquireOwner(project.workspaceId, grant.teamId, randomUUID(), grant.appId) : undefined;
    try {
    await disconnectIntegration(project, 'slack');
    await updateDoc<SlackConnection>(connection.pk, connection.id, current => ({ ...current, enabled: false, status: 'needs_reconnect', statusCode: 'disconnected' }));
    const remaining = (await getAppStore().query<SlackConnection>({ type: 'slack-connection', pk: project.pk, where: { grantId: connection.grantId ?? '', status: 'connected' } }))
        .filter(current => current.id !== connection.id);
    if (!remaining.length && connection.grantId) await updateDoc<SlackGrant>(project.pk, connection.grantId,
        current => ({ ...current, tokens: undefined, status: 'needs_reconnect' }));
    if (!remaining.length && owner) await updateDoc<SlackInstallationOwner>(owner.pk, owner.id, current => current.operationLease?.id !== owner.operationLease?.id ? current : ({ ...current, status: 'disconnected' }));
    } finally { if (owner) await releaseOwner(owner); }
}

async function attachSlackGrant(project: DbProject, userId: string, grant: SlackGrant, setupNonce?: string, store = getAppStore()) {
    project = await requireSlackProject(project.workspaceId, project.id, userId, store);
    const previous = await rawSlackConnection(project, store);
    const sameTeam = previous?.config.teamId === grant.teamId;
    const now = new Date().toISOString();
    const connection: SlackConnection = { type: 'slack-connection', provider: 'slack', pk: project.pk, id: slackConnectionId(project.id),
        workspaceId: project.workspaceId, projectId: project.id, connectedBy: userId, enabled: false, status: 'connected',
        destinationRevision: (previous?.destinationRevision ?? 0) + 1, grantId: grant.id,
        createdAt: previous?.createdAt ?? now, updatedAt: now, setupNonce,
        config: { ...(sameTeam ? previous?.config : {}), teamId: grant.teamId, teamName: grant.teamName, botId: grant.botId, teamHost: grant.teamHost,
            replySummaries: sameTeam ? previous!.config.replySummaries : false, statusSummaries: sameTeam ? previous!.config.statusSummaries : false } };
    if (!await store.create(connection)) {
        const saved = await updateDoc<SlackConnection>(connection.pk, connection.id, current => {
            if (previous && (current.destinationRevision !== previous.destinationRevision || current.grantId !== previous.grantId)) throw new SlackConnectionError('connection_changed');
            return connection;
        }, store);
        if (!saved) throw new SlackConnectionError('connection_changed');
    }
    if (!sameTeam && project.integrations?.slack) await setIntegrationBinding(project.workspaceId, project.id, 'slack', null, store, connection.id);
}

export async function currentSlackGrant(connection: SlackConnection) {
    const grant = connection.grantId ? (await getAppStore().get<SlackGrant>(connection.pk, connection.grantId))?.doc : null;
    if (!grant || grant.provider !== 'slack' || grant.teamId !== connection.config.teamId || grant.workspaceId !== connection.workspaceId)
        throw new SlackConnectionError('needs_reconnect');
    return grant;
}

/** Generation checks keep a late failed request from wiping a newer reconnect. */
export async function invalidateSlackGrant(grant: SlackGrant) {
    const saved = await updateDoc<SlackGrant>(grant.pk, grant.id, current => current.generation !== grant.generation ? current
        : ({ ...current, tokens: undefined, refreshStartedAt: undefined, status: 'needs_reconnect' }));
    if (saved?.generation !== grant.generation || saved.status !== 'needs_reconnect') return;
    for (const connection of await getAppStore().query<SlackConnection>({ type: 'slack-connection', pk: grant.pk, where: { grantId: grant.id, status: 'connected' }, limit: 1000 }))
        if ((await getAppStore().get<SlackGrant>(grant.pk, grant.id))?.doc.generation === grant.generation)
            await updateDoc<SlackConnection>(connection.pk, connection.id, current => current.grantId !== grant.id || current.updatedAt !== connection.updatedAt ? current
                : ({ ...current, status: 'needs_reconnect', statusCode: 'grant_invalid', updatedAt: new Date().toISOString() }));
}
