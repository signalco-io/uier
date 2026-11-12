import { useProjectViewer } from '../../project/ProjectGate';
import { noMoreComments, useActivitySummary, useComments, useMorePageComments, useMoreSiteComments, useSiteComments, type MoreComments } from '../../hooks/useComments';
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

/** Newest first (ISO 8601 times sort as text) */
const newestFirst = (a: CommentItem, b: CommentItem) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '');

/** This page's list and the site list's threads of this page that it does not have (`undefined` while it loads) */
function withSiteThreads(page: CommentItem[] | undefined, site: CommentItem[] | undefined) {
    if (!page || !site?.length) return page;
    const listed = new Set(page.map(comment => comment.id));
    const more = site.filter(comment => !listed.has(comment.id));
    return more.length ? [...page, ...more].sort(newestFirst) : page;
}

/** The path of a `page:<environment>|<path>` key, or a section's base path */
export function pageKeyPath(key: CommentsPageFilter) {
    return key.startsWith('page:') ? key.slice(key.indexOf('|') + 1) : key.startsWith('section:') ? key.slice('section:'.length) : '';
}

/**
 * The inbox's comments for the chosen pages (this page by default, all pages or one other page),
 * searched and filtered by status, with the counts of the status tabs and the page picker.
 *
 * This page comes from its own list (the one its pins use) with the threads of this page the site's list loaded, or
 * the site's unread list when only unread threads are shown (it includes old threads); other pages from the site's
 * list (`?scope=site`). A project's lists load in pages as the inbox scrolls (`more`).
 */
export function useInboxComments(filter: CommentsFilter) {
    const verificationEnabled = useProjectViewer().verificationEnabled === true;
    if (!verificationEnabled && filter.status === 'ready') filter = { ...filter, status: 'unresolved' };
    const { path, query: pageQuery } = useComments();
    const siteQuery = useSiteComments(true, Boolean(filter.unread));
    const siteMore = useMoreSiteComments(siteQuery, Boolean(filter.unread));
    const pageMore = useMorePageComments(pageQuery);
    const { data: activity } = useActivitySummary();
    const { environment, currentEnvironment } = useProjectViewer();

    const isCurrentPage = (comment: CommentItem) => comment.path === path && (!comment.source || comment.source.environment === currentEnvironment);
    const showCurrent = !environment || environment === 'all' || environment === currentEnvironment;
    // A page chosen in the picker that is now this page (the inbox stayed open on the way here) is
    // "This page": its key without an environment or with the one being reviewed, as `isCurrentPage`
    const isThisPage = filter.page === `page:|${path}` || filter.page === `page:${currentEnvironment ?? ''}|${path}`;
    const scope: CommentsPageFilter = showCurrent && isThisPage ? 'current' : filter.page ?? 'current';
    const currentQuery = filter.unread ? siteQuery : pageQuery;
    // This page's list, with the threads of this page that the site's list loaded beyond it (each list loads its own
    // pages, so either can reach older ones): by id, this page's version first
    const current = showCurrent ? (filter.unread ? siteQuery.data?.filter(isCurrentPage) : withSiteThreads(pageQuery.data, siteQuery.data?.filter(isCurrentPage))) : [];
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

    // Which tabs' listed comments include unread ones: each tab's unread dot, chosen or not (uier #346)
    const unread = Object.fromEntries((Object.keys(counts) as CommentsStatusFilter[])
        .map(status => [status, Boolean(withStatus(scoped, status)?.some(comment => comment.activity?.unread))])) as Record<CommentsStatusFilter, boolean>;

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
        // The tabs' unread dots from the same summary, for the threads not loaded yet (uier #346)
        if (activity.unreadOpen !== undefined) {
            const open = activity.unreadOpen, inProgress = activity.unreadInProgress ?? 0, ready = activity.unreadReady ?? 0, done = activity.unreadDone ?? 0;
            unread.open = open > 0;
            unread['in-progress'] = inProgress > 0;
            unread.ready = ready > 0;
            unread.unresolved = open + inProgress + ready > 0;
            unread.resolved = done > 0;
            unread.all = open + inProgress + ready + done > 0;
            unread.archived = (activity.unreadArchived ?? 0) > 0;
        }
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

    // Older pages load as the inbox scrolls (`more`): this page's list for This page (the unread one is the site's,
    // one page), the site's list for every other scope
    const more: MoreComments = scope === 'current' ? (filter.unread ? noMoreComments : pageMore) : siteMore;
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
        unread,
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
