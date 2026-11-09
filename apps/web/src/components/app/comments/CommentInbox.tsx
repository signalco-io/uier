'use client';

import { useEffect, useEffectEvent, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { cn } from '@/src/lib/utils';
import { setUrlSearchParams, useUrlSearchParams } from '@/src/hooks/use-url-search-params';
import { KnownPageLinks } from '../../../knownPages';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { CommentCard, type AssigneeOption, type ResolveExit } from './CommentCard';
import { CommentRow, commentRowId } from './CommentRow';
import { commentStatus, type CommentStatus } from './CommentStatus';
import { LayoutMotion } from './LayoutMotion';

/** The brand's exit (BRAND.md, "Motion"): 150 ms ease-out, fade plus 8 px slide */
const exitMs = 150;

/** The comments' container width from which the list and the open thread sit side by side (`@4xl`, 56rem) */
const sideBySidePx = 56 * 16;

/**
 * The open thread, in the URL (`?comment=<id>`) like the filters, so it can be linked, reloaded and
 * opened in a new tab. Side by side it replaces the history entry; where the thread takes the whole
 * width (a phone) and on the board it adds one, so Back closes it. It opens and closes during the
 * click or the Back, even while a change waits for the server (`useUrlSearchParams`).
 */
export function useOpenComment(container: RefObject<HTMLElement | null>) {
    const searchParams = useUrlSearchParams();
    const openId = searchParams.get('comment') ?? undefined;
    // The address this hook added to the history, so Back to comments can take it away again
    const pushed = useRef<string>(undefined);
    const sideBySide = () => (container.current?.offsetWidth ?? 0) >= sideBySidePx;
    const hrefFor = (id: string) => {
        const params = new URLSearchParams(searchParams);
        params.set('comment', id);
        return `?${params}#comments`;
    };
    const open = (id: string, event?: MouseEvent, { replace = sideBySide() }: { replace?: boolean } = {}) => {
        // A new tab or window keeps the browser's own handling of the link
        if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
        event?.preventDefault();
        const url = setUrlSearchParams({ comment: id }, { history: replace ? 'replace' : 'push' });
        if (url && !replace) pushed.current = url.href;
    };
    const close = () => {
        // Only while that entry is still the current one: another navigation (a filter) stays
        const back = pushed.current === window.location.href;
        pushed.current = undefined;
        if (back) {
            window.history.back();
            return;
        }
        setUrlSearchParams({ comment: undefined });
    };
    return { openId, hrefFor, open, close, sideBySide };
}

/**
 * The list as an inbox: compact rows, and the open thread beside them (the first shown one until
 * another is chosen). Where there is no room for both, a row opens the thread in the list's place,
 * with Back to comments. A thread that Done or Reopen takes out of the list folds away first. Rows that
 * arrive, leave or change place otherwise (realtime, filters, search, priority) animate (`LayoutMotion`).
 *
 * ↓ and ↑ move to the next and the previous row and stop at the ends; from a row, Home and End move to
 * the first and the last. Beside the list the row's thread opens, like a click; where the thread
 * would take the list's place, the focus moves and Enter opens it. The keys work from the list, or
 * from the page while nothing has the focus and the reader is not in the open thread (there they keep
 * scrolling it), so never in a text field, a menu or a dialog. Only the current row's link and
 * selection box are in the Tab order (a roving tab stop), so Tab goes on to the open thread.
 *
 * The thread beside the list is marked read once it has been on screen for a moment (`CommentCard`),
 * the first shown one too: it is displayed in full, so it has been seen. Where it is not displayed (a
 * phone, until a row is chosen) it stays unread. The keys pass threads faster than that, so only the
 * one the reader stops on is read.
 */
export function CommentInbox({ projectId, comments, allComments, assignees, userId, label, keeps, readLeaves, openComment }: {
    projectId: string;
    /** The shown comments, in order */
    comments: ProjectCommentView[];
    /** Every loaded comment: an opened thread stays open when a filter or its new status hides its row */
    allComments: ProjectCommentView[];
    assignees: AssigneeOption[];
    userId: string;
    label: string;
    /** Whether the list still shows a thread in this status (the status tab): one that leaves fades out */
    keeps: (status: CommentStatus) => boolean;
    /** A read comment leaves the list unless it is the open one (Only unread) */
    readLeaves?: boolean;
    openComment: ReturnType<typeof useOpenComment>;
}) {
    const { openId, hrefFor, open, close, sideBySide } = openComment;
    const opened = openId ? allComments.find(comment => comment.id === openId) : undefined;
    const selected = opened ?? comments[0];
    const listRef = useRef<HTMLUListElement>(null);
    const detailRef = useRef<HTMLDivElement>(null);
    // Comment id → the status it is leaving for; it stays hidden only while it has another one
    const [leaving, setLeaving] = useState<Record<string, CommentStatus>>({});
    const isLeaving = (comment: ProjectCommentView) => comment.id in leaving && leaving[comment.id] !== commentStatus(comment);

    // The row the keyboard is on: the one last focused or opened. It follows the open thread whenever
    // that changes (a click, an arrow key, Back or Forward) and holds the list's one tab stop.
    const [keyboard, setKeyboard] = useState({ openId, id: openId });
    if (keyboard.openId !== openId) setKeyboard({ openId, id: openId ?? keyboard.id });
    const listed = (id: string | undefined) => comments.find(comment => comment.id === id && !isLeaving(comment));
    const current = listed(keyboard.id) ?? listed(opened?.id);
    const tabStop = current ?? comments.find(comment => !isLeaving(comment));
    // Where the current row was, so the keys go on from there once it has left the list (Done, a filter)
    const lastIndex = useRef(0);
    useEffect(() => {
        const index = current ? comments.indexOf(current) : -1;
        if (index >= 0) lastIndex.current = index;
    });

    const moveWithKeys = useEffectEvent((event: KeyboardEvent) => {
        const list = listRef.current;
        const { target, key } = event;
        const step = key === 'ArrowDown' || key === 'Home' ? 1 : key === 'ArrowUp' || key === 'End' ? -1 : 0;
        if (!step || !list || !(target instanceof Node) || event.defaultPrevented || event.isComposing
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !list.checkVisibility()) return;
        const inList = list.contains(target);
        const onPage = (target === document.body || target === document.documentElement)
            && !detailRef.current?.contains(document.getSelection()?.anchorNode ?? null);
        const edge = key === 'Home' || key === 'End';
        if (edge ? !inList : !inList && !onPage) return;
        // The first row from `from` on, in the direction of `step`, that is not folding away
        const walk = (from: number, step: number) => {
            for (let index = from; index >= 0 && index < comments.length; index += step)
                if (!isLeaving(comments[index]!)) return comments[index];
        };
        let next: ProjectCommentView | undefined;
        if (edge) next = walk(step > 0 ? 0 : comments.length - 1, step);
        else {
            const row = inList && target instanceof Element ? target.closest<HTMLElement>('[data-comment-id]')?.dataset.commentId : undefined;
            const from = comments.findIndex(comment => comment.id === (row ?? current?.id));
            if (from >= 0) next = walk(from + step, step);
            // The open thread left the list: the row that took its place is next, the one above it previous
            else if (opened) next = walk(step > 0 ? lastIndex.current : lastIndex.current - 1, step);
            // Beside the list the first thread is shown until another is chosen
            else next = sideBySide() ? walk(step, step) : walk(0, 1);
        }
        // At the first or the last row the keys do nothing, rather than scroll the page
        event.preventDefault();
        if (!next) return;
        const row = list.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(next.id)}"]`);
        // The same control in that row: its selection box from a selection box, otherwise its link
        const fromBox = target instanceof Element && target.closest('[role="checkbox"]');
        const control = (fromBox && row?.querySelector<HTMLElement>('[role="checkbox"]')) || document.getElementById(commentRowId(next.id));
        setKeyboard(state => ({ ...state, id: next.id }));
        control?.focus({ preventScroll: true });
        row?.scrollIntoView({ block: 'nearest' });
        if (sideBySide()) open(next.id);
    });
    useEffect(() => {
        // Bubble phase on the window, after the page's own handlers, so a key they used (`preventDefault`) stays theirs
        const listener = (event: KeyboardEvent) => moveWithKeys(event);
        window.addEventListener('keydown', listener);
        return () => window.removeEventListener('keydown', listener);
    }, []);

    const leave = (id: string, status: CommentStatus): ResolveExit => {
        // The thread stays open while its row leaves; otherwise the next one would take its place
        if (!opened) open(id, undefined, { replace: true });
        setLeaving(current => ({ ...current, [id]: status }));
        return {
            finished: new Promise(resolve => setTimeout(resolve, exitMs)),
            cancel: () => setLeaving(({ [id]: _, ...rest }) => rest)
        };
    };

    // In the list's place: the thread starts at the top with Back; Back returns to its row
    const previousOpenId = useRef(openId);
    useEffect(() => {
        const previous = previousOpenId.current;
        previousOpenId.current = openId;
        if (sideBySide() || openId === previous) return;
        if (openId) {
            detailRef.current?.scrollIntoView({ block: 'start' });
            detailRef.current?.querySelector<HTMLElement>('[aria-label="Back to comments"]')?.focus();
        } else if (previous) {
            const row = document.getElementById(commentRowId(previous));
            row?.focus({ preventScroll: true });
            row?.scrollIntoView({ block: 'center' });
        }
        // Only when the open thread changes; the width is read then
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openId]);

    return (
        <div className="grid grid-cols-1 items-start gap-4 @4xl/comments:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] @6xl/comments:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
            <LayoutMotion container={listRef} item="data-comment-id">
            {/* `isolate`: rows that move stay under the page's sticky header, and leaving copies above the list's background */}
            <ul ref={listRef} aria-label={label} className={cn('relative isolate m-0 flex min-w-0 list-none flex-col gap-0.5 rounded-xl border bg-card p-1', opened && '@max-4xl/comments:hidden')}
                onFocus={event => {
                    const id = event.target.closest<HTMLElement>('[data-comment-id]')?.dataset.commentId;
                    if (id) setKeyboard(state => state.id === id ? state : { ...state, id });
                }}>
                {comments.map(comment => {
                    const leaves = isLeaving(comment);
                    return (
                        // Scroll margin: clear of the phone layout's sticky header when the keys bring a row into view
                        <li key={comment.id} inert={leaves} data-comment-id={comment.id}
                            // While it moves (`LayoutMotion`), a row covers the rows it passes, and the copy of one that
                            // leaves fades out beneath the rows that take its place
                            className={cn('grid min-w-0 scroll-mt-14 scroll-mb-1 grid-cols-1 grid-rows-[1fr] transition-[grid-template-rows,opacity,translate] duration-150 ease-out motion-reduce:transition-none data-motion:rounded-lg data-motion:bg-card data-[motion=exit]:-z-1 md:scroll-mt-1',
                                leaves && 'grid-rows-[0fr] -translate-y-2 opacity-0')}>
                            <div className={cn('min-h-0', leaves && 'overflow-hidden')}>
                                <CommentRow comment={comment} href={hrefFor(comment.id)} tabbable={comment.id === tabStop?.id}
                                    selected={comment.id === opened?.id ? 'opened' : comment.id === selected?.id ? 'beside' : undefined}
                                    onOpen={event => open(comment.id, event)} />
                            </div>
                        </li>
                    );
                })}
            </ul>
            </LayoutMotion>
            {selected && (
                <div ref={detailRef}
                    className={cn('min-w-0 scroll-mt-4 @4xl/comments:sticky @4xl/comments:top-0 @4xl/comments:max-h-[calc(100svh-5rem)] @4xl/comments:overflow-y-auto @4xl/comments:rounded-xl',
                        !opened && '@max-4xl/comments:hidden')}>
                    <CommentCard key={selected.id}
                        projectId={projectId}
                        comment={selected}
                        reviewLink={KnownPageLinks.projectReview(projectId, selected.url, selected.id)}
                        assignees={assignees}
                        userId={userId}
                        onBack={close}
                        // Once read, the first shown thread would leave an unread-only list and the next one would be
                        // shown, and read, in its place: it is opened instead, which keeps it and its row
                        onReadWhenShown={readLeaves && !opened ? () => open(selected.id, undefined, { replace: true }) : undefined}
                        onMove={status => keeps(status) ? undefined : leave(selected.id, status)} />
                </div>
            )}
        </div>
    );
}
