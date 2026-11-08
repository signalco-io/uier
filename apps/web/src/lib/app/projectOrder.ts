/** How the sidebar lists the active projects: by their latest activity or by name, optionally under their clients */
export const projectSorts = ['recent', 'alphabetical'] as const;
export type ProjectSort = typeof projectSorts[number];
export type ProjectOrder = { sort: ProjectSort; groupByClient: boolean };

export const defaultProjectOrder: ProjectOrder = { sort: 'recent', groupByClient: false };

/** The cookie value: the sort, then `.client` when grouped (`recent`, `alphabetical.client`) */
export function formatProjectOrder({ sort, groupByClient }: ProjectOrder) {
    return groupByClient ? `${sort}.client` : sort;
}

/** A saved order, or the default for a missing or unknown value */
export function parseProjectOrder(value: string | undefined): ProjectOrder {
    const [sort, group, ...rest] = (value ?? '').split('.');
    if (!(projectSorts as readonly string[]).includes(sort ?? '') || rest.length || (group !== undefined && group !== 'client'))
        return defaultProjectOrder;
    return { sort: sort as ProjectSort, groupByClient: group === 'client' };
}

export type OrderableProject = {
    id: string;
    name: string;
    /**
     * ISO 8601: the newest change to a thread the person can see, or when the project was created. The server reads
     * activity only for Recent activity; ordered by name, it is the creation time.
     */
    activityAt: string;
    client?: { id: string; name: string };
};

export type ProjectGroup<T extends OrderableProject> = {
    /** Missing for the projects without a client, and for the one list when not grouped */
    client?: NonNullable<T['client']>;
    projects: T[];
};

// The server render and the browser must agree on the order: names use a fixed locale, ids and ISO timestamps
// compare by code unit (no locale at all)
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function compare<T extends OrderableProject>(sort: ProjectSort) {
    return (a: T, b: T) => (sort === 'recent' ? byCodeUnit(b.activityAt, a.activityAt) : 0)
        || collator.compare(a.name, b.name) || byCodeUnit(a.id, b.id);
}

/**
 * The projects in the chosen order. Grouped, each client is a group, ordered like its projects (by name, or the
 * one with the latest activity first), and the projects without a client come last. Without any client there is
 * nothing to group by, so the projects stay one list.
 */
export function orderProjects<T extends OrderableProject>(projects: T[], { sort, groupByClient }: ProjectOrder): ProjectGroup<T>[] {
    const sorted = [...projects].sort(compare<T>(sort));
    if (!groupByClient || !sorted.some(project => project.client))
        return [{ projects: sorted }];
    const groups = new Map<string, ProjectGroup<T> & { client: NonNullable<T['client']> }>();
    for (const project of sorted) {
        if (!project.client) continue;
        const group = groups.get(project.client.id) ?? { client: project.client as NonNullable<T['client']>, projects: [] };
        group.projects.push(project);
        groups.set(project.client.id, group);
    }
    const clients = [...groups.values()].sort((a, b) => (sort === 'recent'
        // Projects are sorted already: each group's first project is its latest activity
        ? byCodeUnit(b.projects[0]!.activityAt, a.projects[0]!.activityAt) : 0)
        || collator.compare(a.client.name, b.client.name) || byCodeUnit(a.client.id, b.client.id));
    const withoutClient = sorted.filter(project => !project.client);
    return withoutClient.length ? [...clients, { projects: withoutClient }] : clients;
}
