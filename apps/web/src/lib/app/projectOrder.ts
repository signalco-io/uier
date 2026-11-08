/**
 * How the sidebar lists the projects: sorted by their latest activity, their creation or their name, and grouped
 * by nothing, by client or by status. Only grouped by status does it list the done projects too.
 */
export const projectSorts = ['recent', 'created', 'alphabetical'] as const;
export type ProjectSort = typeof projectSorts[number];
export const projectGroupings = ['none', 'client', 'status'] as const;
export type ProjectGrouping = typeof projectGroupings[number];
export type ProjectOrder = { sort: ProjectSort; group: ProjectGrouping };

export const defaultProjectOrder: ProjectOrder = { sort: 'recent', group: 'none' };

/**
 * The cookie value: the sort, then `.client` or `.status` when grouped (`recent`, `alphabetical.client`,
 * `created.status`). The values from before the Group choice (`recent`, `alphabetical`, `recent.client`,
 * `alphabetical.client`) are the same strings, so a saved order reads back as it was.
 */
export function formatProjectOrder({ sort, group }: ProjectOrder) {
    return group === 'none' ? sort : `${sort}.${group}`;
}

const isOneOf = <T extends string>(values: readonly T[], value: string | undefined): value is T =>
    (values as readonly string[]).includes(value ?? '');

/** A saved order, or the default for a missing or unknown value */
export function parseProjectOrder(value: string | undefined): ProjectOrder {
    const [sort, group, ...rest] = (value ?? '').split('.');
    if (!isOneOf(projectSorts, sort) || rest.length || (group !== undefined && (group === 'none' || !isOneOf(projectGroupings, group))))
        return defaultProjectOrder;
    return { sort, group: group ?? 'none' };
}

/** Whether the order lists a project: grouped by status every project, otherwise only the active ones */
export function listsProject(order: ProjectOrder, project: { status?: 'active' | 'done' }) {
    return order.group === 'status' || project.status !== 'done';
}

export type OrderableProject = {
    id: string;
    name: string;
    /** Missing means active */
    status?: 'active' | 'done';
    /** ISO 8601 */
    createdAt: string;
    /**
     * ISO 8601: the newest change to a thread the person can see, or when the project was created. The server reads
     * activity only for Recent activity; otherwise it is the creation time.
     */
    activityAt: string;
    client?: { id: string; name: string };
};

export type ProjectGroup<T extends OrderableProject> = {
    /** Grouped by client: the client, missing for the projects without one */
    client?: NonNullable<T['client']>;
    /** Grouped by status: Active or Done */
    status?: 'active' | 'done';
    projects: T[];
};

// The server render and the browser must agree on the order: names use a fixed locale, ids and ISO timestamps
// compare by code unit (no locale at all)
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Newest first for the time sorts; nothing for Name, which the tie-breakers order */
function byTime(sort: ProjectSort, a: OrderableProject, b: OrderableProject) {
    return sort === 'recent' ? byCodeUnit(b.activityAt, a.activityAt)
        : sort === 'created' ? byCodeUnit(b.createdAt, a.createdAt)
        : 0;
}

/**
 * The listed projects in the chosen order:
 * - not grouped: one list;
 * - by client: each client is a group, ordered like its projects (by name, or the one with the latest activity or
 *   creation first), and the projects without a client come last. Without any client there is nothing to group by,
 *   so the projects stay one list;
 * - by status: Active, then Done, each left out when it has no projects.
 */
export function orderProjects<T extends OrderableProject>(projects: T[], { sort, group }: ProjectOrder): ProjectGroup<T>[] {
    const sorted = projects.filter(project => listsProject({ sort, group }, project))
        .sort((a, b) => byTime(sort, a, b) || collator.compare(a.name, b.name) || byCodeUnit(a.id, b.id));
    if (group === 'status')
        return (['active', 'done'] as const)
            .map(status => ({ status, projects: sorted.filter(project => (project.status ?? 'active') === status) }))
            .filter(({ projects: listed }) => listed.length);
    if (group !== 'client' || !sorted.some(project => project.client))
        return [{ projects: sorted }];
    const groups = new Map<string, ProjectGroup<T> & { client: NonNullable<T['client']> }>();
    for (const project of sorted) {
        if (!project.client) continue;
        const clientGroup = groups.get(project.client.id) ?? { client: project.client as NonNullable<T['client']>, projects: [] };
        clientGroup.projects.push(project);
        groups.set(project.client.id, clientGroup);
    }
    // Projects are sorted already: each group's first project is its latest (or, by name, its first)
    const clients = [...groups.values()].sort((a, b) => byTime(sort, a.projects[0]!, b.projects[0]!)
        || collator.compare(a.client.name, b.client.name) || byCodeUnit(a.client.id, b.client.id));
    const withoutClient = sorted.filter(project => !project.client);
    return withoutClient.length ? [...clients, { projects: withoutClient }] : clients;
}
