import type { AppContext } from '@/src/lib/app/context';
import { loadWorkspaceAccess } from '@/src/lib/app/access';
import { getUser } from '@/src/lib/app/users';
import { currentDomainTeams, emailDomain, listWorkspaceDomains, suggestedDomain } from '@/src/lib/app/workspaceDomains';
import { WorkspaceDomains } from './WorkspaceDomains';

/** Workspace settings: the email domains people can join from, the active teams to choose and the admin's own domain */
export async function WorkspaceDomainsSection({ context }: { context: AppContext }) {
    const workspaceId = context.workspace.id;
    const [domains, access] = await Promise.all([listWorkspaceDomains(workspaceId), loadWorkspaceAccess(workspaceId)]);
    const teamNames = new Map(access.teams.map(team => [team.id, team.name]));
    const views = await Promise.all(domains.map(async domain => {
        const [teamIds, addedBy] = await Promise.all([currentDomainTeams(domain), getUser(domain.addedBy)]);
        return {
            domain: domain.domain,
            teams: teamIds.flatMap(id => teamNames.has(id) ? [{ id, name: teamNames.get(id)! }] : []),
            addedByName: addedBy?.name
        };
    }));
    return (
        <WorkspaceDomains
            domains={views}
            teams={access.teams.map(team => ({ id: team.id, name: team.name })).sort((a, b) => a.name.localeCompare(b.name))}
            suggestion={suggestedDomain(context.user.email, domains)}
            ownDomain={emailDomain(context.user.email)} />
    );
}
