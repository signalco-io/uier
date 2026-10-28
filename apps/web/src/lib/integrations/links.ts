import type { ExternalFeedbackLink } from '@uier/toolbar/feedback-context';
import { memberId, workspacePk, type DbMember, type DbProject } from '../app/model';
import { getAppStore } from '../app/store';
import { isPrivateAppFeedback, PUBLIC_PROJECT_ID } from '../comments/publicProject';
import type { DbComment } from '../db/schema';
import { getCommentsStore } from '../repo/commentsStore';
import type { ProjectActor } from '../review/actor';
import { getIntegrationConnection } from './connection';
import { integrationPk, type DiscoveryOptions } from './discovery';
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
        || member.workspaceId !== project.workspaceId || !(member.role === 'admin' || member.projects === 'all' || member.projects.includes(project.id))) return links;
    const visibleIds = new Set(sources.filter(source => source.projectId === project.id && source.domain === `project:${project.id}`
        && !source.private && !isPrivateAppFeedback(source)).map(source => source.id));
    for (const adapter of integrationRegistry(options.adapters).values()) {
        if (!adapter.externalLink || !adapter.validateExternalLink) continue;
        const connection = await getIntegrationConnection(current, adapter.provider, store);
        if (!connection || connection.status !== 'connected') continue;
        const ledgers = await store.query<IntegrationSync>({ type: `${adapter.provider}-sync`, pk: integrationPk(adapter.provider, project.id),
            where: { connectionId: connection.id } });
        for (const ledger of ledgers) {
            if (!visibleIds.has(ledger.threadId) || ledger.workspaceId !== project.workspaceId || ledger.provider !== adapter.provider
                || ledger.status === 'suppressed' || ledger.tombstoned || ledger.deletion) continue;
            const source = (await comments.get(`project:${project.id}`, ledger.threadId))?.comment;
            if (!source || source.private || isPrivateAppFeedback(source)) continue;
            try {
                const value = adapter.externalLink(connection, ledger);
                if (!value) continue;
                const url = new URL(value);
                if (url.protocol !== 'https:' || url.username || url.password || !adapter.validateExternalLink(url, connection, ledger)) continue;
                links.set(ledger.threadId, [...(links.get(ledger.threadId) ?? []), { provider: adapter.provider, url: url.href }]);
            } catch { /* An invalid provider URL is omitted, never reflected into a client payload. */ }
        }
    }
    return links;
}
