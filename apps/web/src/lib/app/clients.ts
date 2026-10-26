import type { DbProject } from './model';

type ClientProject = Pick<DbProject, 'id' | 'name' | 'status'>;

/** A client: a name set on one or more projects (`clientName`), not a document of its own */
export type Client = { name: string; projects: ClientProject[] };

/**
 * The clients of the given projects, by name. Pass only the projects the person can see
 * (`listVisibleProjects`), so client names never come from projects they cannot open.
 */
export function projectClients(projects: (ClientProject & Pick<DbProject, 'clientName'>)[]): Client[] {
    const clients = new Map<string, ClientProject[]>();
    for (const { id, name, status, clientName } of projects) {
        if (clientName)
            clients.set(clientName, [...clients.get(clientName) ?? [], { id, name, status }]);
    }
    return [...clients]
        .map(([name, clientProjects]) => ({ name, projects: clientProjects }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** The client names of the given (visible) projects, sorted */
export function clientNames(projects: Pick<DbProject, 'clientName'>[]) {
    return [...new Set(projects.flatMap(project => project.clientName ? [project.clientName] : []))]
        .sort((a, b) => a.localeCompare(b));
}
