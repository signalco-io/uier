'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, type ReactNode } from 'react';
import { SearchXIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { setUrlSearchParams, useUrlSearchParams } from '@/src/hooks/use-url-search-params';
import { Button } from '@/src/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import type { MyWork, MyWorkItem } from '../../../lib/app/myWork';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { defaultBoardSort, type BoardColumn, type BoardSort } from '../../../lib/app/boardSort';
import type { CommentsView } from './commentLabels';
import { rememberCommentsView, storedCommentsView } from './commentsView';
import { useOpenComment } from './CommentInbox';
import { CommentBoard, type BoardProject } from './CommentBoard';
import { CommentFilters, type FilterProject } from './CommentFilters';
import { commentStatus, commentStatuses, type CommentStatus } from './CommentStatus';
import { orderComments, sortBoardColumn } from './commentOrder';
import { parseCommentsQuery } from './commentsQuery';
import { applyFilters } from './ProjectComments';
import { CommentsSearchNavigationProvider } from './CommentsSearchNavigation';
import { applyCommentUpdate, CommentUpdatesProvider, type CommentUpdate } from './CommentUpdates';
import { MyWorkGroups } from './MyWorkList';
import { defaultMyWorkSorts, rememberMyWorkSorts, storedMyWorkSorts, type MyWorkGroup, type MyWorkSortKey, type MyWorkSorts } from './myWorkSorts';

/** My work's view from the address: `?view=board`, otherwise its grouped lists */
function useMyWorkView(): CommentsView {
    return useUrlSearchParams().get('view') === 'board' ? 'board' : 'list';
}

/** The filters' header on the board takes the columns' width, like the page header (`--board-width`, set by the page) */
const boardHeader = 'md:w-[min(var(--page-wide),max(100%,var(--board-width)))] md:mx-[calc((100%-min(var(--page-wide),max(100%,var(--board-width))))/2)]';

/**
 * My work's threads as its grouped lists or on a board, under the comments' search and Filter (`CommentFilters` with a
 * Project filter, and without what only a project has: environments and pages, status tabs, the count line), and `empty`
 * when nothing needs you. Search, the filters and List/Board are kept in the address like a project's (`?q=`, `?priority=`,
 * `?people=`, `?unread=`, `?project=`, `?view=`); each list's and each column's sort is remembered in this browser
 * (`myWorkSorts.ts`). The page renders it empty too, so a board that keeps threads changed on it stays mounted. With no
 * view in the address the one last chosen for My work opens and is written there, in a layout effect like a project's
 * comments, so a page reached in the app paints in it.
 */
export function MyWorkViews({ assigned, mentions, unread, assignees, userId, empty }: Pick<MyWork, 'assigned' | 'mentions' | 'unread' | 'assignees'> & {
    userId: string;
    /** Shown when nothing needs you */
    empty: ReactNode;
}) {
    const { t } = useAppI18n();
    const searchParams = useUrlSearchParams();
    const urlView = searchParams.get('view');
    const view = useMyWorkView();
    useLayoutEffect(() => {
        if (urlView === 'list' || urlView === 'board') return;
        const remembered = storedCommentsView('my-work');
        if (remembered) setUrlSearchParams({ view: remembered });
    }, [urlView]);
    // Each list's and column's sort: the defaults from the server, the remembered ones before the browser paints
    const [sorts, setSorts] = useState<MyWorkSorts>(defaultMyWorkSorts);
    useLayoutEffect(() => setSorts(storedMyWorkSorts()), []);
    const changeSort = (key: MyWorkSortKey, sort: BoardSort) => setSorts(current => {
        const next = { ...current, [key]: sort };
        rememberMyWorkSorts(next);
        return next;
    });

    // The search waits a moment before it goes into the address, like a project's
    const urlKey = searchParams.toString();
    const query = parseCommentsQuery(Object.fromEntries(searchParams));
    const [searchDraft, setSearchDraft] = useState({ url: urlKey, value: query.q ?? '' });
    const search = searchDraft.url === urlKey ? searchDraft.value : query.q ?? '';
    useEffect(() => {
        if (search === (query.q ?? '')) return;
        const timer = window.setTimeout(() => setUrlSearchParams({ q: search || undefined }), 250);
        return () => window.clearTimeout(timer);
    }, [search, query.q, urlKey]);
    const commitSearch = () => { setUrlSearchParams({ q: search || undefined }); };
    const clearFilters = () => {
        setSearchDraft({ url: urlKey, value: '' });
        setUrlSearchParams({ q: undefined, priority: undefined, people: undefined, unread: undefined, project: undefined }, { history: 'push' });
        document.getElementById('feedback-search')?.focus();
    };

    const items = [...assigned, ...mentions, ...unread];
    // The projects with a thread here, by name
    const projects = [...new Map(items.map(item => [item.projectId, { id: item.projectId, name: item.projectName, url: item.projectUrl } satisfies FilterProject])).values()]
        .sort((a, b) => a.name.localeCompare(b.name));
    const project = searchParams.get('project') ?? undefined;
    // Only unread keeps the open thread while it is read, as in a project
    const openId = searchParams.get('comment') ?? undefined;
    const filterItems = (list: readonly MyWorkItem[]) => {
        const kept = new Set(applyFilters(list.map(item => item.comment), { ...query, q: search }, userId, openId).map(comment => comment.id));
        return list.filter(item => kept.has(item.comment.id) && (!project || item.projectId === project));
    };
    const header = (
        <CommentFilters className={cn(view === 'board' && boardHeader)} search={search} onSearch={value => setSearchDraft({ url: urlKey, value })}
            priority={query.priority} people={query.people} unread={Boolean(query.unread)} unreadCount={items.filter(item => item.comment.activity?.unread).length}
            project={project} projects={projects} view={view}
            onView={next => {
                rememberCommentsView(next, 'my-work');
                setUrlSearchParams({ view: next, comment: undefined }, { history: 'push' });
            }} />
    );
    const noMatch = (
        <Empty className="border">
            <EmptyHeader>
                <EmptyMedia variant="icon"><SearchXIcon /></EmptyMedia>
                <EmptyTitle>{t("Nothing here")}</EmptyTitle>
                <EmptyDescription>{t("No comments match these filters.")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent><Button variant="outline" className="pointer-coarse:min-h-11" onClick={clearFilters}>{t("Clear filters")}</Button></EmptyContent>
        </Empty>
    );
    const groups: Record<MyWorkGroup, MyWorkItem[]> = { assigned: filterItems(assigned), mentions: filterItems(mentions), unread: filterItems(unread) };
    return (
        <CommentsSearchNavigationProvider value={commitSearch}>
            {view === 'board' ? (
                <MyWorkBoard items={items} assignees={assignees} userId={userId} empty={empty} header={header} noMatch={noMatch}
                    filter={filterItems} sorts={sorts} onSort={changeSort} />
            ) : !items.length ? empty : (
                <div className="flex flex-col gap-4">
                    {header}
                    {groups.assigned.length || groups.mentions.length || groups.unread.length
                        ? <MyWorkGroups groups={groups} sorts={sorts} onSort={changeSort} />
                        : noMatch}
                </div>
            )}
        </CommentsSearchNavigationProvider>
    );
}

const index = (items: readonly MyWorkItem[]) => Object.fromEntries(items.map(item => [item.comment.id, item]));

/**
 * My work's threads (assigned to you, mentioning you, unread) on the comments board (`CommentBoard`), one column per
 * status, each card naming its project, under the filters' `header`. The filters (`filter`) pick the cards, and each
 * column is in its own sort (`sorts`, chosen from its header: My work's own, not a project's). A card's move is saved in its own project with its own permissions
 * (`allowedStatuses` reads each thread's), and its thread opens in the board's sheet with that project's people.
 *
 * A thread changed here (moved to Done, read in the sheet, archived) can stop needing you, and the page's fresh snapshot
 * then leaves it out. It stays on the board with those changes until My work is loaded again, so a card dropped on Done
 * stays there and the open thread stays open; a deleted one goes.
 */
export function MyWorkBoard({ items, assignees, userId, empty, header, noMatch, filter, sorts: chosen, onSort }: {
    /** Every thread My work lists, its groups together */
    items: MyWorkItem[];
    /** Shown in place of the board when it has no thread, kept ones included */
    empty: ReactNode;
    /** The filters, above the board while it has threads */
    header: ReactNode;
    /** Shown under the filters when no thread matches them */
    noMatch: ReactNode;
    /** The threads that match the filters */
    filter: (items: readonly MyWorkItem[]) => MyWorkItem[];
    /** Each column's sort */
    sorts: MyWorkSorts;
    onSort: (column: CommentStatus, sort: BoardSort) => void;
    assignees: MyWork['assignees'];
    userId: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const openComment = useOpenComment(containerRef);
    // Each thread and project as the server last sent them, for the threads that have left its snapshot since
    const [seen, setSeen] = useState({ items, byId: index(items), assignees });
    if (seen.items !== items) setSeen({ items, byId: { ...seen.byId, ...index(items) }, assignees: { ...seen.assignees, ...assignees } });
    // Every change made on this board, in order: replayed on the threads that left, so they show as they are now
    const [changes, setChanges] = useState<CommentUpdate[]>([]);
    const listed = new Set(items.map(item => item.comment.id));
    const removed = new Set(changes.flatMap(change => 'removed' in change ? [change.id] : []));
    const changed = new Set(changes.map(change => change.id));
    const left = Object.values(seen.byId)
        .filter(({ comment }) => !listed.has(comment.id) && changed.has(comment.id) && !removed.has(comment.id))
        .map(item => ({ ...item, comment: changes.filter(change => change.id === item.comment.id).reduce(applyCommentUpdate, item.comment) }));
    const [shown, showUpdate] = useOptimistic([...items, ...left], (current, update: CommentUpdate) =>
        current.map(item => ({ ...item, comment: applyCommentUpdate(item.comment, update) })));
    const updateComment = (update: CommentUpdate) => {
        showUpdate(update);
        setChanges(current => [...current, update]);
    };
    const byId = new Map(shown.map(item => [item.comment.id, item]));
    const projectOf = (comment: ProjectCommentView): BoardProject => {
        const item = byId.get(comment.id) ?? seen.byId[comment.id];
        return { id: item?.projectId ?? '', name: item?.projectName, url: item?.projectUrl, assignees: (item && seen.assignees[item.projectId]) ?? [] };
    };
    // A project list's order (priority, then number), newest first between projects' threads that tie
    const comments = orderComments(shown.map(item => item.comment).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')));
    const matching = new Set(filter(shown).map(item => item.comment.id));
    const onBoard = comments.filter(comment => !comment.archivedAt && matching.has(comment.id));
    // No Archive column: its sort is never offered
    const sorts = { ...chosen, archive: defaultBoardSort('archive') } satisfies Record<BoardColumn, BoardSort>;
    const columns = Object.fromEntries(commentStatuses.map(status => [status,
        sortBoardColumn(onBoard.filter(comment => commentStatus(comment) === status), sorts[status])])) as Record<CommentStatus, ProjectCommentView[]>;
    // A thread that is gone (deleted, or no longer visible to you) closes, so it cannot reopen later
    const openId = openComment.openId;
    useEffect(() => {
        if (openId && !comments.some(comment => comment.id === openId)) setUrlSearchParams({ comment: undefined });
    }, [openId, comments]);
    if (!shown.length) return empty;
    return (
        <CommentUpdatesProvider value={updateComment}>
            {/* The page header takes the board's width from `data-header-wide` (the My work page sets `--board-width`) */}
            <div ref={containerRef} data-header-wide="board" className="flex flex-col gap-4">
                {header}
                {onBoard.length ? (
                    <CommentBoard projectOf={projectOf} columns={columns} sorts={sorts} onSort={(column, sort) => { if (column !== 'archive') onSort(column, sort); }}
                        allComments={comments} userId={userId} openComment={openComment} />
                ) : noMatch}
            </div>
        </CommentUpdatesProvider>
    );
}
