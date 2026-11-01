import { commentPriority, priorities, MAX_FEEDBACK_SEARCH, type CommentPriority } from '@uier/toolbar/triage';
import type { CommentsView, PeopleFilter, StatusFilter } from './commentLabels';

export type CommentsQuery = {
    q?: string;
    priority?: CommentPriority;
    environment?: string;
    author?: string;
    unread?: boolean;
    view: CommentsView;
    /** Open, Done or All in the list (the board shows Open and Done side by side) */
    status: StatusFilter;
    people: PeopleFilter;
    /** A page (relative URL), a section (`/blog/*`) or every page */
    page?: string;
};

/** The comments query from the page's search params (unknown values fall back to the defaults) */
export function parseCommentsQuery(params: Record<string, string | string[] | undefined>): CommentsQuery {
    const value = (name: string) => {
        const raw = params[name];
        return typeof raw === 'string' ? raw : undefined;
    };
    const people = value('people');
    const status = value('status');
    const page = value('page');
    return {
        q: value('q')?.slice(0, MAX_FEEDBACK_SEARCH) || undefined,
        priority: priorities.includes(value('priority') as CommentPriority) ? commentPriority(value('priority')) : undefined,
        environment: value('environment'),
        author: value('author'),
        unread: value('unread') === 'true',
        view: value('view') === 'board' ? 'board' : 'list',
        status: status === 'done' || status === 'all' ? status : 'open',
        people: people === 'assigned' || people === 'mine' ? people : 'all',
        page: page?.startsWith('/') ? page : undefined
    };
}
