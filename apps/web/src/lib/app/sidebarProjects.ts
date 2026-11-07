import { cookies } from 'next/headers';
import type { DbProject } from './model';
import { cookieName, cookieNames } from '../cookieNames';
import { getCommentsStore } from '../repo/commentsStore';
import { canSeeComment, projectPartition } from '../review/comments';
import type { AppContext } from './context';
import { loadClients, projectClient, type ClientSummary } from './clients';
import { appActor } from './projectComments';
import { parseProjectOrder, type OrderableProject } from './projectOrder';

/** A project in the sidebar's quick switcher; grouped by client, the client's tile heads its projects */
export type SidebarProject = OrderableProject & { url?: string; client?: Pick<ClientSummary, 'id' | 'name' | 'icon' | 'color'> };

/** New after the cookie migration: read only by its current name (the local HTTP name in development) */
export const PROJECT_ORDER_COOKIE_NAME = cookieName(cookieNames.projectOrder);

/** How this browser lists the sidebar's projects (`saveProjectOrderAction` stores it) */
export async function getProjectOrder() {
    return parseProjectOrder((await cookies()).get(PROJECT_ORDER_COOKIE_NAME)?.value);
}

/**
 * When a project last changed for this member: its newest change to a thread they can see (a comment, reply,
 * edit or status change), or when it was created. Reads only the compact activity projection, with the same
 * visibility check as the project's comments, so a private thread counts only for those who can open it.
 */
async function projectActivityAt(context: AppContext, project: DbProject) {
    const actor = appActor(context);
    try {
        const records = await getCommentsStore().listActivity(projectPartition(project.id));
        return records.filter(record => canSeeComment(record, actor))
            .reduce((latest, record) => {
                const at = record.updatedAt ?? record.createdAt ?? '';
                return at > latest ? at : latest;
            }, project.createdAt);
    } catch (error) {
        // Only the order depends on it: the navigation still opens, with the project's creation time
        console.warn('[app] Sidebar project activity is unavailable; ordering by creation time', error);
        return project.createdAt;
    }
}

/** The active projects for the sidebar, with their client and latest activity to order and group them by */
export async function loadSidebarProjects(context: AppContext, projects: DbProject[]): Promise<SidebarProject[]> {
    const active = projects.filter(project => project.status !== 'done');
    const [clients, activity] = await Promise.all([
        active.some(project => project.clientId) ? loadClients(context.workspace.id) : undefined,
        Promise.all(active.map(project => projectActivityAt(context, project)))
    ]);
    return active.map((project, index) => {
        const client = clients && projectClient(project, clients);
        return {
            id: project.id,
            name: project.name,
            url: project.urls[0],
            activityAt: activity[index] ?? project.createdAt,
            client: client && { id: client.id, name: client.name, icon: client.icon, color: client.color }
        };
    });
}
