import type { DbMember, DbProject, DbTeam } from './model';

export type AccessSnapshot = { workspaceId: string; teams: readonly DbTeam[] };
export type AccessSubject = Pick<DbMember, 'role' | 'projects' | 'workspaceId' | 'teamIds'>;

/** One reason someone can review a project: the workspace (admin, all projects), the project itself or a team */
export type ProjectAccessGrant =
    | { kind: 'admin' }
    | { kind: 'all' }
    | { kind: 'direct' }
    | { kind: 'team'; team: DbTeam };

/** Every current grant, in the order of `projectAccessSources`. Admin surface only, like the explanations. */
export function projectAccessGrants(
    snapshot: AccessSnapshot,
    member: AccessSubject,
    project: Pick<DbProject, 'id' | 'workspaceId'>
): ProjectAccessGrant[] {
    if (snapshot.workspaceId !== project.workspaceId || member.workspaceId !== project.workspaceId) return [];
    return [
        ...(member.role === 'admin' ? [{ kind: 'admin' } as const] : []),
        ...(member.projects === 'all'
            ? [{ kind: 'all' } as const]
            : member.projects.includes(project.id)
              ? [{ kind: 'direct' } as const]
              : []),
        ...snapshot.teams
            .filter(
                (team) =>
                    team.state === 'active' &&
                    team.workspaceId === project.workspaceId &&
                    member.teamIds?.includes(team.id) &&
                    team.projectIds.includes(project.id)
            )
            .map((team) => ({ kind: 'team', team }) as const)
    ];
}

export function projectAccessSourceLabel(grant: ProjectAccessGrant) {
    switch (grant.kind) {
        case 'admin':
            return 'Workspace admin';
        case 'all':
            return 'All projects (including future projects)';
        case 'direct':
            return 'Direct access';
        case 'team':
            return `Via ${grant.team.name}`;
    }
}

/** Explanations stay on the admin surface. Never add them to a review/guest DTO. */
export function projectAccessSources(
    snapshot: AccessSnapshot,
    member: AccessSubject,
    project: Pick<DbProject, 'id' | 'workspaceId'>
): string[] {
    return projectAccessGrants(snapshot, member, project).map(projectAccessSourceLabel);
}

export function hasProjectAccess(
    snapshot: AccessSnapshot,
    member: AccessSubject,
    project: Pick<DbProject, 'id' | 'workspaceId'>
) {
    if (snapshot.workspaceId !== project.workspaceId || member.workspaceId !== project.workspaceId) return false;
    if (member.role === 'admin' || member.projects === 'all' || member.projects.includes(project.id)) return true;
    const teams = new Set(member.teamIds ?? []);
    return snapshot.teams.some(
        (team) =>
            team.state === 'active' &&
            team.workspaceId === project.workspaceId &&
            teams.has(team.id) &&
            team.projectIds.includes(project.id)
    );
}
