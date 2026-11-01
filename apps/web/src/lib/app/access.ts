import type { DbTeam } from './model';
import { cache } from 'react';
import { workspacePk } from './model';
import { getAppStore, type AppStore } from './store';
import { MAX_ACTIVE_TEAMS } from './limits';
import { PUBLIC_WORKSPACE_ID } from '../comments/publicProjectPolicy';

import type { AccessSnapshot } from './accessRules';
export { hasProjectAccess, projectAccessGrants, projectAccessSources } from './accessRules';
export type { AccessSnapshot, AccessSubject, ProjectAccessGrant } from './accessRules';

/** One bounded, partition-scoped query per list operation, never a process-wide positive cache. */
export async function loadWorkspaceAccess(
    workspaceId: string,
    store: AppStore = getAppStore()
): Promise<AccessSnapshot> {
    if (workspaceId === PUBLIC_WORKSPACE_ID) return { workspaceId, teams: [] };
    const teams = await store.query<DbTeam>({
        type: 'team',
        pk: workspacePk(workspaceId),
        where: { state: 'active' },
        limit: MAX_ACTIVE_TEAMS + 1
    });
    if (teams.length > MAX_ACTIVE_TEAMS)
        throw new Error('Workspace team limit exceeded. Retry after an admin corrects it.');
    return {
        workspaceId,
        teams: teams.filter((team) => team.workspaceId === workspaceId && team.pk === workspacePk(workspaceId))
    };
}

/** Share only render reads; mutation retries must use the uncached loader above. */
export const loadWorkspaceAccessForRender = cache((workspaceId: string) => loadWorkspaceAccess(workspaceId));
