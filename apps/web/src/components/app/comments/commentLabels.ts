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
    slack: 'Slack'
};

/** Only an opaque server reference and a display name cross the client boundary. */
export type AuthorFilter = { reference: string; name: string };

export type PeopleFilter = 'all' | 'assigned' | 'mine';
export type CommentsView = 'list' | 'board';
export type StatusFilter = 'open' | 'done' | 'all';

/** The list's status filter: the toolbar inbox's tabs, in its order and words */
export const statusFilterLabels: Record<StatusFilter, string> = {
    open: 'Open',
    done: 'Done',
    all: 'All'
};

export const peopleFilterLabels: Record<PeopleFilter, string> = {
    all: 'Everyone',
    assigned: 'Assigned to me',
    mine: 'Opened by me'
};
