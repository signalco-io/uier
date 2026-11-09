'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import {
    DndContext, DragOverlay, MouseSensor, TouchSensor, defaultDropAnimationSideEffects, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
    type Active, type Announcements, type DraggableSyntheticListeners, type DropAnimation, type Over
} from '@dnd-kit/core';
import { ArrowRightLeftIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { KnownPageLinks } from '../../../knownPages';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { Button } from '@/src/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/src/components/ui/sheet';
import { Spinner } from '@/src/components/ui/spinner';
import { CommentCard, type AssigneeOption } from './CommentCard';
import { CommentRow, commentRowId } from './CommentRow';
import { commentStatus, commentStatuses, commentStatusLabels, StateDot, StateMenu, type CommentStatus } from './CommentStatus';
import { allowedStatuses, useStatusChanger } from './useStatusChange';
import type { useOpenComment } from './CommentInbox';

/** The board's columns: every status, in order (`commentStatuses`); drag and drop and Move follow this list */
const statuses = commentStatuses;
const emptyColumn: Record<CommentStatus, string> = { open: 'Nothing open.', 'in-progress': 'Nothing in progress.', ready: 'No checks requested.', done: 'Nothing done yet.' };

/** "comment #12", or "comment" before it has a number */
const commentName = (comment: ProjectCommentView) => comment.number !== undefined ? `comment #${comment.number}` : 'comment';
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** A column takes the card when it is another status the person may move it to (`allowedStatuses`) */
const takes = (comment: ProjectCommentView, status: CommentStatus) => status !== commentStatus(comment) && allowedStatuses(comment)[status];
const draggedComment = (active: Active) => (active.data.current as { comment?: ProjectCommentView } | undefined)?.comment;
const columnOf = (over: Over | null) => statuses.find(status => status === over?.id);

/**
 * What a screen reader hears while a card is dragged (dnd-kit's live region). Keyboard and screen
 * reader users move cards with Move (M on a focused card), which announces the move itself.
 */
const announcements: Announcements = {
    onDragStart: ({ active }) => {
        const comment = draggedComment(active);
        return comment && `Picked up ${commentName(comment)} from ${commentStatusLabels[commentStatus(comment)]}.`;
    },
    onDragOver: ({ active, over }) => {
        const comment = draggedComment(active);
        const status = columnOf(over);
        if (!comment) return;
        const name = sentence(commentName(comment));
        if (!status) return `${name} is not over a column.`;
        if (status === commentStatus(comment)) return `${name} is over ${commentStatusLabels[status]}, where it is now.`;
        return takes(comment, status) ? `${name} is over ${commentStatusLabels[status]}.` : `${name} can't move to ${commentStatusLabels[status]}.`;
    },
    onDragEnd: ({ active, over }) => {
        const comment = draggedComment(active);
        const status = columnOf(over);
        if (!comment || !status) return;
        return status === 'ready'
            ? `${sentence(commentName(comment))} was dropped on Ready to verify. Request verification to move it.`
            : `${sentence(commentName(comment))} moved to ${commentStatusLabels[status]}.`;
    },
    onDragCancel: ({ active, over }) => {
        const comment = draggedComment(active);
        const status = columnOf(over);
        if (!comment) return;
        const stays = `It stays in ${commentStatusLabels[commentStatus(comment)]}.`;
        return status && status !== commentStatus(comment) ? `${sentence(commentName(comment))} can't move to ${commentStatusLabels[status]}. ${stays}` : `${sentence(commentName(comment))} stays in ${commentStatusLabels[commentStatus(comment)]}.`;
    }
};

/** The lifted card settles into its new place (or back) with the brand's 150 ms ease-out */
const dropAnimation: DropAnimation = {
    duration: 150,
    easing: 'ease-out',
    sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } })
};

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void) {
    const query = window.matchMedia(reducedMotionQuery);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}
const subscribeNothing = () => () => {};

/**
 * A press that lifted a card can still end in a click on its link (a short long-press on a touch
 * screen): it must not open the thread or follow the link.
 */
function suppressClickAfterDrag() {
    const prevent = (event: Event) => {
        // A keyboard click (Enter, or M opening Move) carries no pointer detail and goes through
        if ((event as globalThis.MouseEvent).detail === 0) return;
        event.preventDefault();
        event.stopPropagation();
        stop();
    };
    const stop = () => {
        window.removeEventListener('click', prevent, { capture: true });
        window.removeEventListener('pointerdown', stop, { capture: true });
    };
    window.addEventListener('click', prevent, { capture: true });
    // Another press is another gesture, and its click goes through
    window.addEventListener('pointerdown', stop, { capture: true });
    window.setTimeout(stop, 100);
}

/** A card is dragged from its own surface; its selection box and Move keep their presses (Move opens on press) */
function fromCardSurface(listeners: DraggableSyntheticListeners) {
    if (!listeners) return {};
    return Object.fromEntries(Object.entries(listeners).map(([name, listener]) => [name, (event: SyntheticEvent<HTMLElement>) => {
        const target = event.target as Element;
        if (event.currentTarget.contains(target) && !target.closest('button, input, [role="checkbox"]')) listener(event);
    }]));
}

const noMoves = (allowed: Record<CommentStatus, boolean>) => Object.fromEntries(Object.keys(allowed).map(status => [status, false])) as Record<CommentStatus, boolean>;
const moveIcon = (moving: boolean) => moving ? <Spinner /> : <ArrowRightLeftIcon />;
/** The key that opens Move on a focused card */
const moveKey = 'm';
/**
 * Pointers drag the card, so Move is visually hidden (and takes no room) until its card has keyboard
 * focus or its menu is open. Screen readers always find it.
 */
const moveButtonClassName = cn('relative z-10 -my-1 -mr-1.5 shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11',
    '[[data-board-card]:not(:has(:focus-visible))_&:not([data-popup-open])]:sr-only');

/** M on a focused card opens its Move, as Enter on Move does (a click without pointer detail highlights the first column) */
function openMoveFromKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== moveKey) return;
    const button = event.currentTarget.querySelector<HTMLButtonElement>('[data-move]');
    if (!button) return;
    event.preventDefault();
    button.focus();
    button.click();
}

/**
 * A board card: the row's summary, dragged by itself to another column (the mouse, or a long press on
 * a touch screen), and Move (the same statuses, like the thread's status menu) for the keyboard and
 * screen readers: Tab to it, or press M on the card. A pointer that does not drag opens the thread and
 * its status menu.
 */
function BoardCard({ comment, href, opened, moving, entering, onEntered, onOpen, onMove }: {
    comment: ProjectCommentView;
    href: string;
    opened: boolean;
    moving: boolean;
    /** Moved here with Move: enters the column */
    entering: boolean;
    onEntered: () => void;
    onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
    onMove: (status: CommentStatus) => void;
}) {
    const status = commentStatus(comment);
    const allowed = allowedStatuses(comment);
    const canMove = statuses.some(option => option !== status && allowed[option]);
    const { setNodeRef, listeners, isDragging } = useDraggable({ id: comment.id, data: { comment }, disabled: !canMove || moving });
    const shortcutId = useId();
    return (
        <li ref={setNodeRef} {...fromCardSurface(listeners)} data-board-card={comment.id} onAnimationEnd={entering ? onEntered : undefined}
            onKeyDown={canMove ? openMoveFromKeyboard : undefined}
            className={cn('rounded-lg transition-opacity duration-150 ease-out',
                canMove && 'touch-manipulation select-none [-webkit-touch-callout:none] [&_a]:cursor-grab',
                isDragging && 'opacity-40',
                entering && 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:duration-150 motion-safe:ease-out')}>
            {canMove && <span id={shortcutId} hidden>Press M to move it to another column.</span>}
            <CommentRow card comment={comment} href={href} selected={opened ? 'opened' : undefined} onOpen={onOpen}
                describedBy={canMove ? shortcutId : undefined} keyShortcuts={canMove ? 'M' : undefined}
                actions={canMove && (
                    // While the move saves, Move keeps the focus it was given but offers no other column
                    <StateMenu status={status} allowed={moving ? noMoves(allowed) : allowed} disabled={false} onChange={onMove}
                        trigger={(
                            <Button variant="ghost" size="icon-xs" aria-label={`Move ${commentName(comment)}`} data-move={comment.id} className={moveButtonClassName}>
                                {moveIcon(moving)}
                            </Button>
                        )} />
                )} />
        </li>
    );
}

type ColumnState = 'idle' | 'home' | 'target' | 'over' | 'refused';

/**
 * A column and its drop target. While a card is dragged, the columns it can move to are dashed, the
 * one under it is highlighted, and the others are dimmed and refuse it.
 */
function BoardColumn({ status, count, state, children }: { status: CommentStatus; count: number; state: ColumnState; children: ReactNode }) {
    // A placeholder changes a column's height, and on narrow screens moves the columns below it
    const { setNodeRef } = useDroppable({ id: status, resizeObserverConfig: { updateMeasurementsFor: [...statuses] } });
    return (
        <section ref={setNodeRef} aria-label={`${commentStatusLabels[status]} comments`} data-drop={state === 'idle' ? undefined : state}
            className={cn('flex min-h-24 flex-col gap-2 rounded-2xl border bg-muted/50 p-2 transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-out',
                'data-[drop=over]:border-dashed data-[drop=target]:border-dashed data-[drop=target]:border-foreground/30',
                'data-[drop=over]:border-foreground/30 data-[drop=over]:bg-muted data-[drop=over]:ring-2 data-[drop=over]:ring-ring data-[drop=refused]:opacity-50')}>
            <h3 className="m-0 flex items-center gap-2 px-2 pt-1 text-sm font-medium">
                <StateDot status={status} />
                {commentStatusLabels[status]}
                <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
            </h3>
            {children}
        </section>
    );
}

/**
 * Open, In progress, Ready to verify and Done side by side, as compact cards. A card opens its thread in a sheet
 * (the URL's `?comment=`), so the board stays where it was. Cards move between columns by dragging
 * (dnd-kit: the mouse, or a long press on a touch screen) or with Move; a column a card cannot move to
 * does not take it. Ready to verify opens the thread with the Request verification form, which asks for
 * the details first. Moves show at once and go back if saving fails (`useStatusChanger`).
 */
export function CommentBoard({ projectId, columns, allComments, assignees, userId, openComment }: {
    projectId: string;
    columns: Record<CommentStatus, ProjectCommentView[]>;
    allComments: ProjectCommentView[];
    assignees: AssigneeOption[];
    userId: string;
    openComment: ReturnType<typeof useOpenComment>;
}) {
    const { openId, hrefFor, open, close } = openComment;
    const opened = openId ? allComments.find(comment => comment.id === openId) : undefined;
    const { change, pending } = useStatusChanger(projectId);
    const [movingId, setMovingId] = useState<string>();
    // The thread to open with its Request verification form
    const [verifyId, setVerifyId] = useState<string>();
    // The dragged card (with its height, for the place it would land) and the column under it
    const [drag, setDrag] = useState<{ comment: ProjectCommentView; height: number }>();
    const [over, setOver] = useState<CommentStatus>();
    // Moved with Move: it enters its new column, the focus follows it there and the move is announced
    const [enteringId, setEnteringId] = useState<string>();
    const focusAfterMove = useRef<{ id: string; status: CommentStatus }>(undefined);
    const [announcement, setAnnouncement] = useState('');
    const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
    // The lifted card goes to the body, above the sheet and out of any clipping container
    const client = useSyncExternalStore(subscribeNothing, () => true, () => false);
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        // A long press, so a swipe over the cards still scrolls the page
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
    );
    // Cards keep the list's order in every column: where a moved card lands
    const order = new Map(allComments.map((comment, index) => [comment.id, index]));

    const move = (comment: ProjectCommentView, status: CommentStatus, via: 'drag' | 'menu') => {
        setMovingId(comment.id);
        if (via === 'menu' && status !== 'ready') {
            setEnteringId(comment.id);
            focusAfterMove.current = { id: comment.id, status };
            setAnnouncement(`${sentence(commentName(comment))} moved to ${commentStatusLabels[status]}.`);
        }
        change(comment, status, {
            onVerify: () => {
                setVerifyId(comment.id);
                open(comment.id, undefined, { replace: false });
            }
        });
    };
    // Move's menu closes with the card it was on, so the focus is lost: give it to Move on the card in its
    // new column. A frame later, once the closed menu no longer keeps the page inert.
    useEffect(() => {
        const target = focusAfterMove.current;
        if (!target || !columns[target.status].some(comment => comment.id === target.id)) return;
        focusAfterMove.current = undefined;
        requestAnimationFrame(() => {
            const button = document.querySelector<HTMLElement>(`[data-move="${CSS.escape(target.id)}"]`);
            if (!button || (document.activeElement && document.activeElement !== document.body)) return;
            button.focus({ preventScroll: true });
            button.closest('li')?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
        });
    });
    const closeThread = () => {
        setVerifyId(undefined);
        close();
    };
    const endDrag = () => {
        setDrag(undefined);
        setOver(undefined);
        suppressClickAfterDrag();
    };
    const columnState = (status: CommentStatus): ColumnState => {
        if (!drag) return 'idle';
        if (status === commentStatus(drag.comment)) return 'home';
        if (!takes(drag.comment, status)) return 'refused';
        return over === status ? 'over' : 'target';
    };
    // Where the dragged card would land in the column under it
    const landing = (status: CommentStatus) => {
        const position = order.get(drag?.comment.id ?? '') ?? 0;
        const index = columns[status].findIndex(comment => (order.get(comment.id) ?? 0) > position);
        return index === -1 ? columns[status].length : index;
    };
    const refusedOver = Boolean(drag && over && over !== commentStatus(drag.comment) && !takes(drag.comment, over));

    return (
        <>
            <DndContext id="comment-board" sensors={sensors} collisionDetection={pointerWithin}
                accessibility={{ announcements, screenReaderInstructions: { draggable: 'To move a comment to another column, focus it and press M.' } }}
                onDragStart={({ active }) => {
                    const comment = draggedComment(active);
                    if (!comment) return;
                    setEnteringId(undefined);
                    // dnd-kit measures the card after this: the place it would land takes its height now
                    const card = document.querySelector(`[data-board-card="${CSS.escape(comment.id)}"]`);
                    setDrag({ comment, height: card?.getBoundingClientRect().height ?? 0 });
                }}
                onDragOver={({ over: target }) => setOver(columnOf(target))}
                // A column that does not take the card cancels the drop: the card goes back
                cancelDrop={({ active, over }) => {
                    const comment = draggedComment(active);
                    const status = columnOf(over);
                    return !comment || !status || !takes(comment, status);
                }}
                onDragEnd={({ active, over }) => {
                    endDrag();
                    const comment = draggedComment(active);
                    const status = columnOf(over);
                    if (comment && status && takes(comment, status)) move(comment, status, 'drag');
                }}
                onDragCancel={endDrag}>
                {/* From lg the board takes the panel's width (`page-wide`) while the page around it keeps the reading
                    width, with one row of equal columns, one per status however many there are. A column stops at
                    20rem (four fill a 1674 px window with the sidebar open) and the row is centred beyond that.
                    While a card is dragged every column is as tall as the longest, so any part of it takes the card. */}
                <div data-page-width="wide" className={cn('grid grid-cols-1 items-start gap-4 lg:page-wide lg:grid-flow-col lg:grid-cols-none lg:auto-cols-[minmax(0,20rem)] lg:justify-center', drag && 'lg:items-stretch')}>
                    {statuses.map(status => {
                        const state = columnState(status);
                        const cards = columns[status];
                        const placeholder = state === 'over' ? landing(status) : -1;
                        const slot = <li key="placeholder" aria-hidden="true" data-drop-placeholder="" style={{ height: drag?.height }}
                            className="rounded-lg border border-dashed border-foreground/30 bg-background/60" />;
                        const items = cards.map(comment => (
                            <BoardCard key={comment.id} comment={comment} href={hrefFor(comment.id)} opened={comment.id === openId}
                                moving={pending && movingId === comment.id}
                                entering={enteringId === comment.id} onEntered={() => setEnteringId(undefined)}
                                onOpen={event => open(comment.id, event, { replace: false })}
                                onMove={next => move(comment, next, 'menu')} />
                        ));
                        if (placeholder >= 0) items.splice(placeholder, 0, slot);
                        return (
                            <BoardColumn key={status} status={status} count={cards.length} state={state}>
                                {items.length ? (
                                    <ul aria-label={`${commentStatusLabels[status]} comments list`} className="m-0 flex list-none flex-col gap-2 p-0">
                                        {items}
                                    </ul>
                                ) : <p className="m-0 px-2 pb-1 text-sm text-muted-foreground">{state === 'target' ? 'Drop here.' : emptyColumn[status]}</p>}
                            </BoardColumn>
                        );
                    })}
                </div>
                {client && createPortal(
                    <DragOverlay dropAnimation={reducedMotion ? null : dropAnimation} className={refusedOver ? 'cursor-not-allowed' : 'cursor-grabbing'}>
                        {drag && (
                            // The lifted card: floating, like a menu (BRAND.md, "Borders and elevation")
                            <div inert aria-hidden="true" data-drag-preview="" className="rounded-lg bg-card shadow-md ring-1 ring-foreground/10">
                                <CommentRow card preview comment={drag.comment} href={hrefFor(drag.comment.id)} />
                            </div>
                        )}
                    </DragOverlay>,
                    document.body
                )}
            </DndContext>
            <p role="status" className="sr-only">{announcement}</p>
            <Sheet open={Boolean(opened)} onOpenChange={next => { if (!next) closeThread(); }}>
                <SheetContent side="right" showCloseButton={false} className="gap-0 overflow-x-hidden overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
                    finalFocus={() => (opened ? document.getElementById(commentRowId(opened.id)) : null) ?? true}>
                    <SheetTitle className="sr-only">{opened?.number !== undefined ? `Comment #${opened.number}` : 'Comment'}</SheetTitle>
                    {opened && (
                        <CommentCard key={`${opened.id}-${verifyId === opened.id}`}
                            className="rounded-none border-0 ring-0"
                            projectId={projectId}
                            comment={opened}
                            reviewLink={KnownPageLinks.projectReview(projectId, opened.url, opened.id)}
                            assignees={assignees}
                            userId={userId}
                            startVerifying={verifyId === opened.id}
                            onBack={closeThread} />
                    )}
                </SheetContent>
            </Sheet>
        </>
    );
}
