'use client';

import { useContext } from 'react';
import { defaultStatusWorkflow, orderedStatuses, statusForComment, workflowStatusLabel, type StatusWorkflow, type WorkflowStatus } from '../../../lib/app/statusWorkflow';
import { useAppI18n } from '@/src/lib/i18n/client';

import { Fragment, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';
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
import type { AssigneeOption } from './CommentCard';
import { CommentRow, commentRowId, BoardRowScope } from './CommentRow';
import { commentStatus, commentStatuses, GlowingStateDot, StateMenu, type CommentStatus } from './CommentStatus';
import { allowedStatuses, movedPatch, useStatusChanger } from './useStatusChange';
import type { BoardColumn as BoardColumnKey, BoardSort } from '../../../lib/app/boardSort';
import { BoardSortMenu } from './BoardSortMenu';
import { ArchiveAllButton, type ArchiveAllScope } from './ArchiveAllButton';
import { sortBoardColumn } from './commentOrder';
import type { useOpenComment } from './CommentInbox';
import { LayoutMotion, motionSettled } from './LayoutMotion';
import { shortcutLetter } from '@uier/toolbar/keyboard';
import { isShortcutTarget, useShortcutsEnabled } from '../keyboard/keys';
import { HoldTouchSensor } from './holdTouchSensor';
import { longPressDelay, pressTolerance } from './TriageSelection';
import { VirtualCommentList, revealVirtualComment, type CommentPageControl, type CommentListPosition } from './VirtualCommentList';
import { Spinner } from '@/src/components/ui/spinner';
import { PagedCommentCard } from './PagedCommentCard';

/** The board's columns: every status, in order (`commentStatuses`); drag and drop and Move follow this list */
const statuses = commentStatuses;
const emptyColumn: Record<CommentStatus, string> = { open: 'Nothing open.', 'in-progress': 'Nothing in progress.', ready: 'No checks requested.', done: 'Nothing done yet.' };

/** "comment #12", or "comment" before it has a number */
const commentName = (comment: ProjectCommentView, t: import('@/src/lib/i18n/types').AppTranslator) => comment.number !== undefined ? t('comment #{number}', { number: comment.number }) : t('comment');
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** A column takes the card when it is another status the person may move it to (`allowedStatuses`) */
const takes = (comment: ProjectCommentView, status: WorkflowStatus) => {
    const category = status.category as CommentStatus;
    return !comment.archivedAt && (category !== commentStatus(comment) ? allowedStatuses(comment)[category]
        : Boolean(comment.permissions.resolve) && status.id !== statusForComment(comment.workflow ?? defaultStatusWorkflow, comment, false).id);
};
const draggedComment = (active: Active) => (active.data.current as { comment?: ProjectCommentView } | undefined)?.comment;
const columnOf = (over: Over | null, definitions: WorkflowStatus[]) => definitions.find(status => status.id === over?.id)?.id;

/**
 * What a screen reader hears while a card is dragged (dnd-kit's live region). Keyboard and screen
 * reader users move cards with Move (M on a focused card), which announces the move itself.
 */
const boardAnnouncements = (t: import('@/src/lib/i18n/types').AppTranslator, definitions: WorkflowStatus[], workflow?: StatusWorkflow): Announcements => {
    const label = (id: string) => { const status = definitions.find(status => status.id === id); return status ? workflowStatusLabel(status, t) : id; };
    const current = (comment: ProjectCommentView) => workflow ? statusForComment(workflow, comment, false).id : commentStatus(comment);
    const accepts = (comment: ProjectCommentView, id: string) => takes(comment, definitions.find(status => status.id === id)!);
    return {
        onDragStart: ({ active }) => {
            const comment = draggedComment(active);
            return comment && t("Picked up {comment} from {status}.", { comment: commentName(comment, t), status: label(current(comment)) });
        },
        onDragOver: ({ active, over }) => {
            const comment = draggedComment(active);
            const status = columnOf(over, definitions);
            if (!comment) return;
            const name = sentence(commentName(comment, t));
            if (!status) return t("{comment} is not over a column.", { comment: name });
            if (status === current(comment)) return t("{comment} is over {status}, where it is now.", { comment: name, status: label(status) });
            return accepts(comment, status) ? t("{comment} is over {status}.", { comment: name, status: label(status) }) : t("{comment} can't move to {status}.", { comment: name, status: label(status) });
        },
        onDragEnd: ({ active, over }) => {
            const comment = draggedComment(active);
            const status = columnOf(over, definitions);
            if (!comment || !status) return;
            return definitions.find(option => option.id === status)?.category === 'ready'
                ? t("{comment} was dropped on Ready to verify. Request verification to move it.", { comment: sentence(commentName(comment, t)) })
                : t("{comment} moved to {status}.", { comment: sentence(commentName(comment, t)), status: label(status) });
        },
        onDragCancel: ({ active, over }) => {
            const comment = draggedComment(active);
            const status = columnOf(over, definitions);
            if (!comment) return;
            const stays = t("It stays in {status}.", { status: label(current(comment)) });
            return status && status !== current(comment) ? t("{comment} can't move to {status}.", { comment: sentence(commentName(comment, t)), status: label(status) }) + " " + stays : t("{comment} stays in {status}.", { comment: sentence(commentName(comment, t)), status: label(current(comment)) });
        }
    };
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
/** BRAND.md, "Motion": the Archive strip changes size like an item changes place */
const archiveMorphMs = 200;

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
function BoardCard({ project, comment, href, opened, moving, tabbable, onOpen, onMove, position }: {
    /** The thread's project; its name shows on the card where the board has several projects' threads (My work) */
    project: BoardProject;
    position?: CommentListPosition;
    comment: ProjectCommentView;
    href: string;
    opened: boolean;
    moving: boolean;
    /** The board's one tab stop: its link, Move, avatars and selection box are in the Tab order */
    tabbable: boolean;
    onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
    onMove: (status: CommentStatus, statusId?: string) => void;
}) {
    const { t } = useAppI18n();
    const status = commentStatus(comment);
    const allowed = allowedStatuses(comment);
    // An archived card stays in Archive until Restore comment (in its thread) returns it to its status
    const canMove = !comment.archivedAt && (statuses.some(option => option !== status && allowed[option]) || (comment.permissions.resolve && (comment.workflow?.statuses.filter(option => option.category === status).length ?? 0) > 1));
    const { setNodeRef, listeners, isDragging } = useDraggable({ id: comment.id, data: { comment }, disabled: !canMove || moving });
    const shortcutId = useId();
    return (
        <li ref={setNodeRef} {...position} {...fromCardSurface(listeners)} data-board-card={comment.id}
            onKeyDown={canMove ? openMoveFromKeyboard : undefined}
            className={cn('rounded-lg transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-opacity',
                canMove && 'touch-manipulation select-none [-webkit-touch-callout:none] [&_a]:cursor-grab',
                // Held on a touch screen: a move now lifts it (`HoldTouchSensor`)
                'data-hold:scale-[0.98]',
                isDragging && 'opacity-40')}>
            {canMove && <span id={shortcutId} hidden>{t("Press M to move it to another column.")}</span>}
            <CommentRow card comment={comment} projectId={project.id} project={project.name} projectUrl={project.url} href={href} selected={opened ? 'opened' : undefined} onOpen={onOpen} tabbable={tabbable}
                describedBy={canMove ? shortcutId : undefined} keyShortcuts={canMove ? 'M' : undefined}
                actions={canMove && (
                    // While the move saves, Move keeps the focus it was given but offers no other column
                    <StateMenu comment={comment} status={status} allowed={moving ? noMoves(allowed) : allowed} disabled={false} onChange={onMove}
                        trigger={(
                            // Only set to take it out: an explicit `undefined` would replace Base UI's own tab index
                            <Button variant="ghost" size="icon-xs" aria-label={t("Move {value0}", { value0: commentName(comment, t) })} data-move={comment.id} className={moveButtonClassName}
                                {...!tabbable && { tabIndex: -1 }}>
                                {moveIcon(moving)}
                            </Button>
                        )} />
                )} />
        </li>
    );
}

/** Always reserves the icon's space, including while the lane is idle; 12 px like the icons of the column's icon-xs actions (uier #432). */
function ColumnProgress({ loading }: { loading?: boolean }) {
    return <span aria-hidden="true" data-column-progress={Boolean(loading)} className="ml-auto flex size-3 shrink-0 items-center text-muted-foreground">
        {loading && <Spinner className="size-3 motion-reduce:animate-none" />}
    </span>;
}

type ColumnState = 'idle' | 'home' | 'target' | 'over' | 'refused';

/**
 * A column and its drop target. While a card is dragged, the columns it can move to are dashed, the
 * one under it is highlighted, and the others are dimmed and refuse it. Its header ends with the column's
 * sort for the people who may change it (`onSort`).
 */
function BoardColumn({ loading, status, definition, columnIds, count, state, sort, onSort, archiveAll, children }: {
    status: CommentStatus;
    definition: WorkflowStatus;
    columnIds: string[];
    count: number;
    state: ColumnState;
    loading?: boolean;
    sort: BoardSort;
    onSort?: (status: BoardColumnKey, sort: BoardSort) => void;
    /** Archive all (uier #357), for the people who may triage */
    archiveAll?: ArchiveAllScope;
    children: ReactNode;
}) {
    // A placeholder changes a column's height, and on narrow screens moves the columns below it
    const { t } = useAppI18n();
    const { setNodeRef } = useDroppable({ id: definition.id, resizeObserverConfig: { updateMeasurementsFor: columnIds } });
    // Archive all only where finished threads wait (Done-category columns, uier #370)
    const archivable = Boolean(archiveAll) && status === 'done' && count > 0;
    return (
        <section ref={setNodeRef} aria-label={t("{status} comments", { status: workflowStatusLabel(definition, t) })} data-drop={state === 'idle' ? undefined : state}
            className={cn('flex min-h-24 flex-col gap-2 rounded-2xl border bg-muted/50 p-2 transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-out',
                'data-[drop=over]:border-dashed data-[drop=target]:border-dashed data-[drop=target]:border-foreground/30',
                'data-[drop=over]:border-foreground/30 data-[drop=over]:bg-muted data-[drop=over]:ring-2 data-[drop=over]:ring-ring data-[drop=refused]:opacity-50')}>
            <div className="flex items-center gap-2 px-2 pt-1">
                <h3 className="m-0 flex min-w-0 items-center gap-2 text-sm font-medium">
                    {/* A column with cards glows around its dot, so the columns that need attention stand out (uier #356) */}
                    <GlowingStateDot status={status} glow={count > 0} />
                    <span className="truncate" title={definition.description || definition.label}>{workflowStatusLabel(definition, t)}</span>
                    <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
                </h3>
                <ColumnProgress loading={loading} />
                {/* Archive all, left of the sort, while a Done column has cards (uier #357, #370) */}
                {archivable && archiveAll && <ArchiveAllButton scope={archiveAll} lane={definition.id} label={workflowStatusLabel(definition, t)} count={count} />}
                {onSort && <BoardSortMenu label={workflowStatusLabel(definition, t)} status={status} sort={sort} onChange={next => onSort(status, next)} className="ml-0" />}
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
function ArchiveColumn({ loading, label = 'Archive', count, sort, onSort, expanded, dimmed, onExpandedChange, children }: {
    label?: string;
    loading?: boolean;
    count: number;
    sort: BoardSort;
    onSort?: (status: BoardColumnKey, sort: BoardSort) => void;
    expanded: boolean;
    dimmed: boolean;
    onExpandedChange: (expanded: boolean) => void;
    children: ReactNode;
}) {
    const { t } = useAppI18n();
    // The toggle is another button in each state: the focus goes to the new one
    const toggle = useRef<HTMLButtonElement>(null);
    const toggled = useRef(false);
    useEffect(() => {
        if (!toggled.current) return;
        toggled.current = false;
        toggle.current?.focus({ preventScroll: true });
    }, [expanded]);
    // The board's tracks and the column's height before a toggle, which it morphs from (uier #369)
    const section = useRef<HTMLElement>(null);
    const morphFrom = useRef<{ columns: string; height: number } | null>(null);
    const change = () => {
        toggled.current = true;
        const grid = section.current?.parentElement;
        morphFrom.current = section.current && grid && !window.matchMedia(reducedMotionQuery).matches
            ? { columns: getComputedStyle(grid).gridTemplateColumns, height: section.current.offsetHeight } : null;
        onExpandedChange(!expanded);
    };
    // The strip widens into the column (or the column narrows into the strip) instead of jumping: the grid's tracks, in
    // pixels, and the column's height move in 200 ms, the new content fades in as it gets room, and the background and
    // opacity follow by transition. Before LayoutMotion measures, so the cards beside it ride along with their columns.
    useLayoutEffect(() => {
        const from = morphFrom.current;
        morphFrom.current = null;
        const element = section.current;
        const grid = element?.parentElement;
        if (!from || !element || !grid) return;
        const options = { duration: archiveMorphMs, easing: 'ease-out' };
        grid.animate({ gridTemplateColumns: [from.columns, getComputedStyle(grid).gridTemplateColumns] }, options);
        element.animate({ height: [`${from.height}px`, `${element.offsetHeight}px`], overflow: ['clip', 'clip'] }, options);
        for (const child of Array.from(element.children)) child.animate({ opacity: [0, 1] }, { duration: archiveMorphMs, easing: 'ease-in' });
    }, [expanded]);
    return (
        <section ref={section} aria-label={label === t('Archive') ? t('Archived comments') : t('{status} comments', { status: label })} data-board-archive={expanded ? 'expanded' : 'collapsed'} data-drop={dimmed ? 'refused' : undefined}
            className={cn('flex flex-col rounded-2xl border transition-[background-color,border-color,opacity] duration-200 ease-out motion-reduce:transition-none data-[drop=refused]:opacity-50',
                // Collapsed it stays out of the way (uier #369): no fill, a fainter edge and a muted name until it is pointed
                // at. Not a lower opacity on the whole strip: its count would fall below text contrast
                expanded ? 'min-h-24 gap-2 bg-muted/50 p-2' : 'border-border/50 bg-transparent hover:border-border md:self-start')}>
            {expanded ? (
                <>
                    <div className="flex items-center gap-2 px-2 pt-1">
                        <h3 className="m-0 flex min-w-0 items-center gap-2 text-sm font-medium">
                            <ArchiveIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                            {label}
                            <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
                        </h3>
                        <ColumnProgress loading={loading} />
                        {onSort && <BoardSortMenu label={label} status="archive" sort={sort} onChange={next => onSort('archive', next)} className="ml-0 mr-0" />}
                        <Tooltip>
                            <TooltipTrigger render={(
                                // Takes no more height than the column's name; 44 px to tap on a touch screen
                                <Button ref={toggle} variant="ghost" size="icon-xs" aria-label={t("Collapse {name}", { name: label })} aria-expanded="true" onClick={change}
                                    className={cn('relative -my-1 -mr-1.5 text-muted-foreground hover:text-foreground after:absolute after:-inset-2.5 pointer-fine:after:hidden', !onSort && 'ml-auto')} />
                            )}>
                                <FoldHorizontalIcon />
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{t("Collapse {name}", { name: label })}</TooltipContent>
                        </Tooltip>
                    </div>
                    {children}
                </>
            ) : (
                // The whole strip expands it. From md the strip is only as tall as its content, and the icon, the name
                // and the count run down it together, turned like the name (the icon by `rotate-90`, as writing modes leave SVG upright)
                <Button ref={toggle} variant="ghost" aria-expanded="false" onClick={change}
                    className="group/archive h-auto min-h-11 w-full justify-start rounded-2xl px-4 py-2.5 font-medium text-muted-foreground hover:text-foreground md:justify-center md:px-0 md:py-3">
                    <span className="flex items-center gap-2 md:[writing-mode:vertical-rl]">
                        <ArchiveIcon className="opacity-60 transition-opacity duration-150 group-hover/archive:opacity-100 group-focus-visible/archive:opacity-100 motion-reduce:transition-none md:rotate-90" />
                        <span>{label}</span>{' '}
                        <ColumnProgress loading={loading} />
                        <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
                    </span>
                </Button>
            )}
        </section>
    );
}

/**
 * The project a card's thread belongs to: the same for every card on a project's board, each thread's own on My work,
 * where the card names it (`name`). Moves are saved there with that thread's permissions, and its thread opens in the
 * sheet with that project's people to assign.
 */
/** `name` and `url` (its first address, for its icon) name the project on its cards, where a board mixes projects (My work) */
export type BoardProject = { id: string; name?: string; url?: string; assignees: AssigneeOption[] };

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
 * it from the column's header. Archive is the last column (`archive`), collapsed unless the project expands it; My work,
 * which leaves archived threads out, has none.
 */
export function CommentBoard({ projectOf, columns: categoryColumns, workflow, verificationEnabled, sorts, onSort, archiveAll, archive, allComments, userId, openComment, paging, detailRevision }: {
    workflow?: StatusWorkflow;
    verificationEnabled?: boolean;
    /** Each thread's project (`BoardProject`) */
    detailRevision?: string;
    paging?: Record<string, CommentPageControl>;
    projectOf: (comment: ProjectCommentView) => BoardProject;
    /** Each column's cards, in its sort */
    columns: Record<CommentStatus, ProjectCommentView[]>;
    sorts: Record<BoardColumnKey, BoardSort>;
    /** Changes a column's sort (Archive's too) for everyone; missing for people who may not */
    onSort?: (status: BoardColumnKey, sort: BoardSort) => void;
    /** Archive all in a column's header (a project's board, for the people who may triage) */
    archiveAll?: ArchiveAllScope;
    /** The archived threads, in Archive's sort, and whether their column is expanded; missing for no Archive column */
    archive?: { comments: ProjectCommentView[]; expanded: boolean; onExpandedChange: (expanded: boolean) => void };
    /** Every thread the board's sheet can open, archived ones too */
    allComments: ProjectCommentView[];
    userId: string;
    openComment: ReturnType<typeof useOpenComment>;
}) {
    const { t } = useAppI18n();
    const rowScope = useContext(BoardRowScope);
    const definitions = orderedStatuses(workflow ?? defaultStatusWorkflow).filter(status => status.category !== 'archive' && (status.category !== 'ready' || (verificationEnabled ?? (workflow ? workflow.verificationEnabled === true : allComments.some(comment => comment.verificationEnabled)))));
    const statuses = definitions.map(status => status.id);
    const definition = (id: string) => definitions.find(status => status.id === id)!;
    const categoryOf = (id: string) => definition(id).category as CommentStatus;
    const currentStatus = (comment: ProjectCommentView) => workflow ? statusForComment(workflow, comment, false).id : commentStatus(comment);
    const accepts = (comment: ProjectCommentView, id: string) => {
        if (!workflow) return !comment.archivedAt && categoryOf(id) !== commentStatus(comment) && allowedStatuses(comment)[categoryOf(id)];
        return takes(comment, definition(id));
    };
    const columns = Object.fromEntries(definitions.map(status => [status.id, categoryColumns[status.category as CommentStatus].filter(comment => currentStatus(comment) === status.id)]));
    const archiveDefinitions = orderedStatuses(workflow ?? defaultStatusWorkflow).filter(status => status.category === 'archive');
    const archiveCards = (status: WorkflowStatus) => archive?.comments.filter(comment => !workflow || statusForComment(workflow, comment).id === status.id) ?? [];
    const { openId, hrefFor, open, close } = openComment;
    const opened = openId ? allComments.find(comment => comment.id === openId) : undefined;
    const { change, pending } = useStatusChanger(comment => projectOf(comment).id);
    const openedProject = opened && projectOf(opened);
    const archiveExpanded = Boolean(archive?.expanded);
    // The board's one tab stop (a roving tab index, like the list's): the card last focused, else the open one,
    // else the first. The arrow keys move between the cards and the columns.
    const [focusId, setFocusId] = useState<string>();
    // What the keys go through, column by column: the statuses, then Archive while it is expanded
    const lanes = [...statuses.map(status => (columns[status] ?? [])), ...(archive?.expanded ? archiveDefinitions.map(archiveCards) : [])];
    const cards = lanes.flat();
    const listed = (id: string | undefined) => cards.find(comment => comment.id === id);
    const current = listed(focusId) ?? listed(openId);
    const tabStop = current ?? cards[0];
    const sheetRef = useRef<HTMLDivElement>(null);
    const [movingId, setMovingId] = useState<string>();
    // The thread to open with its Request verification form
    const [verifyId, setVerifyId] = useState<string>();
    const [verifyStatusId, setVerifyStatusId] = useState<string>();
    // The dragged card (with its height, for the place it would land) and the column under it
    const [drag, setDrag] = useState<{ comment: ProjectCommentView; height: number }>();
    const [over, setOver] = useState<string>();
    // Moved with Move: it travels to its new column (`LayoutMotion`), the focus follows it there and the move is announced
    const focusAfterMove = useRef<{ id: string; status: string }>(undefined);
    const [announcement, setAnnouncement] = useState('');
    const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
    // The lifted card goes to the body, above the sheet and out of any clipping container
    const client = useSyncExternalStore(subscribeNothing, () => true, () => false);
    // dnd-kit names its live region and drag instructions after this id: a project's board Next keeps hidden after
    // navigating away must not repeat them (uier #328), and server and client still agree on it
    const boardId = useId();
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

    const move = (comment: ProjectCommentView, status: string, via: 'drag' | 'menu', selectedStatusId?: string) => {
        setMovingId(comment.id);
        if (via === 'menu' && categoryOf(status) !== 'ready') {
            focusAfterMove.current = { id: comment.id, status };
            setAnnouncement(t("{value0} moved to {value1}.", { value0: sentence(commentName(comment, t)), value1: workflowStatusLabel(definition(status), t) }));
        }
        change(comment, categoryOf(status), {
            onVerify: () => {
                setVerifyId(comment.id);
                setVerifyStatusId(workflow ? status : selectedStatusId);
                open(comment.id, undefined, { replace: false });
            }
        }, workflow ? status : selectedStatusId);
    };
    // Move's menu closes with the card it was on, so the focus is lost: give it to Move on the card in its
    // new column. A frame later, once the closed menu no longer keeps the page inert.
    useEffect(() => {
        const target = focusAfterMove.current;
        if (!target || !(columns[target.status] ?? []).some(comment => comment.id === target.id)) return;
        focusAfterMove.current = undefined;
        requestAnimationFrame(() => {
            const button = grid.current?.querySelector<HTMLElement>(`[data-move="${CSS.escape(target.id)}"]`);
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
        setFocusId(next.id);
        revealVirtualComment(next.id);
        const id = next.id;
        requestAnimationFrame(() => {
            const card = board.querySelector<HTMLElement>(`[data-board-card="${CSS.escape(id)}"]`);
            const fromBox = target.closest('[role="checkbox"]');
            const control = (fromBox && card?.querySelector<HTMLElement>('[role="checkbox"]')) || document.getElementById(commentRowId(rowScope + id));
            control?.focus({ preventScroll: true });
            card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
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
    const columnState = (status: string): ColumnState => {
        if (!drag) return 'idle';
        if (status === currentStatus(drag.comment)) return 'home';
        if (!accepts(drag.comment, status)) return 'refused';
        return over === status ? 'over' : 'target';
    };
    // Where the dragged card would land in the column under it: the card as the move shows it (`movedPatch`: first
    // in Done by completion, or by update), placed by the column's sort among its cards, as it will be after the drop
    const landing = (status: string) => {
        if (!drag) return -1;
        const moved = { ...drag.comment, ...movedPatch(drag.comment, categoryOf(status)), workflowStatusId: workflow ? status : undefined };
        const listed = [...(columns[status] ?? []), moved].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        return sortBoardColumn(listed, sorts[categoryOf(status)]).indexOf(moved);
    };
    const refusedOver = Boolean(drag && over && over !== currentStatus(drag.comment) && !accepts(drag.comment, over));

    return (
        <>
            <DndContext id={boardId} sensors={sensors} collisionDetection={pointerWithin}
                accessibility={{ announcements: boardAnnouncements(t, definitions, workflow), screenReaderInstructions: { draggable: t("To move a comment to another column, focus it and press M.") } }}
                onDragStart={({ active }) => {
                    const comment = draggedComment(active);
                    if (!comment) return;
                    // dnd-kit measures the card after this: the place it would land takes its height now
                    const card = grid.current?.querySelector(`[data-board-card="${CSS.escape(comment.id)}"]`);
                    setFocusId(comment.id);
                    setDrag({ comment, height: card?.getBoundingClientRect().height ?? 0 });
                }}
                onDragOver={({ over: target }) => setOver(columnOf(target, definitions))}
                // A column that does not take the card cancels the drop: the card goes back
                cancelDrop={({ active, over }) => {
                    const comment = draggedComment(active);
                    const status = columnOf(over, definitions);
                    return !comment || !status || !accepts(comment, status);
                }}
                onDragEnd={({ active, over }) => {
                    endDrag();
                    const comment = draggedComment(active);
                    const status = columnOf(over, definitions);
                    if (comment && status && accepts(comment, status)) move(comment, status, 'drag');
                }}
                onDragCancel={endDrag}>
                {/* The board takes the panel's width while the page around it keeps the reading width, with one row of
                    equal columns, one per status however many there are, on a phone too (uier #305). A column is 18rem to
                    20rem (four fill a 1674 px window with the sidebar open), on a phone at most the page's width less 3rem
                    so the next column peeks in, and the row is centred beyond that; when
                    the columns don't fit, the board scrolls sideways (`data-board-scroll`, a swipe on a touch screen) instead
                    of squeezing them. The scroller runs edge to edge of the panel and is padded by the page gutter
                    (`page-bleed`), so the first and last columns line up with the page at either end and the rest scroll under
                    the panel's edges; room for a column's drop ring above and below (`py-1`); not up and down
                    (`overflow-y-clip`), the page does that: a column is as tall as its cards and never scrolls on its own,
                    so the whole board scrolls with the page (`pageScroll`, uier #400).
                    Archive comes last: a 3rem strip while collapsed, a column like the others when expanded
                    (`--board-columns`, so the statuses stay data-driven).
                    While a card is dragged every column is as tall as the longest, so any part of it takes the card. */}
                <LayoutMotion container={grid} item="data-board-card" skip={settling}>
                <div ref={grid} data-page-width="wide" data-board-scroll=""
                    style={{ '--board-columns': `repeat(${statuses.length + (archiveExpanded ? archiveDefinitions.length : 0)}, minmax(min(18rem, var(--page-wide) - 3rem), 20rem))${archive && !archiveExpanded ? ` repeat(${archiveDefinitions.length}, 3rem)` : ''}` } as CSSProperties}
                    onFocus={event => {
                        const id = event.target.closest<HTMLElement>('[data-board-card]')?.dataset.boardCard;
                        if (id && id !== focusId) setFocusId(id);
                    }}
                    className={cn('relative grid grid-cols-(--board-columns) items-start justify-center-safe gap-4 overflow-x-auto overflow-y-clip overscroll-x-contain py-1 page-bleed', drag && 'items-stretch')}>
                    {statuses.map(status => {
                        const state = columnState(status);
                        const cards = (columns[status] ?? []);
                        const placeholder = state === 'over' ? landing(status) : -1;
                        const slot = <li key="placeholder" aria-hidden="true" data-drop-placeholder="" style={{ height: drag?.height }}
                            className="rounded-lg border border-dashed border-foreground/30 bg-background/60" />;
                        return (
                            <BoardColumn loading={paging?.[status]?.loading} key={status} status={categoryOf(status)} definition={definition(status)} columnIds={statuses} count={paging?.[status]?.total ?? cards.length} state={state} sort={sorts[categoryOf(status)]} onSort={onSort} archiveAll={archiveAll}>
                                {cards.length || placeholder >= 0 ? (
                                    <VirtualCommentList pageScroll items={cards} control={paging?.[status]} focusedId={focusId ?? tabStop?.id}
                                        label={t("{value0} comments list", { value0: workflowStatusLabel(definition(status), t) })}
                                        footer={placeholder === cards.length ? slot : undefined}
                                        render={(comment, index, position) => <Fragment key={comment.id}>
                                            {index === placeholder && slot}
                                            <BoardCard position={position} project={projectOf(comment)} comment={comment} href={hrefFor(comment.id)} opened={comment.id === openId}
                                                moving={pending && movingId === comment.id} tabbable={comment.id === tabStop?.id}
                                                onOpen={event => open(comment.id, event, { replace: false })}
                                                onMove={(category, id) => move(comment, workflow ? id ?? category : category, 'menu', id)} />
                                        </Fragment>} />
                                ) : (
                                    // In the middle of the column's room below its name, a drag's longer column too
                                    <p data-empty-column="" className="m-0 flex flex-1 items-center px-2 text-sm text-muted-foreground">{state === 'target' ? t("Drop here.") : t(emptyColumn[categoryOf(status)])}</p>
                                )}
                            </BoardColumn>
                        );
                    })}
                    {archive && archiveDefinitions.map(archiveStatus => <ArchiveColumn loading={paging?.[archiveStatus.id]?.loading} key={archiveStatus.id} label={workflowStatusLabel(archiveStatus, t)} count={paging?.[archiveStatus.id]?.total ?? archiveCards(archiveStatus).length} sort={sorts.archive} onSort={onSort} expanded={archive.expanded} dimmed={Boolean(drag)} onExpandedChange={archive.onExpandedChange}>
                        {archiveCards(archiveStatus).length ? (
                            <VirtualCommentList pageScroll items={archiveCards(archiveStatus)} control={paging?.[archiveStatus.id]} focusedId={focusId ?? tabStop?.id}
                                label={t("Archived comments list")} render={(comment, _index, position) => (
                                    <BoardCard position={position} key={comment.id} project={projectOf(comment)} comment={comment} href={hrefFor(comment.id)} opened={comment.id === openId}
                                        moving={false} tabbable={comment.id === tabStop?.id}
                                        onOpen={event => open(comment.id, event, { replace: false })} onMove={() => {}} />
                                )} />
                        ) : (
                            <p data-empty-column="" className="m-0 flex flex-1 items-center px-2 text-sm text-muted-foreground">{t("Nothing archived.")}</p>
                        )}
                    </ArchiveColumn>)}
                </div>
                </LayoutMotion>
                {client && createPortal(
                    <DragOverlay dropAnimation={reducedMotion ? null : dropAnimation} className={refusedOver ? 'cursor-not-allowed' : 'cursor-grabbing'}>
                        {drag && (
                            // The lifted card: floating, like a menu (BRAND.md, "Borders and elevation")
                            <div inert aria-hidden="true" data-drag-preview={drag.comment.id} className="rounded-lg bg-card shadow-md ring-1 ring-foreground/10">
                                <CommentRow card preview comment={drag.comment} project={projectOf(drag.comment).name} projectUrl={projectOf(drag.comment).url} href={hrefFor(drag.comment.id)} />
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
                    finalFocus={() => (opened ? document.getElementById(commentRowId(rowScope + opened.id)) : null) ?? true}>
                    <SheetTitle className="sr-only">{opened?.number !== undefined ? t("Comment #{value0}", { value0: opened.number }) : t("Comment")}</SheetTitle>
                    {opened && openedProject && (
                        // `shrink-0`: the card clips (`overflow-hidden`), so as a flex item it would shrink to the sheet's
                        // height and hide what is below the fold; at its full height the sheet scrolls it
                        <PagedCommentCard snapshotRevision={detailRevision} key={`${opened.id}-${verifyId === opened.id}`}
                            className="shrink-0 rounded-none border-0 ring-0"
                            projectId={openedProject.id}
                            comment={opened}
                            reviewLink={KnownPageLinks.projectReview(openedProject.id, opened.url, opened.id)}
                            assignees={openedProject.assignees}
                            userId={userId}
                            startVerifying={verifyId === opened.id}
                            startVerifyingStatusId={verifyStatusId}
                            onBack={closeThread} />
                    )}
                </SheetContent>
            </Sheet>
        </>
    );
}
