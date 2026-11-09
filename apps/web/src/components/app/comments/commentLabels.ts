import type { DbDeviceSize } from '../../../lib/db/schema';

export const deviceLabels: Record<DbDeviceSize, string> = {
    desktop: 'Desktop',
    tablet: 'Tablet',
    mobile: 'Mobile'
};

/** "Open in Notion": the connected services a comment was sent to */
export const integrationLabels: Record<string, string> = {
    notion: 'Notion',
    github: 'GitHub',
    linear: 'Linear',
    slack: 'Slack',
    'azure-devops': 'Azure DevOps'
};

/** Only an opaque server reference and a display name cross the client boundary. */
export type AuthorFilter = { reference: string; name: string };

/** `unassigned`: threads with no assignee, as MCP `list_feedback`'s `assignee: "unassigned"` */
export type PeopleFilter = 'all' | 'assigned' | 'unassigned' | 'mine';
export type CommentsView = 'list' | 'board';
/**
 * `active` (the default): every status but Done, so Open, In progress and Ready to verify; the others
 * are one status each, and `all` adds Done. Deleted threads are never listed.
 */
export type StatusFilter = 'active' | 'open' | 'in-progress' | 'ready' | 'done' | 'all';

/** The list's status filter, in order: Active first, then the board's columns, then All */
export const statusFilterLabels: Record<StatusFilter, string> = {
    active: 'Active',
    open: 'Open',
    'in-progress': 'In progress',
    ready: 'Ready to verify',
    done: 'Done',
    all: 'All'
};

/** The statuses folded under Active in the list's status filter, each one also a choice of its own */
export const activeStatusFilters = ['open', 'in-progress', 'ready'] as const satisfies readonly StatusFilter[];

/** Whether the status filter shows Active or one of the statuses folded under it */
export function isActiveStatusFilter(filter: StatusFilter) {
    return filter === 'active' || (activeStatusFilters as readonly StatusFilter[]).includes(filter);
}

/** Whether a thread in `status` is listed under the status filter */
export function statusMatches(filter: StatusFilter, status: import('@uier/toolbar/verification').FeedbackStage) {
    return filter === 'all' || (filter === 'active' ? status !== 'done' : status === filter);
}

export const peopleFilterLabels: Record<PeopleFilter, string> = {
    all: 'Everyone',
    assigned: 'Assigned to me',
    unassigned: 'Unassigned',
    mine: 'Opened by me'
};
