'use client';

import React, { Ref, useEffect, useRef } from 'react';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { Down, Drag, Inbox, Info } from '@signalco/ui-icons';
import { Mark } from '@uier/brand';
import type { ToolbarMode } from '../config';
import { CommentIcon } from './CommentIcon';
import { InkScope } from './InkScope';
import { ToolbarProfile } from './ToolbarProfile';
import { ToolbarOptions } from './ToolbarOptions';
import { ToolbarFeedback } from './ToolbarFeedback';
import { useToolbarMovement } from '../hooks/useReviewMovement';
import { canReviewToolbar } from '../toolbarReview';

type CommentToolbarProps = {
    mode: ToolbarMode;
    creatingPointComment: boolean;
    /** Only the button that expands the toolbar again is shown */
    collapsed: boolean;
    /** Authorized unread threads across all project pages */
    commentsCount?: number;
    /** Whether the API returned a full list (there may be more comments than `commentsCount`) */
    commentsCountCapped?: boolean;
    hintOpen?: boolean;
    /** `id` of the first-run hint, while it is open */
    hintId?: string;
    /** The reviewed project in the uier app (a review of a project's site, or a link with a project code) */
    projectUrl?: string;
    addButtonRef?: Ref<HTMLButtonElement>;
    inboxButtonRef?: Ref<HTMLButtonElement>;
    hintButtonRef?: Ref<HTMLButtonElement>;
    /** `fromKeyboard` is set when the button was activated with the keyboard (Enter or Space) */
    onAddPointComment: (fromKeyboard: boolean) => void;
    onCancelPointComment: () => void;
    /** Whether the inbox sidebar is open (the Inbox button opens and closes it) */
    sidebarOpen?: boolean;
    onToggleSidebar: () => void;
    /** The feedback dialog opened */
    onFeedbackOpen?: () => void;
    /** The page asked to give feedback: the feedback dialog opens */
    feedbackRequested?: boolean;
    onFeedbackRequestHandled?: () => void;
    onMoveStart?: () => void;
    onToggleHint?: () => void;
    onCollapsedChange: (collapsed: boolean) => void;
    /** Ends the review (`review` mode) */
    onExitReview?: () => void;
};

function isCoarsePointer() {
    return window.matchMedia('(pointer: coarse)').matches;
}

function countText(count: number, capped: boolean) {
    return capped ? `${count}+` : String(count);
}

export function CommentToolbar({
    mode, creatingPointComment, collapsed, commentsCount = 0, commentsCountCapped = false, hintOpen, hintId, projectUrl,
    addButtonRef, inboxButtonRef, hintButtonRef, sidebarOpen = false, onAddPointComment, onCancelPointComment, onToggleSidebar, onFeedbackOpen,
    feedbackRequested = false, onFeedbackRequestHandled, onMoveStart, onToggleHint, onCollapsedChange, onExitReview
}: CommentToolbarProps) {
    const navRef = useRef<HTMLElement>(null);
    const moveRef = useRef<HTMLButtonElement>(null);
    const movement = useToolbarMovement(navRef, onMoveStart);
    const resetPosition = () => { movement.reset(); requestAnimationFrame(() => moveRef.current?.focus()); };
    const capped = commentsCountCapped;
    const badgeText = commentsCount > 99 && !capped ? '99+' : countText(commentsCount, capped);
    const commentsLabel = commentsCount
        ? `${badgeText} unread ${commentsCount === 1 && !capped ? 'thread' : 'threads'}${commentsCount > 99 && !capped ? `, ${commentsCount} in total` : ''}`
        : undefined;

    // `detail` is 0 for clicks synthesized from Enter or Space
    const handleAddClick = (event: React.MouseEvent) => onAddPointComment(event.detail === 0);

    // The button that collapsed or expanded the toolbar is gone: its counterpart takes the focus
    const collapseButtonRef = useRef<HTMLButtonElement>(null);
    const expandButtonRef = useRef<HTMLButtonElement>(null);
    const toggledRef = useRef(false);
    const handleCollapsedChange = (next: boolean) => {
        toggledRef.current = true;
        onCollapsedChange(next);
    };
    useEffect(() => {
        if (toggledRef.current) {
            toggledRef.current = false;
            (collapsed ? expandButtonRef : collapseButtonRef).current?.focus();
        }
    }, [collapsed]);

    // The unread count is a blue pill (BRAND.md, "The review layer")
    const badge = Boolean(commentsCount) && (
        <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[hsl(var(--brand-accent))] px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-[hsl(var(--brand-accent-foreground))]">
            {badgeText}
        </span>
    );

    return (
        <InkScope>
            {/* Always rendered, so screen readers announce the instruction when point mode starts */}
            <div
                role="status"
                style={movement.instructionStyle}
                data-uier-capture-exclude=""
                className={cx('pointer-events-none fixed w-max max-w-[calc(100vw-2rem)] -translate-x-1/2', canReviewToolbar() ? 'z-[54]' : 'z-[51]')}>
                {creatingPointComment && (
                    <p className="m-0 rounded-full border bg-background px-3 py-1.5 text-center text-sm text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                        {isCoarsePointer() && !canReviewToolbar()
                            ? 'Tap anywhere to pin a comment. Tap + to cancel.'
                            : isCoarsePointer() ? 'Tap anywhere to pin a comment.' : 'Click anywhere to pin a comment. Esc to cancel.'}
                        {canReviewToolbar() && <Button size="sm" variant="plain" className="pointer-events-auto ml-2 rounded-full"
                            onClick={onCancelPointComment}>Cancel</Button>}
                    </p>
                )}
            </div>
            <nav
                id="uier-feedback-toolbar"
                ref={navRef}
                aria-label="uier feedback"
                style={{ ...movement.style, width: 'max-content' }}
                className="fixed z-[51]">
                {/* Collapsed, the pill never overflows: no scroll container, so the unread count is not clipped */}
                <div
                    role="group"
                    aria-label="uier feedback toolbar"
                    className={cx('flex max-w-full items-center rounded-full border bg-background p-1 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]', !collapsed && 'overflow-x-auto')}>
                    {!collapsed && (
                        <IconButton ref={moveRef} variant="plain" className="shrink-0 rounded-full" aria-label="Move toolbar"
                            title="Drag to move. Use arrow keys to move; Home resets position."
                            {...movement.handle} onKeyDown={movement.onKeyDown}><Drag /></IconButton>
                    )}
                    {collapsed ? (
                        // No separate handle: the mark itself drags the pill, a click expands it
                        <IconButton
                            ref={expandButtonRef}
                            variant="plain"
                            className="relative rounded-full"
                            title="Expand toolbar. Drag to move."
                            aria-label={commentsLabel ? `Expand toolbar, ${commentsLabel}` : 'Expand toolbar'}
                            {...movement.handle}
                            style={{ touchAction: 'none', cursor: movement.dragging ? 'grabbing' : undefined }}
                            onKeyDown={movement.onKeyDown}
                            onClick={() => { if (!movement.wasDragged()) handleCollapsedChange(false); }}>
                            <Mark size={20} />
                            {badge}
                        </IconButton>
                    ) : (
                        <Row>
                            <IconButton
                                ref={addButtonRef}
                                title="Add comment"
                                aria-label="Add comment"
                                aria-pressed={creatingPointComment}
                                // Pressed: white on the black pill (21:1), not a faint tint
                                variant={creatingPointComment ? 'solid' : 'plain'}
                                className="rounded-full"
                                onClick={handleAddClick}>
                                <CommentIcon icon="add" size={24} variant="outlined" aria-hidden="true" />
                            </IconButton>
                            <ToolbarFeedback onOpen={onFeedbackOpen} openRequested={feedbackRequested} onOpenRequestHandled={onFeedbackRequestHandled} />
                            <IconButton
                                ref={inboxButtonRef}
                                variant="plain"
                                className="relative rounded-full"
                                aria-expanded={sidebarOpen}
                                onClick={onToggleSidebar}
                                title="Inbox"
                                aria-label={commentsLabel ? `Inbox, ${commentsLabel}` : 'Inbox'}>
                                <Inbox />
                                {badge}
                            </IconButton>
                            <IconButton
                                ref={hintButtonRef}
                                variant={hintOpen ? 'soft' : 'plain'}
                                className="rounded-full"
                                onClick={onToggleHint}
                                title="About uier"
                                aria-label="About uier"
                                aria-expanded={hintOpen}
                                aria-controls={hintOpen ? hintId : undefined}>
                                <Info />
                            </IconButton>
                            <Divider orientation="vertical" className="mx-1 h-6" />
                            <ToolbarProfile />
                            <ToolbarOptions projectUrl={projectUrl} onExitReview={onExitReview} onResetPosition={movement.custom ? resetPosition : undefined} />
                            <IconButton
                                ref={collapseButtonRef}
                                variant="plain"
                                className="rounded-full"
                                title="Collapse toolbar"
                                aria-label="Collapse toolbar"
                                onClick={() => handleCollapsedChange(true)}>
                                <Down />
                            </IconButton>
                        </Row>
                    )}
                </div>
            </nav>
        </InkScope>
    );
}
