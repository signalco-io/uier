import type { CommentsFilter, CommentsPageFilter, CommentsStatusFilter } from './CommentsFilter';

/** The app's `?status=` for an inbox status tab: Active is the app's default, so it has none */
const appStatus: Record<CommentsStatusFilter, string | undefined> = {
    unresolved: undefined,
    open: 'open',
    'in-progress': 'in-progress',
    ready: 'ready',
    resolved: 'done',
    archived: 'archived',
    all: 'all'
};

/** The app's `?page=` for the inbox's pages: one path, a section as `/blog/*`, nothing for all pages */
function appPage(scope: CommentsPageFilter, currentPath: string) {
    const path = scope === 'current' ? currentPath
        : scope.startsWith('page:') ? scope.slice(scope.indexOf('|') + 1)
            : scope.startsWith('section:') ? `${scope.slice('section:'.length).replace(/\/$/, '')}/*`
                : undefined;
    return path?.startsWith('/') ? path : undefined;
}

/**
 * The project's comments in the uier app (`/app/projects/<code>`) for what the inbox shows: its environment, pages,
 * status, unread and Assigned to me filters and its search, as the app's own query (`parseCommentsQuery` in apps/web)
 */
export function inboxAppLink({ apiUrl, project, filter, scope, currentPath, environment }: {
    apiUrl: string;
    project: string;
    filter: CommentsFilter;
    /** The pages the inbox lists (`useInboxComments`' scope) */
    scope: CommentsPageFilter;
    /** This page's path, for the default "this page" */
    currentPath: string;
    /** The viewer's environment (`all` for every one) */
    environment?: string;
}) {
    const params = new URLSearchParams();
    const status = appStatus[filter.status];
    if (status) params.set('status', status);
    if (environment && environment !== 'all') params.set('environment', environment);
    const page = appPage(scope, currentPath);
    if (page) params.set('page', page);
    if (filter.unread) params.set('unread', 'true');
    if (filter.assignedToMe) params.set('people', 'assigned');
    const q = filter.keywords?.trim();
    if (q) params.set('q', q);
    const query = params.toString();
    return `${apiUrl}/app/projects/${encodeURIComponent(project)}${query ? `?${query}` : ''}`;
}
