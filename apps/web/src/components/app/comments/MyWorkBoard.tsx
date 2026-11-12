'use client';

import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, type ReactNode } from 'react';
import { setUrlSearchParams, useUrlSearchParams } from '@/src/hooks/use-url-search-params';
import type { MyWork, MyWorkItem } from '../../../lib/app/myWork';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { defaultBoardSort, type BoardColumn, type BoardSort } from '../../../lib/app/boardSort';
import type { CommentsView } from './commentLabels';
import { rememberCommentsView, storedCommentsView } from './commentsView';
import { CommentsViewToggle } from './CommentsViewToggle';
import { useOpenComment } from './CommentInbox';
import { CommentBoard, type BoardProject } from './CommentBoard';
import { commentStatus, commentStatuses, type CommentStatus } from './CommentStatus';
import { orderComments, sortBoardColumn } from './commentOrder';
import { applyCommentUpdate, CommentUpdatesProvider, type CommentUpdate } from './CommentUpdates';

/** My work's view from the address: `?view=board`, otherwise its grouped lists */
function useMyWorkView(): CommentsView {
    return useUrlSearchParams().get('view') === 'board' ? 'board' : 'list';
}

/**
 * List and Board for My work, like a project's comments: kept in the address (`?view=`, list too) and remembered in this
 * browser, apart from the projects' choice (`commentsView.ts`, scope `my-work`). A new view starts with no thread open.
 */
export function MyWorkViewToggle() {
    const view = useMyWorkView();
    return (
        <CommentsViewToggle view={view} onChange={next => {
            rememberCommentsView(next, 'my-work');
            setUrlSearchParams({ view: next, comment: undefined }, { history: 'push' });
        }} />
    );
}

/**
 * My work's threads as its grouped lists (`list`, rendered by the page) or on a board, and `empty` when nothing needs you.
 * The page renders it empty too, so a board that keeps threads changed on it stays mounted. With no view in the address the
 * one last chosen for My work opens and is written there, in a layout effect like a project's comments, so a page
 * reached in the app paints in it.
 */
export function MyWorkViews({ list, ...board }: { list: ReactNode } & Parameters<typeof MyWorkBoard>[0]) {
    const urlView = useUrlSearchParams().get('view');
    const view = useMyWorkView();
    useLayoutEffect(() => {
        if (urlView === 'list' || urlView === 'board') return;
        const remembered = storedCommentsView('my-work');
        if (remembered) setUrlSearchParams({ view: remembered });
    }, [urlView]);
    if (view === 'board') return <MyWorkBoard {...board} />;
    return board.items.length ? list : board.empty;
}

/** Every column in its default order: My work has no project whose saved sorts it could follow */
const defaultSorts = Object.fromEntries([...commentStatuses, 'archive'].map(column => [column, defaultBoardSort(column as BoardColumn)])) as Record<BoardColumn, BoardSort>;

const index = (items: readonly MyWorkItem[]) => Object.fromEntries(items.map(item => [item.comment.id, item]));

/**
 * My work's threads (assigned to you, mentioning you, unread) on the comments board (`CommentBoard`), one column per
 * status, each card naming its project. A card's move is saved in its own project with its own permissions
 * (`allowedStatuses` reads each thread's), and its thread opens in the board's sheet with that project's people.
 *
 * A thread changed here (moved to Done, read in the sheet, archived) can stop needing you, and the page's fresh snapshot
 * then leaves it out. It stays on the board with those changes until My work is loaded again, so a card dropped on Done
 * stays there and the open thread stays open; a deleted one goes.
 */
export function MyWorkBoard({ items, assignees, userId, empty }: {
    /** Every thread My work lists, its groups together */
    items: MyWorkItem[];
    /** Shown in place of the board when it has no thread, kept ones included */
    empty: ReactNode;
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
    const onBoard = comments.filter(comment => !comment.archivedAt);
    const columns = Object.fromEntries(commentStatuses.map(status => [status,
        sortBoardColumn(onBoard.filter(comment => commentStatus(comment) === status), defaultSorts[status])])) as Record<CommentStatus, ProjectCommentView[]>;
    // A thread that is gone (deleted, or no longer visible to you) closes, so it cannot reopen later
    const openId = openComment.openId;
    useEffect(() => {
        if (openId && !comments.some(comment => comment.id === openId)) setUrlSearchParams({ comment: undefined });
    }, [openId, comments]);
    if (!shown.length) return empty;
    return (
        <CommentUpdatesProvider value={updateComment}>
            {/* The page header takes the board's width from `data-header-wide` (the My work page sets `--board-width`) */}
            <div ref={containerRef} data-header-wide="board" className="flex flex-col">
                <CommentBoard projectOf={projectOf} columns={columns} sorts={defaultSorts} allComments={comments} userId={userId} openComment={openComment} />
            </div>
        </CommentUpdatesProvider>
    );
}
