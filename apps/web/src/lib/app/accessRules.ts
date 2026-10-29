import type { DbMember, DbProject, DbTeam } from './model';

export type AccessSnapshot = { workspaceId: string; teams: readonly DbTeam[] };
export type AccessSubject = Pick<DbMember, 'role' | 'projects' | 'workspaceId' | 'teamIds'>;

/** Explanations stay on the admin surface. Never add them to a review/guest DTO. */
export function projectAccessSources(
    snapshot: AccessSnapshot,
    member: AccessSubject,
    project: Pick<DbProject, 'id' | 'workspaceId'>
): string[] {
    if (snapshot.workspaceId !== project.workspaceId || member.workspaceId !== project.workspaceId) return [];
    return [
        ...(member.role === 'admin' ? ['Workspace admin'] : []),
        ...(member.projects === 'all'
            ? ['All projects (including future projects)']
            : member.projects.includes(project.id)
              ? ['Direct access']
              : []),
        ...snapshot.teams
            .filter(
                (team) =>
                    team.state === 'active' &&
                    team.workspaceId === project.workspaceId &&
                    member.teamIds?.includes(team.id) &&
                    team.projectIds.includes(project.id)
            )
            .map((team) => `Via ${team.name}`)
    ];
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
