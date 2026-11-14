import { workspacePk } from '../../../app/model';
import { getAppStore, type AppMutation } from '../../../app/store';
import { createOauthState, type ConsumedOauthState } from '../../oauthState';
import { encryptSecret } from '../../secrets';
import { NotionApiError, NotionClient, sameId } from '../client';
import { isNotionConfigured, notionAuthorizeUrl, notionKey, notionRedirectUri } from '../config';
import { notionSecretContext, notionTokenResponse, type NotionServices } from '../connection';
import type { NotionGrant } from '../model';
import { notionWorkspaceAuthority } from './authority';
import { NOTION_PROJECTS_SCOPE, notionProjectsConnectionId, notionProjectsGrantId, type NotionProjectsConnection } from './model';

export async function beginNotionProjectsConnect(input: { userId: string; workspaceId: string; baseUrl: string }, services: NotionServices = {}) {
    const store = services.store ?? getAppStore();
    await notionWorkspaceAuthority(input.workspaceId, input.userId, store);
    if (!isNotionConfigured()) throw new NotionApiError(503, 'not_configured');
    const { state } = await createOauthState({ ...input, provider: 'notion', projectId: NOTION_PROJECTS_SCOPE, intent: 'manage-projects', pkce: false }, store);
    const url = new URL(notionAuthorizeUrl());
    url.search = new URLSearchParams({ client_id: process.env.NOTION_CLIENT_ID!, redirect_uri: notionRedirectUri(input.baseUrl), response_type: 'code', owner: 'user', state }).toString();
    return url.href;
}

// The existing callback consumes the user-bound single-use state before dispatching here.
export async function finishNotionProjectsConnect(input: { userId: string; code?: unknown; error?: unknown; baseUrl: string }, state: ConsumedOauthState, services: NotionServices = {}) {
    const store = services.store ?? getAppStore();
    const result = { workspaceId: state.workspaceId, projectId: NOTION_PROJECTS_SCOPE };
    await notionWorkspaceAuthority(state.workspaceId, input.userId, store);
    if (input.error === 'access_denied') return { ...result, status: 'denied' as const };
    if (input.error || !isNotionConfigured() || typeof input.code !== 'string' || !input.code || input.code.length > 4096)
        return { ...result, status: 'failed' as const };
    const pk = workspacePk(state.workspaceId);
    // Snapshot before the exchange: a later disconnect/reconnect must win over this callback.
    const previous = await store.get<NotionProjectsConnection>(pk, notionProjectsConnectionId);
    const oldGrant = await store.get<NotionGrant>(pk, notionProjectsGrantId);
    try {
        const token = notionTokenResponse(await (services.client ?? new NotionClient()).oauth({ grant_type: 'authorization_code', code: input.code,
            redirect_uri: notionRedirectUri(input.baseUrl) }));
        const guards = await notionWorkspaceAuthority(state.workspaceId, input.userId, store);
        const now = new Date().toISOString();
        const same = previous && sameId(previous.doc.config.notionWorkspaceId, token.notionWorkspaceId);
        const connection: NotionProjectsConnection = { type: 'notion-projects-connection', provider: 'notion', pk, id: notionProjectsConnectionId,
            workspaceId: state.workspaceId, projectId: NOTION_PROJECTS_SCOPE, connectedBy: input.userId, grantId: notionProjectsGrantId,
            enabled: Boolean(same && previous.doc.enabled), status: 'connected', destinationRevision: (previous?.doc.destinationRevision ?? 0) + 1,
            config: { ...(same ? previous.doc.config : {}), notionWorkspaceId: token.notionWorkspaceId, notionWorkspaceName: token.notionWorkspaceName },
            nextAttemptAt: now, createdAt: previous?.doc.createdAt ?? now, updatedAt: now };
        const grant: NotionGrant = { type: 'notion-grant', provider: 'notion', pk, id: notionProjectsGrantId,
            workspaceId: state.workspaceId, projectId: NOTION_PROJECTS_SCOPE, connectedBy: input.userId, botId: token.botId,
            notionWorkspaceId: token.notionWorkspaceId, notionWorkspaceName: token.notionWorkspaceName,
            generation: (oldGrant?.doc.generation ?? 0) + 1, status: 'connected', issuedAt: now };
        grant.tokens = { access: encryptSecret(token.access, notionSecretContext(grant, 'access'), notionKey()),
            ...(token.refresh ? { refresh: encryptSecret(token.refresh, notionSecretContext(grant, 'refresh'), notionKey()) } : {}) };
        const operations: AppMutation[] = [...guards,
            previous ? { kind: 'replace', doc: connection, etag: previous.etag } : { kind: 'create', doc: connection },
            oldGrant ? { kind: 'replace', doc: grant, etag: oldGrant.etag } : { kind: 'create', doc: grant }];
        if (!await store.transact(operations)) throw new NotionApiError(409, 'connection_changed');
        return { ...result, status: 'connected' as const };
    } catch { return { ...result, status: 'failed' as const }; }
}
