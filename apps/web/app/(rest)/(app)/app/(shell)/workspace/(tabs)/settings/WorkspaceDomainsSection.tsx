import type { AppContext } from '@/src/lib/app/context';
import { loadWorkspaceAccess } from '@/src/lib/app/access';
import { freshlyProvenEmail } from '@/src/lib/app/emailProof';
import { getSessionEmailProof } from '@/src/lib/app/session';
import { getUser } from '@/src/lib/app/users';
import { currentDomainTeams, emailDomain, listWorkspaceDomains, suggestedDomain } from '@/src/lib/app/workspaceDomains';
import { WorkspaceDomains } from './WorkspaceDomains';

/**
 * Workspace settings: the email domains people can join from, the active teams to choose, the admin's own domain
 * and whether their sign-in proved their email recently enough to add it (`emailProof.ts`)
 */
export async function WorkspaceDomainsSection({ context }: { context: AppContext }) {
    const workspaceId = context.workspace.id;
    const [domains, access, proof] = await Promise.all([listWorkspaceDomains(workspaceId), loadWorkspaceAccess(workspaceId),
        getSessionEmailProof(context.user)]);
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
            ownDomain={emailDomain(context.user.email)}
            // Rendered per request (the app pages are dynamic), so the time is current
            signInAgain={!freshlyProvenEmail(context.user.email, proof)} />
    );
}
