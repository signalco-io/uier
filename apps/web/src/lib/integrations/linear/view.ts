import type { DbProject } from '../../app/model';
import { getAppStore } from '../../app/store';
import type { IntegrationSync } from '../model';
import { isLinearConfigured } from './config';
import { linearConnection, requireLinearAdmin } from './connection';
import type { LinearGrant } from './model';

export async function getLinearSettings(project: DbProject, userId: string) {
    const current = await requireLinearAdmin(project, userId);
    const connection = await linearConnection(current);
    const candidate = connection ? (await getAppStore().get<LinearGrant>(connection.pk, connection.grantId))?.doc : null;
    const grant = candidate?.type === 'linear-grant' && candidate.workspaceId === current.workspaceId && candidate.provider === 'linear' ? candidate : null;
    const review = connection ? await Promise.all((['failed', 'ambiguous'] as const).map(status => getAppStore().query<IntegrationSync>({
        type: 'linear-sync', pk: `linear:${current.id}`, where: { connectionId: connection.id, status }, limit: 1000 }))) : [];
    const ledgers = review.flat();
    return { configured: isLinearConfigured(), connected: Boolean(connection && grant && connection.statusCode !== 'disconnected'),
        status: connection?.status ?? 'not_connected', statusCode: connection?.statusCode, enabled: connection?.enabled ?? false,
        organizationName: grant?.organizationName, teamName: connection?.config.teamName, projectName: connection?.config.projectName,
        teamId: connection?.config.teamId, linearProjectId: connection?.config.projectId,
        openStateId: connection?.config.openStateId, doneStateId: connection?.config.doneStateId,
        labelIds: connection?.config.labelIds ?? [], screenshots: connection?.config.screenshots === true,
        lastSyncedAt: connection?.lastSyncedAt, pausedUntil: grant?.pausedUntil,
        backfill: connection?.backfill ? { queued: connection.backfill.queued, total: connection.backfill.threadIds.length, done: connection.backfill.done } : undefined,
        needsReviewCount: ledgers.length, needsReviewCountCapped: review.some(page => page.length === 1000) };
}
