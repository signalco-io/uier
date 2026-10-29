import type { ExternalFeedbackLink } from '@uier/toolbar/feedback-context';
import { memberId, workspacePk, type DbMember, type DbProject } from '../app/model';
import { hasProjectAccess, loadWorkspaceAccess } from '../app/access';
import { getAppStore } from '../app/store';
import { isPrivateAppFeedback, PUBLIC_PROJECT_ID } from '../comments/publicProject';
import type { DbComment } from '../db/schema';
import { getCommentsStore } from '../repo/commentsStore';
import type { ProjectActor } from '../review/actor';
import { getIntegrationConnection } from './connection';
import { integrationPk, integrationSyncId, type DiscoveryOptions } from './discovery';
import { integrationRegistry } from './registry';
import type { IntegrationSync } from './model';

/** Browser-safe projection only. Provider records, attempts, grants and ids never cross this boundary. */
export async function loadIntegrationLinks(project: DbProject, actor: ProjectActor, sources: readonly DbComment[], options: DiscoveryOptions = {}) {
    const links = new Map<string, ExternalFeedbackLink[]>();
    if (actor.kind !== 'member' || project.id === PUBLIC_PROJECT_ID) return links;
    const store = options.store ?? getAppStore();
    const comments = options.comments ?? getCommentsStore();
    const current = (await store.get<DbProject>(workspacePk(project.workspaceId), project.id))?.doc;
    const member = (await store.get<DbMember>(workspacePk(project.workspaceId), memberId(actor.userId)))?.doc;
    if (!current || current.type !== 'project' || current.workspaceId !== project.workspaceId || member?.type !== 'member'
        || member.workspaceId !== project.workspaceId || !hasProjectAccess(await loadWorkspaceAccess(project.workspaceId, store), member, current)) return links;
    const visibleIds = new Set(sources.filter(source => source.projectId === project.id && source.domain === `project:${project.id}`
        && !source.private && !isPrivateAppFeedback(source)).map(source => source.id));
    for (const adapter of integrationRegistry(options.adapters).values()) {
        const { externalLink, validateExternalLink } = adapter;
        if (!externalLink || !validateExternalLink) continue;
        const connection = await getIntegrationConnection(current, adapter.provider, store);
        if (!connection || connection.status !== 'connected') continue;
        // Read only the visible source set, never an unbounded history of deleted/retired ledgers.
        const ids = [...visibleIds];
        for (let offset = 0; offset < ids.length; offset += 25) {
            const ledgers = await Promise.all(ids.slice(offset, offset + 25).map(id => store.get<IntegrationSync>(
                integrationPk(adapter.provider, project.id), integrationSyncId(adapter.provider, connection.id, project.id, id))));
            await Promise.all(ledgers.map(async record => {
                const ledger = record?.doc;
                if (!ledger || ledger.type !== `${adapter.provider}-sync` || ledger.connectionId !== connection.id || ledger.projectId !== project.id) return;
                if (!visibleIds.has(ledger.threadId) || ledger.workspaceId !== project.workspaceId || ledger.provider !== adapter.provider
                    || ledger.status === 'suppressed' || ledger.tombstoned || ledger.deletion) return;
                const source = (await comments.get(`project:${project.id}`, ledger.threadId))?.comment;
                if (!source || source.private || isPrivateAppFeedback(source)) return;
                try {
                    const value = externalLink(connection, ledger);
                    if (!value) return;
                    const url = new URL(value);
                    if (url.protocol !== 'https:' || url.username || url.password || !validateExternalLink(url, connection, ledger)) return;
                    links.set(ledger.threadId, [...(links.get(ledger.threadId) ?? []), { provider: adapter.provider, url: url.href }]);
                } catch { /* An invalid provider URL is omitted, never reflected into a client payload. */ }
            }));
        }
    }
    return links;
}
