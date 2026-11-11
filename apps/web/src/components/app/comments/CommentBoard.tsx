'use client';

import { useEffect, useEffectEvent, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import {
    DndContext, DragOverlay, MouseSensor, defaultDropAnimationSideEffects, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
    type Active, type Announcements, type DraggableSyntheticListeners, type DropAnimation, type Over
} from '@dnd-kit/core';
import { ArchiveIcon, ArrowRightLeftIcon, FoldHorizontalIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { KnownPageLinks } from '../../../knownPages';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { Button } from '@/src/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/src/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { Spinner } from '@/src/components/ui/spinner';
import { CommentCard, type AssigneeOption } from './CommentCard';
import { CommentRow, commentRowId } from './CommentRow';
import { commentStatus, commentStatuses, commentStatusLabels, StateDot, StateMenu, type CommentStatus } from './CommentStatus';
import { allowedStatuses, movedPatch, useStatusChanger } from './useStatusChange';
import type { BoardColumn as BoardColumnKey, BoardSort } from '../../../lib/app/boardSort';
import { BoardSortMenu } from './BoardSortMenu';
import { sortBoardColumn } from './commentOrder';
import type { useOpenComment } from './CommentInbox';
import { LayoutMotion, motionSettled } from './LayoutMotion';
import { shortcutLetter } from '@uier/toolbar/keyboard';
import { isShortcutTarget, useShortcutsEnabled } from '../keyboard/keys';
import { HoldTouchSensor } from './holdTouchSensor';
import { longPressDelay, pressTolerance } from './TriageSelection';

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
 * A board card: the row's summary, dragged by itself to another column (the mouse, or held then moved on
 * a touch screen; a long press held still selects it instead), and Move (the same statuses, like the thread's status menu) for the keyboard and
 * screen readers: Tab to it, or press M on the card. A pointer that does not drag opens the thread and
 * its status menu.
 */
function BoardCard({ projectId, comment, href, opened, moving, tabbable, onOpen, onMove }: {
    projectId: string;
    comment: ProjectCommentView;
    href: string;
    opened: boolean;
    moving: boolean;
    /** The board's one tab stop: its link, Move, avatars and selection box are in the Tab order */
    tabbable: boolean;
    onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
    onMove: (status: CommentStatus) => void;
}) {
    const status = commentStatus(comment);
    const allowed = allowedStatuses(comment);
    // An archived card stays in Archive until Restore comment (in its thread) returns it to its status
    const canMove = !comment.archivedAt && statuses.some(option => option !== status && allowed[option]);
    const { setNodeRef, listeners, isDragging } = useDraggable({ id: comment.id, data: { comment }, disabled: !canMove || moving });
    const shortcutId = useId();
    return (
        <li ref={setNodeRef} {...fromCardSurface(listeners)} data-board-card={comment.id}
            onKeyDown={canMove ? openMoveFromKeyboard : undefined}
            className={cn('rounded-lg transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-opacity',
                canMove && 'touch-manipulation select-none [-webkit-touch-callout:none] [&_a]:cursor-grab',
                // Held on a touch screen: a move now lifts it (`HoldTouchSensor`)
                'data-hold:scale-[0.98]',
                isDragging && 'opacity-40')}>
            {canMove && <span id={shortcutId} hidden>Press M to move it to another column.</span>}
            <CommentRow card comment={comment} projectId={projectId} href={href} selected={opened ? 'opened' : undefined} onOpen={onOpen} tabbable={tabbable}
                describedBy={canMove ? shortcutId : undefined} keyShortcuts={canMove ? 'M' : undefined}
                actions={canMove && (
                    // While the move saves, Move keeps the focus it was given but offers no other column
                    <StateMenu status={status} allowed={moving ? noMoves(allowed) : allowed} disabled={false} onChange={onMove}
                        trigger={(
                            // Only set to take it out: an explicit `undefined` would replace Base UI's own tab index
                            <Button variant="ghost" size="icon-xs" aria-label={`Move ${commentName(comment)}`} data-move={comment.id} className={moveButtonClassName}
                                {...!tabbable && { tabIndex: -1 }}>
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
 * one under it is highlighted, and the others are dimmed and refuse it. Its header ends with the column's
 * sort for the people who may change it (`onSort`).
 */
function BoardColumn({ status, count, state, sort, onSort, children }: {
    status: CommentStatus;
    count: number;
    state: ColumnState;
    sort: BoardSort;
    onSort?: (status: BoardColumnKey, sort: BoardSort) => void;
    children: ReactNode;
}) {
    // A placeholder changes a column's height, and on narrow screens moves the columns below it
    const { setNodeRef } = useDroppable({ id: status, resizeObserverConfig: { updateMeasurementsFor: [...statuses] } });
    return (
        <section ref={setNodeRef} aria-label={`${commentStatusLabels[status]} comments`} data-drop={state === 'idle' ? undefined : state}
            className={cn('flex min-h-24 flex-col gap-2 rounded-2xl border bg-muted/50 p-2 transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-out',
                'data-[drop=over]:border-dashed data-[drop=target]:border-dashed data-[drop=target]:border-foreground/30',
                'data-[drop=over]:border-foreground/30 data-[drop=over]:bg-muted data-[drop=over]:ring-2 data-[drop=over]:ring-ring data-[drop=refused]:opacity-50')}>
            <div className="flex items-center gap-2 px-2 pt-1">
                <h3 className="m-0 flex min-w-0 items-center gap-2 text-sm font-medium">
                    <StateDot status={status} />
                    {commentStatusLabels[status]}
                    <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
                </h3>
                {onSort && <BoardSortMenu status={status} sort={sort} onChange={next => onSort(status, next)} />}
            </div>
            {children}
        </section>
    );
}

/**
 * The board's last column: the archived threads, in the project's sort for it (newest archived first by default),
 * which its header offers like Done's to the people who may change it (`onSort`). Collapsed (the default) it is a narrow strip
 * with its name and count, which expands it; expanded it is a column of cards like the others, whose header collapses
 * it again. The choice is the project's, like the columns' sorts (`onExpandedChange`). It is not a drop target and
 * its cards don't move: Restore comment in the thread returns one to its status. While a card is dragged it is dimmed.
 */
function ArchiveColumn({ count, sort, onSort, expanded, dimmed, onExpandedChange, children }: {
    count: number;
    sort: BoardSort;
    onSort?: (status: BoardColumnKey, sort: BoardSort) => void;
    expanded: boolean;
    dimmed: boolean;
    onExpandedChange: (expanded: boolean) => void;
    children: ReactNode;
}) {
    // The toggle is another button in each state: the focus goes to the new one
    const toggle = useRef<HTMLButtonElement>(null);
    const toggled = useRef(false);
    useEffect(() => {
        if (!toggled.current) return;
        toggled.current = false;
        toggle.current?.focus({ preventScroll: true });
    }, [expanded]);
    const change = () => {
        toggled.current = true;
        onExpandedChange(!expanded);
    };
    return (
        <section aria-label="Archived comments" data-board-archive={expanded ? 'expanded' : 'collapsed'} data-drop={dimmed ? 'refused' : undefined}
            className={cn('flex flex-col rounded-2xl border bg-muted/50 transition-opacity duration-150 ease-out data-[drop=refused]:opacity-50',
                expanded ? 'min-h-24 gap-2 p-2' : 'md:min-h-24 md:self-stretch')}>
            {expanded ? (
                <>
                    <div className="flex items-center gap-2 px-2 pt-1">
                        <h3 className="m-0 flex min-w-0 items-center gap-2 text-sm font-medium">
                            <ArchiveIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                            Archive
                            <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
                        </h3>
                        {onSort && <BoardSortMenu status="archive" sort={sort} onChange={next => onSort('archive', next)} className="mr-0" />}
                        <Tooltip>
                            <TooltipTrigger render={(
                                // Takes no more height than the column's name; 44 px to tap on a touch screen
                                <Button ref={toggle} variant="ghost" size="icon-xs" aria-label="Collapse Archive" aria-expanded="true" onClick={change}
                                    className={cn('relative -my-1 -mr-1.5 text-muted-foreground hover:text-foreground after:absolute after:-inset-2.5 pointer-fine:after:hidden', !onSort && 'ml-auto')} />
                            )}>
                                <FoldHorizontalIcon />
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Collapse Archive</TooltipContent>
                        </Tooltip>
                    </div>
                    {children}
                </>
            ) : (
                // The whole strip expands it; from md its name runs down the strip
                <Button ref={toggle} variant="ghost" aria-expanded="false" onClick={change}
                    className="h-auto min-h-11 w-full justify-start gap-2 rounded-2xl px-4 py-2.5 font-medium md:flex-1 md:flex-col md:px-0 md:py-3">
                    <ArchiveIcon className="text-muted-foreground" />
                    <span className="md:[writing-mode:vertical-rl]">Archive</span>{' '}
                    <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
                </Button>
            )}
        </section>
    );
}

/**
 * Open, In progress, Ready to verify and Done side by side, as compact cards, with one tab stop: the arrow keys move
 * between the cards and the columns, Enter opens a card's thread and J and K go to the next and the previous one.
 * A card opens its thread in a sheet
 * (the URL's `?comment=`), so the board stays where it was. Cards move between columns by dragging
 * (dnd-kit: the mouse, or a long press on a touch screen) or with Move; a column a card cannot move to
 * does not take it. Ready to verify opens the thread with the Request verification form, which asks for
 * the details first. Moves show at once and go back if saving fails (`useStatusChanger`). Cards that
 * arrive, leave or change column however it happens animate (`LayoutMotion`), except the dragged one,
 * which dnd-kit settles from where it was dropped. Each column is in the project's sort for it (`sorts`, already
 * applied to `columns`): drops, Move and the keys follow it, and the people who may change it (`onSort`) choose
 * it from the column's header. Archive is the last column (`archive`), collapsed unless the project expands it.
 */
export function CommentBoard({ projectId, columns, sorts, onSort, archive, allComments, assignees, userId, openComment }: {
    projectId: string;
    /** Each column's cards, in its sort */
    columns: Record<CommentStatus, ProjectCommentView[]>;
    sorts: Record<BoardColumnKey, BoardSort>;
    /** Changes a column's sort (Archive's too) for everyone; missing for people who may not */
    onSort?: (status: BoardColumnKey, sort: BoardSort) => void;
    /** The archived threads, in Archive's sort, and whether their column is expanded */
    archive: { comments: ProjectCommentView[]; expanded: boolean; onExpandedChange: (expanded: boolean) => void };
    /** Every thread the board's sheet can open, archived ones too */
    allComments: ProjectCommentView[];
    assignees: AssigneeOption[];
    userId: string;
    openComment: ReturnType<typeof useOpenComment>;
}) {
    const { openId, hrefFor, open, close } = openComment;
    const opened = openId ? allComments.find(comment => comment.id === openId) : undefined;
    const { change, pending } = useStatusChanger(projectId);
    // The board's one tab stop (a roving tab index, like the list's): the card last focused, else the open one,
    // else the first. The arrow keys move between the cards and the columns.
    const [focusId, setFocusId] = useState<string>();
    // What the keys go through, column by column: the statuses, then Archive while it is expanded
    const lanes = [...statuses.map(status => columns[status]), ...(archive.expanded ? [archive.comments] : [])];
    const cards = lanes.flat();
    const listed = (id: string | undefined) => cards.find(comment => comment.id === id);
    const current = listed(focusId) ?? listed(openId);
    const tabStop = current ?? cards[0];
    const sheetRef = useRef<HTMLDivElement>(null);
    const [movingId, setMovingId] = useState<string>();
    // The thread to open with its Request verification form
    const [verifyId, setVerifyId] = useState<string>();
    // The dragged card (with its height, for the place it would land) and the column under it
    const [drag, setDrag] = useState<{ comment: ProjectCommentView; height: number }>();
    const [over, setOver] = useState<CommentStatus>();
    // Moved with Move: it travels to its new column (`LayoutMotion`), the focus follows it there and the move is announced
    const focusAfterMove = useRef<{ id: string; status: CommentStatus }>(undefined);
    const [announcement, setAnnouncement] = useState('');
    const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
    // The lifted card goes to the body, above the sheet and out of any clipping container
    const client = useSyncExternalStore(subscribeNothing, () => true, () => false);
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        // Held, then moved: a swipe over the cards still scrolls the page, and a long press held still selects the card
        useSensor(HoldTouchSensor, { delay: 250, tolerance: pressTolerance, longPress: longPressDelay })
    );
    // The list's order: a column's sort keeps it for ties, and so does the place a dragged card would land
    const order = new Map(allComments.map((comment, index) => [comment.id, index]));
    // The cards' positions are read in the grid, and copies of cards that leave fade out in it
    const grid = useRef<HTMLDivElement>(null);
    // A card whose lifted copy is on screen (dragged, or settling from the drop) is dnd-kit's to place
    const settling = () => new Set([...document.querySelectorAll<HTMLElement>('[data-drag-preview]')].map(preview => preview.dataset.dragPreview ?? ''));

    const move = (comment: ProjectCommentView, status: CommentStatus, via: 'drag' | 'menu') => {
        setMovingId(comment.id);
        if (via === 'menu' && status !== 'ready') {
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
            // Into view where it lands, once it has travelled there
            const card = button.closest('li');
            void motionSettled(card).then(() => card?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' }));
        });
    });
    // ↑ and ↓ move to the previous and the next card in the column, ← and → to the card in the same place in the
    // column beside it (or its last), past empty columns, Home and End to the column's first and last; the keys stop at
    // the ends. From a card only (its link, Move, avatars or selection box), never from a menu or a field.
    // J and K go to the next and the previous card in reading order (column by column) from anywhere but a text
    // field, a menu or a dialog; with a thread open in the sheet, they open that card's thread in it.
    const shortcuts = useShortcutsEnabled();
    const moveWithKeys = useEffectEvent((event: globalThis.KeyboardEvent) => {
        const board = grid.current;
        const { target, key } = event;
        if (!board || !(target instanceof Element) || event.defaultPrevented || event.isComposing
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const letter = shortcuts ? shortcutLetter(event) : undefined;
        const thread = letter === 'j' ? 1 : letter === 'k' ? -1 : 0;
        let next: ProjectCommentView | undefined;
        if (thread) {
            if (!isShortcutTarget(event)) return;
            event.preventDefault();
            const from = cards.findIndex(comment => comment.id === (opened ?? current)?.id);
            next = from < 0 ? cards.at(thread > 0 ? 0 : -1) : cards[from + thread];
            if (!next) return;
            if (opened) {
                setFocusId(next.id);
                open(next.id, undefined, { replace: true });
                // The thread's card is a new one: the sheet keeps the focus
                requestAnimationFrame(() => {
                    if (!sheetRef.current?.contains(document.activeElement)) sheetRef.current?.focus();
                });
                return;
            }
        } else {
            const id = target.closest<HTMLElement>('[data-board-card]')?.dataset.boardCard;
            const column = lanes.findIndex(lane => lane.some(comment => comment.id === id));
            if (!id || column < 0 || !board.contains(target)) return;
            const list = lanes[column]!;
            const index = list.findIndex(comment => comment.id === id);
            if (key === 'ArrowDown' || key === 'ArrowUp') next = list[index + (key === 'ArrowDown' ? 1 : -1)];
            else if (key === 'Home' || key === 'End') next = list.at(key === 'Home' ? 0 : -1);
            else if (key === 'ArrowLeft' || key === 'ArrowRight') {
                const step = key === 'ArrowRight' ? 1 : -1;
                for (let other = column + step; other >= 0 && other < lanes.length && !next; other += step) {
                    const beside = lanes[other]!;
                    next = beside[Math.min(index, beside.length - 1)];
                }
            } else return;
            // At the ends the keys do nothing, rather than scroll the page
            event.preventDefault();
            if (!next || next.id === id) return;
        }
        const card = board.querySelector<HTMLElement>(`[data-board-card="${CSS.escape(next.id)}"]`);
        // The same control in that card: its selection box from a selection box, otherwise its link
        const fromBox = target.closest('[role="checkbox"]');
        const control = (fromBox && card?.querySelector<HTMLElement>('[role="checkbox"]')) || document.getElementById(commentRowId(next.id));
        setFocusId(next.id);
        control?.focus({ preventScroll: true });
        card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    useEffect(() => {
        // Bubble phase on the window, after the page's own handlers, so a key they used (`preventDefault`) stays theirs
        const listener = (event: globalThis.KeyboardEvent) => moveWithKeys(event);
        window.addEventListener('keydown', listener);
        return () => window.removeEventListener('keydown', listener);
    }, []);

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
    // Where the dragged card would land in the column under it: the card as the move shows it (`movedPatch`: first
    // in Done by completion, or by update), placed by the column's sort among its cards, as it will be after the drop
    const landing = (status: CommentStatus) => {
        if (!drag) return -1;
        const moved = { ...drag.comment, ...movedPatch(drag.comment, status) };
        const listed = [...columns[status], moved].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        return sortBoardColumn(listed, sorts[status]).indexOf(moved);
    };
    const refusedOver = Boolean(drag && over && over !== commentStatus(drag.comment) && !takes(drag.comment, over));

    return (
        <>
            <DndContext id="comment-board" sensors={sensors} collisionDetection={pointerWithin}
                accessibility={{ announcements, screenReaderInstructions: { draggable: 'To move a comment to another column, focus it and press M.' } }}
                onDragStart={({ active }) => {
                    const comment = draggedComment(active);
                    if (!comment) return;
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
                {/* From md (tablets too) the board takes the panel's width while the page around it keeps the reading
                    width, with one row of equal columns, one per status however many there are. A column is 18rem to
                    20rem (four fill a 1674 px window with the sidebar open) and the row is centred beyond that; when
                    the columns don't fit, the board scrolls sideways (`data-board-scroll`, a swipe on a touch screen) instead
                    of squeezing them. The scroller runs edge to edge of the panel and is padded by the page gutter
                    (`page-bleed`), so the first and last columns line up with the page at either end and the rest scroll under
                    the panel's edges; room for a column's drop ring above and below (`py-1`); not up and down
                    (`overflow-y-clip`), the page does that. A phone stacks the columns.
                    Archive comes last: a 3rem strip while collapsed, a column like the others when expanded
                    (`--board-columns`, so the statuses stay data-driven).
                    While a card is dragged every column is as tall as the longest, so any part of it takes the card. */}
                <LayoutMotion container={grid} item="data-board-card" skip={settling}>
                <div ref={grid} data-page-width="wide" data-board-scroll=""
                    style={{ '--board-columns': `repeat(${statuses.length + (archive.expanded ? 1 : 0)}, minmax(18rem, 20rem))${archive.expanded ? '' : ' 3rem'}` } as CSSProperties}
                    onFocus={event => {
                        const id = event.target.closest<HTMLElement>('[data-board-card]')?.dataset.boardCard;
                        if (id && id !== focusId) setFocusId(id);
                    }}
                    className={cn('relative grid grid-cols-1 items-start gap-4 md:page-bleed md:grid-cols-(--board-columns) md:justify-center-safe md:overflow-x-auto md:overflow-y-clip md:overscroll-x-contain md:py-1', drag && 'md:items-stretch')}>
                    {statuses.map(status => {
                        const state = columnState(status);
                        const cards = columns[status];
                        const placeholder = state === 'over' ? landing(status) : -1;
                        const slot = <li key="placeholder" aria-hidden="true" data-drop-placeholder="" style={{ height: drag?.height }}
                            className="rounded-lg border border-dashed border-foreground/30 bg-background/60" />;
                        const items = cards.map(comment => (
                            <BoardCard key={comment.id} projectId={projectId} comment={comment} href={hrefFor(comment.id)} opened={comment.id === openId}
                                moving={pending && movingId === comment.id} tabbable={comment.id === tabStop?.id}
                                onOpen={event => open(comment.id, event, { replace: false })}
                                onMove={next => move(comment, next, 'menu')} />
                        ));
                        if (placeholder >= 0) items.splice(placeholder, 0, slot);
                        return (
                            <BoardColumn key={status} status={status} count={cards.length} state={state} sort={sorts[status]} onSort={onSort}>
                                {items.length ? (
                                    <ul aria-label={`${commentStatusLabels[status]} comments list`} className="m-0 flex list-none flex-col gap-2 p-0">
                                        {items}
                                    </ul>
                                ) : (
                                    // In the middle of the column's room below its name, a drag's longer column too
                                    <p data-empty-column="" className="m-0 flex flex-1 items-center px-2 text-sm text-muted-foreground">{state === 'target' ? 'Drop here.' : emptyColumn[status]}</p>
                                )}
                            </BoardColumn>
                        );
                    })}
                    <ArchiveColumn count={archive.comments.length} sort={sorts.archive} onSort={onSort} expanded={archive.expanded} dimmed={Boolean(drag)} onExpandedChange={archive.onExpandedChange}>
                        {archive.comments.length ? (
                            <ul aria-label="Archived comments list" className="m-0 flex list-none flex-col gap-2 p-0">
                                {archive.comments.map(comment => (
                                    <BoardCard key={comment.id} projectId={projectId} comment={comment} href={hrefFor(comment.id)} opened={comment.id === openId}
                                        moving={false} tabbable={comment.id === tabStop?.id}
                                        onOpen={event => open(comment.id, event, { replace: false })}
                                        onMove={() => {}} />
                                ))}
                            </ul>
                        ) : (
                            <p data-empty-column="" className="m-0 flex flex-1 items-center px-2 text-sm text-muted-foreground">Nothing archived.</p>
                        )}
                    </ArchiveColumn>
                </div>
                </LayoutMotion>
                {client && createPortal(
                    <DragOverlay dropAnimation={reducedMotion ? null : dropAnimation} className={refusedOver ? 'cursor-not-allowed' : 'cursor-grabbing'}>
                        {drag && (
                            // The lifted card: floating, like a menu (BRAND.md, "Borders and elevation")
                            <div inert aria-hidden="true" data-drag-preview={drag.comment.id} className="rounded-lg bg-card shadow-md ring-1 ring-foreground/10">
                                <CommentRow card preview comment={drag.comment} href={hrefFor(drag.comment.id)} />
                            </div>
                        )}
                    </DragOverlay>,
                    document.body
                )}
            </DndContext>
            <p role="status" className="sr-only">{announcement}</p>
            <Sheet open={Boolean(opened)} onOpenChange={next => { if (!next) closeThread(); }}>
                {/* `data-shortcuts`: the thread's keys (R, S, A, J, K) work in the sheet, which is a dialog */}
                <SheetContent ref={sheetRef} data-shortcuts="" side="right" showCloseButton={false} className="gap-0 overflow-x-hidden overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
                    finalFocus={() => (opened ? document.getElementById(commentRowId(opened.id)) : null) ?? true}>
                    <SheetTitle className="sr-only">{opened?.number !== undefined ? `Comment #${opened.number}` : 'Comment'}</SheetTitle>
                    {opened && (
                        // `shrink-0`: the card clips (`overflow-hidden`), so as a flex item it would shrink to the sheet's
                        // height and hide what is below the fold; at its full height the sheet scrolls it
                        <CommentCard key={`${opened.id}-${verifyId === opened.id}`}
                            className="shrink-0 rounded-none border-0 ring-0"
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
