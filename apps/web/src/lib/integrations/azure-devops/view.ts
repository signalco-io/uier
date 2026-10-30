import type { DbProject } from '../../app/model';
import { getAppStore } from '../../app/store';
import type { IntegrationSync } from '../model';
import { isAzureDevOpsConfigured } from './config';
import { azureDevOpsConnection, requireAzureDevOpsAdmin } from './connection';
import type { AzureDevOpsGrant } from './model';

/** Server allowlist for settings: names and states only, never grant ids, tokens or Microsoft user ids. */
export async function getAzureDevOpsSettings(project: DbProject, userId: string) {
    const current = await requireAzureDevOpsAdmin(project, userId);
    const connection = await azureDevOpsConnection(current);
    const candidate = connection ? (await getAppStore().get<AzureDevOpsGrant>(connection.pk, connection.grantId))?.doc : null;
    const grant = candidate?.type === 'azure-devops-grant' && candidate.workspaceId === current.workspaceId && candidate.connectionId === connection?.id ? candidate : null;
    const review = connection ? await Promise.all((['failed', 'ambiguous'] as const).map(status => getAppStore().query<IntegrationSync>({
        type: 'azure-devops-sync', pk: `azure-devops:${current.id}`, where: { connectionId: connection.id, status }, limit: 1000 }))) : [];
    const config = connection?.config;
    return { configured: isAzureDevOpsConfigured(), connected: Boolean(connection && grant && connection.statusCode !== 'disconnected'),
        status: connection?.status ?? 'not_connected', statusCode: connection?.statusCode, enabled: connection?.enabled ?? false,
        accountName: grant?.status === 'connected' ? grant.userName : undefined,
        organization: config?.organization, azureProjectId: config?.projectId, azureProjectName: config?.projectName,
        workItemType: config?.workItemType, openState: config?.openState, doneState: config?.doneState, areaPath: config?.areaPath,
        lastSyncedAt: connection?.lastSyncedAt, pausedUntil: grant?.pausedUntil && Date.parse(grant.pausedUntil) > Date.now() ? grant.pausedUntil : undefined,
        backfill: connection?.backfill ? { queued: connection.backfill.queued, total: connection.backfill.threadIds.length, done: connection.backfill.done } : undefined,
        needsReviewCount: review.flat().length, needsReviewCountCapped: review.some(page => page.length === 1000) };
}
