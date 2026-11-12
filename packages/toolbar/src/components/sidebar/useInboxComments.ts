import { useProjectViewer } from '../../project/ProjectGate';
import { useActivitySummary, useComments, useMoreSiteComments, useSiteComments, type MoreSiteComments } from '../../hooks/useComments';
import { CommentItem, commentsListMaxLength } from '../@types/Comments';
import { CommentsFilter, CommentsPageFilter, CommentsStatusFilter, inboxPageKey, inSection, matchesSearch, matchesStatus } from './CommentsFilter';

/** Another page of the site, for the page picker: newest activity first */
export type InboxPage = {
    key: `page:${string}`;
    path: string;
    /** The environment, when it is not the one being reviewed */
    environmentLabel?: string;
    /** Its comments that match the search and status */
    count: number;
};

/** Loading state of the lists a scope comes from */
export type InboxListState = {
    isPending: boolean;
    error: Error | null;
    refetch: () => void;
};

/** This page's list has no more pages */
const noMore: MoreSiteComments = { paged: false, hasMore: false, loading: false, error: null, loadMore: () => {} };

/** Newest first (ISO 8601 times sort as text) */
const newestFirst = (a: CommentItem, b: CommentItem) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '');

/** The path of a `page:<environment>|<path>` key, or a section's base path */
export function pageKeyPath(key: CommentsPageFilter) {
    return key.startsWith('page:') ? key.slice(key.indexOf('|') + 1) : key.startsWith('section:') ? key.slice('section:'.length) : '';
}

/**
 * The inbox's comments for the chosen pages (this page by default, all pages or one other page),
 * searched and filtered by status, with the counts of the status tabs and the page picker.
 *
 * This page comes from its own list (the one its pins use), or the site's unread list when only
 * unread threads are shown (it includes old threads); other pages from the site's list
 * (`GET /api/comments?scope=site`), which has the newest comments only.
 */
export function useInboxComments(filter: CommentsFilter) {
    const { path, query: pageQuery } = useComments();
    const siteQuery = useSiteComments(true, Boolean(filter.unread));
    const siteMore = useMoreSiteComments(siteQuery, Boolean(filter.unread));
    const { data: activity } = useActivitySummary();
    const { environment, currentEnvironment } = useProjectViewer();

    const isCurrentPage = (comment: CommentItem) => comment.path === path && (!comment.source || comment.source.environment === currentEnvironment);
    const showCurrent = !environment || environment === 'all' || environment === currentEnvironment;
    // A page chosen in the picker that is now this page (the inbox stayed open on the way here) is
    // "This page": its key without an environment or with the one being reviewed, as `isCurrentPage`
    const isThisPage = filter.page === `page:|${path}` || filter.page === `page:${currentEnvironment ?? ''}|${path}`;
    const scope: CommentsPageFilter = showCurrent && isThisPage ? 'current' : filter.page ?? 'current';
    const currentQuery = filter.unread ? siteQuery : pageQuery;
    const current = showCurrent ? (filter.unread ? siteQuery.data?.filter(isCurrentPage) : pageQuery.data) : [];
    const others = siteQuery.data?.filter(comment => !isCurrentPage(comment));
    const currentSearched = current?.filter(comment => matchesSearch(comment, filter));
    const othersSearched = others?.filter(comment => matchesSearch(comment, filter));

    let scoped: CommentItem[] | undefined;
    let state: InboxListState;
    const everyPage = currentSearched && othersSearched
        ? [...currentSearched, ...othersSearched].sort(newestFirst)
        : undefined;
    const bothLists: InboxListState = {
        isPending: currentQuery.isPending || siteQuery.isPending,
        error: currentQuery.error ?? siteQuery.error,
        refetch: () => { void currentQuery.refetch(); void siteQuery.refetch(); }
    };
    if (scope === 'current') {
        scoped = currentSearched;
        state = currentQuery;
    } else if (scope === 'all') {
        scoped = everyPage;
        state = bothLists;
    } else if (scope.startsWith('section:')) {
        const base = pageKeyPath(scope);
        scoped = everyPage?.filter(comment => inSection(base, comment.path));
        state = bothLists;
    } else {
        scoped = othersSearched?.filter(comment => inboxPageKey(comment) === scope);
        state = siteQuery;
    }

    const withStatus = (list: CommentItem[] | undefined, status: CommentsStatusFilter = filter.status) =>
        list?.filter(comment => matchesStatus(comment, status));
    const comments = withStatus(scoped);

    // Of the listed comments (the site's list has the newest ones only, see `siteCapped`)
    const counts: Record<CommentsStatusFilter, number> = {
        unresolved: withStatus(scoped, 'unresolved')?.length ?? 0,
        open: withStatus(scoped, 'open')?.length ?? 0,
        'in-progress': withStatus(scoped, 'in-progress')?.length ?? 0,
        ready: withStatus(scoped, 'ready')?.length ?? 0,
        resolved: withStatus(scoped, 'resolved')?.length ?? 0,
        all: withStatus(scoped, 'all')?.length ?? 0,
        archived: withStatus(scoped, 'archived')?.length ?? 0
    };

    // Site-wide totals come from the full authorized projection, never the capped text window.
    if (scope === 'all' && activity && !filter.keywords?.trim() && !filter.unread && !filter.assignedToMe) {
        // `open` here is every status but Done: Active
        counts.unresolved = activity.open;
        // An API without the In progress count keeps the listed ones
        counts['in-progress'] = activity.inProgress ?? counts['in-progress'];
        counts.ready = activity.ready ?? 0;
        if (activity.inProgress !== undefined) counts.open = Math.max(0, activity.open - activity.inProgress - counts.ready);
        counts.resolved = activity.done;
        counts.all = activity.total;
        counts.archived = activity.archived ?? counts.archived;
    }

    // Other pages in the order of their newest comment, counted with the search and status
    const pages = new Map<`page:${string}`, InboxPage>();
    for (const comment of others ?? []) {
        const key = inboxPageKey(comment);
        const page = pages.get(key) ?? {
            key,
            path: comment.path,
            environmentLabel: comment.source && comment.source.environment !== currentEnvironment ? comment.source.label : undefined,
            count: 0
        };
        if (matchesSearch(comment, filter) && matchesStatus(comment, filter.status)) page.count++;
        pages.set(key, page);
    }
    const currentCount = withStatus(currentSearched)?.length ?? 0;
    const otherCount = withStatus(othersSearched)?.length ?? 0;

    // The site's list loads older pages as the inbox scrolls (`more`); this page's list is one
    const more: MoreSiteComments = scope === 'current' ? noMore : siteMore;
    // What the site's list could not load: the unread list and the public API have one page, a project's site list
    // the API's newest comments (`MAX_PROJECT_COMMENTS`)
    const siteLength = siteQuery.data?.length ?? 0;
    const siteCapped = scope !== 'current' && !siteMore.hasMore && ((filter.unread ? activity?.unread ?? 0 : (activity?.total ?? 0) + (activity?.archived ?? 0)) > siteLength
        || (!siteMore.paged && siteLength >= commentsListMaxLength));

    // This page's own drafts (new comments not sent yet) are listed with it: this page, every page or its section
    const listsThisPage = showCurrent && (scope === 'current' || scope === 'all' || (scope.startsWith('section:') && inSection(pageKeyPath(scope), path)));

    return {
        scope,
        listsThisPage,
        comments,
        state,
        counts,
        pages: [...pages.values()],
        currentPath: path,
        currentCount,
        otherCount,
        siteCapped,
        more,
        isCurrentPage,
        loading: pageQuery.isPending || siteQuery.isPending
    };
}
