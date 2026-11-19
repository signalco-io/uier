import { workflowStatusIdSchema } from './statusWorkflowSchema';
import { projectIdSchema } from './validation';

export const boardCollapseCookieNames = { secure: '__Host-uier_board_collapse', local: 'uier_board_collapse' };
export const boardCollapseCookieLifetime = 365 * 24 * 60 * 60;

// One bounded presentation cookie, in least-to-most recently updated project order.
const maxLength = 3000;

function validEntry(project: string | undefined, ids: string[]) {
    return projectIdSchema.safeParse(project).success && ids.length > 0 && ids.length <= 30
        && ids.every(id => workflowStatusIdSchema.safeParse(id).success);
}

export function parseBoardCollapseCookie(value: string | undefined): Map<string, string[]> {
    const projects = new Map<string, string[]>();
    if (!value || value.length > maxLength) return projects;
    for (const entry of value.split('|')) {
        const [project, statuses, extra] = entry.split(':');
        if (extra !== undefined || !project || !statuses) continue;
        const ids = statuses.split('.');
        if (validEntry(project, ids)) projects.set(project, ids);
    }
    return projects;
}

export function serializeBoardCollapseCookie(projects: Map<string, string[]>) {
    let value = '';
    for (const [project, ids] of [...projects].reverse()) {
        if (!validEntry(project, ids)) continue;
        const entry = `${project}:${ids.join('.')}`;
        const next = value ? `${entry}|${value}` : entry;
        if (next.length > maxLength) break;
        value = next;
    }
    return value;
}
