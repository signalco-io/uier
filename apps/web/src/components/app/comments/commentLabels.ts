import type { DbCommentKind, DbDeviceSize } from '../../../lib/db/schema';

export const deviceLabels: Record<DbDeviceSize, string> = {
    desktop: 'Desktop',
    tablet: 'Tablet',
    mobile: 'Mobile'
};

/** The chip of a comment that is not a plain comment (the same words as the toolbar's) */
export const kindLabels: Record<Exclude<DbCommentKind, 'comment'>, string> = {
    feedback: 'Feedback',
    bug: 'Bug report',
    rewrite: 'Suggested rewrite'
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
/** `open`: not done, so In progress and Ready to verify are there too; the others are one status each */
export type StatusFilter = 'open' | 'in-progress' | 'ready' | 'done' | 'all';

/** The list's status filter: the toolbar inbox's tabs, in its order and words */
export const statusFilterLabels: Record<StatusFilter, string> = {
    open: 'Open',
    'in-progress': 'In progress',
    ready: 'Ready to verify',
    done: 'Done',
    all: 'All'
};

/** Whether a thread in `status` is listed under the status filter */
export function statusMatches(filter: StatusFilter, status: import('@uier/toolbar/verification').FeedbackStage) {
    return filter === 'all' || (filter === 'open' ? status !== 'done' : status === filter);
}

export const peopleFilterLabels: Record<PeopleFilter, string> = {
    all: 'Everyone',
    assigned: 'Assigned to me',
    unassigned: 'Unassigned',
    mine: 'Opened by me'
};
