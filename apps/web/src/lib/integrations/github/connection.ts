import { randomToken, isRandomToken, sha256Hex } from '../../app/tokens';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import { memberId, userPk, workspacePk, type DbMember, type DbProject } from '../../app/model';
import { isLocalRuntime } from '../../comments/environment';
import { PUBLIC_PROJECT_ID } from '../../comments/publicProject';
import { disconnectIntegration, getIntegrationConnection, setIntegrationBinding } from '../connection';
import { consumeOauthState, createOauthState } from '../oauthState';
import { decryptSecret, encryptSecret } from '../secrets';
import type { IntegrationSync } from '../model';
import { exchangeGitHubCode, githubAppJwt, githubRequest, validateGitHubRepository } from './client';
import { GitHubError, githubConfig, githubId, githubLabel, githubRepositoryPath, githubSecretConfig, isGitHubConfigured } from './config';
import { githubInstallationPk, type GitHubConnection, type GitHubInstallation, type GitHubRepository, type GitHubSetup } from './model';
import { githubAppPk, type GitHubUserAccess } from './webhook';

export type GitHubActorInput = { userId: string; workspaceId: string; projectId: string };
export type GitHubSetupInput = GitHubActorInput & { setupReceipt: string };
export type GitHubRepositoryChoice = { id: string; fullName: string; private: boolean };

export async function githubAdmin(input: GitHubActorInput, store: AppStore = getAppStore()) {
    const member = (await store.get<DbMember>(workspacePk(input.workspaceId), memberId(input.userId)))?.doc;
    const project = (await store.get<DbProject>(workspacePk(input.workspaceId), input.projectId))?.doc;
    if (member?.type !== 'member' || member.userId !== input.userId || member.workspaceId !== input.workspaceId || member.role !== 'admin'
        || project?.type !== 'project' || project.id !== input.projectId || project.workspaceId !== input.workspaceId || project.id === PUBLIC_PROJECT_ID)
        throw new GitHubError('admin_required');
    return project;
}

function appOrigin(baseUrl: string) {
    const url = new URL(baseUrl);
    if (url.username || url.password || (!isLocalRuntime() && url.origin !== 'https://uier.io')
        || !['http:', 'https:'].includes(url.protocol)) throw new GitHubError('invalid_callback');
    return url.origin;
}
const callback = (baseUrl: string) => `${appOrigin(baseUrl)}/app/github/callback`;
const receiptId = (receipt: string) => `github_setup_${sha256Hex(receipt)}`;
function receiptContext(doc: GitHubSetup) {
    return { provider: 'github', workspaceId: doc.workspaceId, projectId: doc.projectId, userId: doc.userId, subjectId: doc.id, field: 'setup-token' };
}

async function authorizedRequest<T>(input: GitHubActorInput, path: string, token: string, store: AppStore) {
    await githubAdmin(input, store);
    return githubRequest<T>(path, token);
}

async function verifiedInstallation(input: GitHubActorInput, installationId: string, token: string, store: AppStore) {
    const config = githubConfig();
    for (let page = 1; page <= 5; page++) {
        const value = await authorizedRequest<{ installations: { id: number; app_id: number; account?: { login?: string }; permissions?: { issues?: string }; suspended_at?: string | null }[] }>(
            input, `/user/installations?per_page=100&page=${page}`, token, store);
        if (!Array.isArray(value?.installations)) throw new GitHubError('invalid_response');
        const found = value.installations.find(item => githubId(item.id) === installationId);
        if (found) {
            if (githubId(found.app_id) !== config.appId || found.suspended_at || found.permissions?.issues !== 'write') throw new GitHubError('installation_unavailable');
            return { accountName: githubLabel(found.account?.login) || 'GitHub account' };
        }
        if (value.installations.length < 100) break;
    }
    throw new GitHubError('installation_not_authorized');
}

export async function beginGitHubConnect(input: GitHubActorInput & { baseUrl: string }, store: AppStore = getAppStore()) {
    const config = githubConfig();
    await githubAdmin(input, store);
    callback(input.baseUrl);
    const { state } = await createOauthState({ provider: 'github', ...input, intent: 'install', pkce: false, key: githubSecretConfig() }, store);
    const url = new URL(`${config.oauthBase}/apps/${config.slug}/installations/new`);
    url.searchParams.set('state', state);
    return url.href;
}

export async function finishGitHubSetup(input: { userId: string; state: unknown; installationId: unknown; setupAction?: string; baseUrl: string }, store: AppStore = getAppStore()) {
    const config = githubConfig();
    const state = await consumeOauthState({ provider: 'github', userId: input.userId, state: input.state, key: githubSecretConfig(), expected: { intent: 'install' } }, store);
    if (!state) throw new GitHubError('invalid_state');
    await githubAdmin(state, store);
    if (input.setupAction === 'request') return { workspaceId: state.workspaceId, projectId: state.projectId, status: 'pending' as const,
        url: `${appOrigin(input.baseUrl)}/app/projects/${encodeURIComponent(state.projectId)}/settings?github=pending` };
    if (input.setupAction !== undefined && !['install', 'update'].includes(input.setupAction)) throw new GitHubError('invalid_setup');
    const installationId = githubId(input.installationId);
    const authorization = await createOauthState({ provider: 'github', userId: input.userId, workspaceId: state.workspaceId,
        projectId: state.projectId, intent: 'authorize', pkce: true, key: githubSecretConfig(), metadata: { installationId } }, store);
    const url = new URL(`${config.oauthBase}/login/oauth/authorize`);
    for (const [name, value] of Object.entries({ client_id: config.clientId, redirect_uri: callback(input.baseUrl), state: authorization.state,
        code_challenge: authorization.codeChallenge!, code_challenge_method: 'S256' })) url.searchParams.set(name, value);
    return { workspaceId: state.workspaceId, projectId: state.projectId, url: url.href };
}

export async function finishGitHubConnect(input: { userId: string; state: unknown; code?: string; error?: string; baseUrl: string }, store: AppStore = getAppStore()): Promise<{workspaceId: string; projectId: string; status: 'connected' | 'denied' | 'failed'; setupReceipt?: string}> {
    const state = await consumeOauthState({ provider: 'github', userId: input.userId, state: input.state, key: githubSecretConfig(), expected: { intent: 'authorize' } }, store);
    if (!state) throw new GitHubError('invalid_state');
    const result = { workspaceId: state.workspaceId, projectId: state.projectId };
    await githubAdmin(state, store);
    if (input.error) return { ...result, status: input.error === 'access_denied' ? 'denied' as const : 'failed' as const };
    try {
        if (!state.codeVerifier || !input.code || !state.metadata?.installationId) throw new GitHubError('invalid_setup');
        const installationId = githubId(state.metadata.installationId);
        const credentials = await exchangeGitHubCode(input.code, state.codeVerifier, callback(input.baseUrl));
        const account = await verifiedInstallation(state, installationId, credentials.accessToken, store);
        const user = await authorizedRequest<{ id: number }>(state, '/user', credentials.accessToken, store);
        const bot = await authorizedRequest<{ id: number; type: string }>(state, `/users/${encodeURIComponent(`${githubConfig().slug}[bot]`)}`, credentials.accessToken, store);
        if (bot.type !== 'Bot') throw new GitHubError('invalid_app_identity');
        const receipt = randomToken();
        const now = Date.now();
        const doc: GitHubSetup = { type: 'github-setup', pk: userPk(input.userId), id: receiptId(receipt),
            userId: input.userId, workspaceId: state.workspaceId, projectId: state.projectId, installationId,
            accountName: account.accountName, botId: githubId(bot.id), githubUserId: githubId(user.id),
            tokenExpiresAt: credentials.expiresAt, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), ttl: 600 };
        doc.token = encryptSecret(credentials.accessToken, receiptContext(doc), githubSecretConfig());
        await githubAdmin(state, store);
        if (!await store.create(doc)) throw new GitHubError('setup_conflict');
        return { ...result, status: 'connected' as const, setupReceipt: receipt };
    } catch { return { ...result, status: 'failed' as const }; }
}

async function setup(input: GitHubSetupInput, store: AppStore) {
    const project = await githubAdmin(input, store);
    if (!isRandomToken(input.setupReceipt)) throw new GitHubError('setup_expired');
    const stored = await store.get<GitHubSetup>(userPk(input.userId), receiptId(input.setupReceipt));
    const doc = stored?.doc;
    if (!stored || !doc || doc.type !== 'github-setup' || doc.userId !== input.userId || doc.workspaceId !== input.workspaceId
        || doc.projectId !== input.projectId || doc.usedAt || !doc.token || Date.parse(doc.expiresAt) <= Date.now()
        || (doc.tokenExpiresAt && Date.parse(doc.tokenExpiresAt) <= Date.now())) throw new GitHubError('setup_expired');
    const revoked = (await store.get<GitHubUserAccess>(githubAppPk(githubConfig().appId), `user_${githubId(doc.githubUserId)}`))?.doc;
    if (revoked && Date.parse(revoked.revokedAt) >= Date.parse(doc.createdAt)) throw new GitHubError('setup_expired');
    return { project, stored, token: decryptSecret(doc.token, receiptContext(doc), githubSecretConfig()) };
}

async function repositoryChoices(input: GitHubActorInput, installationId: string, token: string, store: AppStore) {
    const repositories: GitHubRepository[] = [];
    let truncated = false;
    for (let page = 1; page <= 5; page++) {
        const data = await authorizedRequest<{ total_count: number; repositories: GitHubRepository[] }>(input,
            `/user/installations/${githubId(installationId)}/repositories?per_page=100&page=${page}`, token, store);
        if (!Array.isArray(data?.repositories)) throw new GitHubError('invalid_response');
        repositories.push(...data.repositories.map(validateGitHubRepository));
        truncated = data.total_count > repositories.length;
        if (data.repositories.length < 100) break;
    }
    return { repositories, truncated };
}

export async function listGitHubRepositories(input: GitHubSetupInput, store: AppStore = getAppStore()) {
    const current = await setup(input, store);
    await verifiedInstallation(input, current.stored.doc.installationId, current.token, store);
    const choices = await repositoryChoices(input, current.stored.doc.installationId, current.token, store);
    return { repositories: choices.repositories.filter(repo => repo.permissions?.admin === true && !repo.archived && !repo.disabled && repo.has_issues !== false)
        .map(repo => ({ id: githubId(repo.id), fullName: githubLabel(repo.full_name, 210), private: repo.private === true })), truncated: choices.truncated };
}

export async function saveGitHubRepository(input: GitHubSetupInput & { repositoryId: string | number; confirmPublic: boolean }, store: AppStore = getAppStore()) {
    const current = await setup(input, store);
    const config = githubConfig();
    const id = githubId(input.repositoryId);
    await verifiedInstallation(input, current.stored.doc.installationId, current.token, store);
    const choices = await repositoryChoices(input, current.stored.doc.installationId, current.token, store);
    const selected = choices.repositories.find(repo => githubId(repo.id) === id);
    if (!selected || selected.permissions?.admin !== true || selected.archived || selected.disabled || selected.has_issues === false
        || (selected.private !== true && input.confirmPublic !== true)) throw new GitHubError('repository_not_authorized');
    githubRepositoryPath(selected.owner?.login, selected.name);
    const installation = await authorizedRequest<{ id: number; permissions?: { issues?: string }; suspended_at?: string | null }>(input,
        `/app/installations/${current.stored.doc.installationId}`, githubAppJwt(), store);
    if (githubId(installation.id) !== current.stored.doc.installationId || installation.suspended_at || installation.permissions?.issues !== 'write') throw new GitHubError('installation_unavailable');
    await githubAdmin(input, store);
    const now = new Date().toISOString();
    const { token: _token, ...receipt } = current.stored.doc;
    if (await store.replace({ ...receipt, usedAt: now }, current.stored.etag) !== 'ok') throw new GitHubError('setup_expired');
    const installationDoc: GitHubInstallation = { type: 'github-installation', pk: githubInstallationPk(config.appId, current.stored.doc.installationId), id: 'installation',
        appId: config.appId, installationId: current.stored.doc.installationId, botId: current.stored.doc.botId,
        accountName: current.stored.doc.accountName, status: 'connected', deniedRepositories: [], updatedAt: now };
    const global = await store.get<GitHubInstallation>(installationDoc.pk, installationDoc.id);
    if (global && Date.parse(global.doc.updatedAt) > Date.parse(current.stored.doc.createdAt) && global.doc.status !== 'connected') throw new GitHubError('installation_changed');
    if (global ? await store.replace(installationDoc, global.etag) !== 'ok' : !await store.create(installationDoc)) throw new GitHubError('installation_changed');
    const key = `github_${input.projectId}`;
    const old = await store.get<GitHubConnection>(workspacePk(input.workspaceId), key);
    if (old && Date.parse(old.doc.updatedAt) > Date.parse(current.stored.doc.createdAt)) throw new GitHubError('setup_stale');
    const sameTarget = old?.doc.config.installationId === current.stored.doc.installationId && old.doc.config.repositoryId === id
        && old.doc.config.botId === current.stored.doc.botId;
    const connection: GitHubConnection = { type: 'github-connection', provider: 'github', id: key, pk: workspacePk(input.workspaceId),
        workspaceId: input.workspaceId, projectId: input.projectId, connectedBy: input.userId, enabled: true, status: 'connected',
        destinationRevision: sameTarget ? old!.doc.destinationRevision : (old?.doc.destinationRevision ?? 0) + 1, createdAt: old?.doc.createdAt ?? now, updatedAt: now,
        config: { installationId: current.stored.doc.installationId, repositoryId: id, repositoryNodeId: String(selected.node_id),
            owner: selected.owner.login, name: selected.name, private: selected.private === true, botId: current.stored.doc.botId,
            markerSeed: old?.doc.config.markerSeed ?? randomToken(), authorizedGitHubUserId: current.stored.doc.githubUserId, authorizedAt: now } };
    await githubAdmin(input, store);
    if (old ? await store.replace(connection, old.etag) !== 'ok' : !await store.create(connection)) throw new GitHubError('connection_changed');
    await setIntegrationBinding(input.workspaceId, input.projectId, 'github', { connectionId: key, since: now }, store);
    return connection;
}

export async function getGitHubSettings(project: DbProject, userId: string, setupReceipt?: string, store: AppStore = getAppStore()) {
    await githubAdmin({ userId, workspaceId: project.workspaceId, projectId: project.id }, store);
    const fresh = (await store.get<DbProject>(project.pk, project.id))!.doc;
    const connection = await getIntegrationConnection(fresh, 'github', store) as GitHubConnection | null;
    const stopped = connection ? await Promise.all((['failed', 'ambiguous'] as const).map(status => store.query<IntegrationSync>({
        type: 'github-sync', pk: `github:${project.id}`, where: { connectionId: connection.id, status }, limit: 1000 }))) : [];
    const configured = isGitHubConfigured();
    let status = connection?.status;
    let statusCode = connection?.statusCode;
    if (connection && configured) {
        const installation = (await store.get<GitHubInstallation>(githubInstallationPk(githubConfig().appId, connection.config.installationId), 'installation'))?.doc;
        const revoked = (await store.get<GitHubUserAccess>(githubAppPk(githubConfig().appId), `user_${githubId(connection.config.authorizedGitHubUserId)}`))?.doc;
        if (!installation || installation.status !== 'connected' || installation.deniedRepositories.includes(connection.config.repositoryId)) {
            status = 'paused'; statusCode = 'installation_unavailable';
        } else if (revoked && Date.parse(revoked.revokedAt) >= Date.parse(connection.config.authorizedAt)) {
            status = 'needs_reconnect'; statusCode = 'authorization_revoked';
        }
    }
    let pending: { receipt: string; expiresAt: string; accountName: string } | undefined;
    if (setupReceipt) {
        if (isRandomToken(setupReceipt)) {
            const value = (await store.get<GitHubSetup>(userPk(userId), receiptId(setupReceipt)))?.doc;
            const revoked = value && configured ? (await store.get<GitHubUserAccess>(githubAppPk(githubConfig().appId), `user_${githubId(value.githubUserId)}`))?.doc : undefined;
            if (value?.type === 'github-setup' && value.userId === userId && value.workspaceId === project.workspaceId && value.projectId === project.id
                && !value.usedAt && value.token && Date.parse(value.expiresAt) > Date.now() && (!value.tokenExpiresAt || Date.parse(value.tokenExpiresAt) > Date.now())
                && (!revoked || Date.parse(revoked.revokedAt) < Date.parse(value.createdAt)))
                pending = { receipt: setupReceipt, expiresAt: value.expiresAt, accountName: value.accountName };
        }
    }
    return { configured, connection: connection ? { status: status!, statusCode,
        enabled: connection.enabled, repositoryName: `${githubLabel(connection.config.owner)}/${githubLabel(connection.config.name)}`,
        repositoryVisibility: connection.config.private ? 'private' as const : 'public' as const, lastSyncedAt: connection.lastSyncedAt,
        backfill: connection.backfill ? { queued: connection.backfill.queued, done: connection.backfill.done } : undefined,
        needsReviewCount: stopped.reduce((count, rows) => count + rows.length, 0), needsReviewCountCapped: stopped.some(rows => rows.length >= 1000) } : null,
        ...(pending ? { setup: pending } : {}) };
}

export async function disconnectGitHub(input: GitHubActorInput, store: AppStore = getAppStore()) {
    const project = await githubAdmin(input, store);
    await disconnectIntegration(project, 'github', store);
    for (const row of await store.query<GitHubSetup>({ type: 'github-setup', pk: userPk(input.userId), where: { projectId: input.projectId, workspaceId: input.workspaceId } })) {
        await updateDoc<GitHubSetup>(row.pk, row.id, current => { const { token: _token, ...next } = current; return { ...next, usedAt: new Date().toISOString() }; }, store);
    }
}
