import type { DbProject } from './model';
import { getCommentsStore } from '../repo/commentsStore';
import { commentVisibilityFilter, projectPartition } from '../review/comments';
import type { AppContext } from './context';
import { loadClients, projectClient, type ClientSummary } from './clients';
import { appActor } from './projectComments';
import { listsProject, type OrderableProject, type ProjectOrder } from './projectOrder';

/** A project in the sidebar's quick switcher; grouped by client, the client's tile (its logo, else its icon or letter) heads its projects */
export type SidebarProject = OrderableProject & { url?: string; client?: Pick<ClientSummary, 'id' | 'name' | 'icon' | 'color' | 'logoUrl'> };

/**
 * When a project last changed for this member: the newest `updatedAt` of a thread they can see (a comment, reply,
 * edit or status change), else when it was created. One bounded aggregate per project, with `canSeeComment`'s
 * rule in the query, so a private thread counts only for those who can open it.
 */
async function projectActivityAt(context: AppContext, project: DbProject) {
    const domain = projectPartition(project.id);
    try {
        const latest = await getCommentsStore().latestActivity(domain, commentVisibilityFilter(domain, appActor(context)));
        return latest && latest > project.createdAt ? latest : project.createdAt;
    } catch (error) {
        // Only the order depends on it: the navigation still opens, with the project's creation time
        console.warn('[app] Sidebar project activity is unavailable; ordering by creation time', error);
        return project.createdAt;
    }
}

/**
 * The projects for the sidebar, active and done, with their client to group by; the order picks which it lists
 * (`listsProject`), so switching to grouping by status shows the done ones at once. The shell layout renders on
 * every refresh, so comments are read only for Recent activity and only for the listed projects; otherwise
 * `activityAt` is the creation time. Choosing a new order saves the cookie in a server action, and Next renders
 * the layout again with the activity.
 */
export async function loadSidebarProjects(context: AppContext, projects: DbProject[], order: ProjectOrder): Promise<SidebarProject[]> {
    const listed = projects.map(project => listsProject(order, project));
    const [clients, activity] = await Promise.all([
        projects.some(project => project.status !== 'done' && project.clientId) ? loadClients(context.workspace.id) : undefined,
        order.sort === 'recent'
            ? Promise.all(projects.map((project, index) => (listed[index] ? projectActivityAt(context, project) : undefined)))
            : undefined
    ]);
    return projects.map((project, index) => {
        const client = clients && projectClient(project, clients);
        return {
            id: project.id,
            name: project.name,
            url: project.urls[0],
            status: project.status === 'done' ? 'done' : 'active',
            createdAt: project.createdAt,
            activityAt: activity?.[index] ?? project.createdAt,
            client: client && { id: client.id, name: client.name, icon: client.icon, color: client.color, ...(client.logoUrl ? { logoUrl: client.logoUrl } : {}) }
        };
    });
}
