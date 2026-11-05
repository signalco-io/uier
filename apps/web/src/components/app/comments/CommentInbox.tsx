'use client';

import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/src/lib/utils';
import { KnownPageLinks } from '../../../knownPages';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { CommentCard, type AssigneeOption, type ResolveExit } from './CommentCard';
import { CommentRow, commentRowId } from './CommentRow';

/** The brand's exit (BRAND.md, "Motion"): 150 ms ease-out, fade plus 8 px slide */
const exitMs = 150;

/** The comments' container width from which the list and the open thread sit side by side (`@4xl`, 56rem) */
const sideBySidePx = 56 * 16;

/**
 * The open thread, in the URL (`?comment=<id>`) like the filters, so it can be linked, reloaded and
 * opened in a new tab. Side by side it replaces the history entry; where the thread takes the whole
 * width (a phone) and on the board it adds one, so Back closes it.
 */
export function useOpenComment(container: RefObject<HTMLElement | null>) {
    const searchParams = useSearchParams();
    const openId = searchParams.get('comment') ?? undefined;
    // The address this hook added to the history, so Back to comments can take it away again
    const pushed = useRef<string>(undefined);
    const sideBySide = () => (container.current?.offsetWidth ?? 0) >= sideBySidePx;
    const hrefFor = (id: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('comment', id);
        return `?${params}#comments`;
    };
    const open = (id: string, event?: MouseEvent, { replace = sideBySide() }: { replace?: boolean } = {}) => {
        // A new tab or window keeps the browser's own handling of the link
        if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
        event?.preventDefault();
        const url = new URL(window.location.href);
        url.searchParams.set('comment', id);
        if (replace) window.history.replaceState(null, '', url);
        else {
            window.history.pushState(null, '', url);
            pushed.current = url.href;
        }
    };
    const close = () => {
        // Only while that entry is still the current one: another navigation (a filter) stays
        const back = pushed.current === window.location.href;
        pushed.current = undefined;
        if (back) {
            window.history.back();
            return;
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('comment');
        window.history.replaceState(null, '', url);
    };
    return { openId, hrefFor, open, close, sideBySide };
}

/**
 * The list as an inbox: compact rows, and the open thread beside them (the first shown one until
 * another is chosen). Where there is no room for both, a row opens the thread in the list's place,
 * with Back to comments. A thread that Done or Reopen takes out of the list folds away first.
 */
export function CommentInbox({ projectId, comments, allComments, assignees, userId, label, keepsResolved, openComment }: {
    projectId: string;
    /** The shown comments, in order */
    comments: ProjectCommentView[];
    /** Every loaded comment: an opened thread stays open when a filter or its new status hides its row */
    allComments: ProjectCommentView[];
    assignees: AssigneeOption[];
    userId: string;
    label: string;
    /** Done and Reopen keep the comment here (the All status) */
    keepsResolved?: boolean;
    openComment: ReturnType<typeof useOpenComment>;
}) {
    const { openId, hrefFor, open, close, sideBySide } = openComment;
    const opened = openId ? allComments.find(comment => comment.id === openId) : undefined;
    const selected = opened ?? comments[0];
    const detailRef = useRef<HTMLDivElement>(null);
    const [initial] = useState(() => new Set(comments.map(comment => comment.id)));
    // Comment id → the state it is leaving for; it stays hidden only while it has the other one
    const [leaving, setLeaving] = useState<Record<string, boolean>>({});

    const leave = (id: string, resolved: boolean): ResolveExit => {
        // The thread stays open while its row leaves; otherwise the next one would take its place
        if (!opened) open(id, undefined, { replace: true });
        setLeaving(current => ({ ...current, [id]: resolved }));
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
    });

    return (
        <div className="grid grid-cols-1 items-start gap-4 @4xl/comments:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] @6xl/comments:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
            <ul aria-label={label} className={cn('m-0 flex min-w-0 list-none flex-col gap-0.5 rounded-xl border bg-card p-1', opened && '@max-4xl/comments:hidden')}>
                {comments.map(comment => {
                    const isLeaving = comment.id in leaving && leaving[comment.id] !== comment.resolved;
                    return (
                        <li key={comment.id} inert={isLeaving}
                            className={cn('grid min-w-0 grid-cols-1 grid-rows-[1fr] transition-[grid-template-rows,opacity,translate] duration-150 ease-out motion-reduce:transition-none',
                                isLeaving && 'grid-rows-[0fr] -translate-y-2 opacity-0',
                                !initial.has(comment.id) && 'animate-in fade-in slide-in-from-top-2 duration-150 ease-out motion-reduce:animate-none')}>
                            <div className={cn('min-h-0', isLeaving && 'overflow-hidden')}>
                                <CommentRow comment={comment} href={hrefFor(comment.id)}
                                    selected={comment.id === opened?.id ? 'opened' : comment.id === selected?.id ? 'beside' : undefined}
                                    onOpen={event => open(comment.id, event)} />
                            </div>
                        </li>
                    );
                })}
            </ul>
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
                        onResolve={keepsResolved ? undefined : resolved => leave(selected.id, resolved)} />
                </div>
            )}
        </div>
    );
}
