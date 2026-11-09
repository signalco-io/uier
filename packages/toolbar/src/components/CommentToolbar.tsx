'use client';

import React, { useContext, Ref, useEffect, useRef, useSyncExternalStore } from 'react';
import { IconTooltip, useIconTooltip } from './IconTooltip';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { Down, Drag, Edit, Inbox, Info } from '@signalco/ui-icons';
import { Mark } from '@uier/brand';
import type { ToolbarMode } from '../config';
import { CommentIcon } from './CommentIcon';
import { InkScope } from './InkScope';
import { ToolbarProfile } from './ToolbarProfile';
import { ToolbarOptions } from './ToolbarOptions';
import { ToolbarFeedback } from './ToolbarFeedback';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { AccessibilityIcon, SeoIcon } from './checks/ChecksIcons';
import type { ChecksPanelId } from './checks/PageChecks';
import { useToolbarMovement, useToolbarNotice } from '../hooks/useReviewMovement';
import { canReviewToolbar, holdsLayersAttribute } from '../toolbarReview';
import { addCommentShortcut, useShortcutsEnabled } from '../shortcuts';
import { useRovingFocus } from '../focusKeys';

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
    /** "About uier" and its hint: uier.io's landing page introduction, nowhere else */
    showAbout?: boolean;
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
    /** A draft pin with text is closed: "Resume draft", above the pill, opens it again */
    onResumeDraft?: () => void;
    /** Whether the inbox sidebar is open (the Inbox button opens and closes it) */
    sidebarOpen?: boolean;
    onToggleSidebar: () => void;
    /** The Accessibility or SEO panel, while one is open (its button opens and closes it) */
    checksPanel?: ChecksPanelId;
    onChecksPanelChange: (panel: ChecksPanelId | undefined) => void;
    /** Whether the accessibility audit can load here (not in packaged clients) */
    accessibilityAvailable?: boolean;
    accessibilityButtonRef?: Ref<HTMLButtonElement>;
    seoButtonRef?: Ref<HTMLButtonElement>;
    /** Options, where the panels' buttons are on a narrow screen */
    optionsButtonRef?: Ref<HTMLButtonElement>;
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
    /** `?` was pressed: Options opens on its keyboard shortcuts */
    shortcutsRequested?: boolean;
    onShortcutsRequestHandled?: () => void;
};

function isCoarsePointer() {
    return window.matchMedia('(pointer: coarse)').matches;
}

/** Room for the panels' buttons in the pill: where panels dock beside the page (`DockablePanel`) */
const roomyQuery = '(min-width: 640px)';
function subscribeRoomy(listener: () => void) {
    const query = window.matchMedia(roomyQuery);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
}
const isRoomy = () => window.matchMedia(roomyQuery).matches;

function countText(count: number, capped: boolean) {
    return capped ? `${count}+` : String(count);
}

export function CommentToolbar({
    mode, creatingPointComment, collapsed, commentsCount = 0, commentsCountCapped = false, hintOpen, showAbout = true, hintId, projectUrl,
    addButtonRef, inboxButtonRef, hintButtonRef, sidebarOpen = false, onAddPointComment, onCancelPointComment, onResumeDraft, onToggleSidebar, onFeedbackOpen,
    checksPanel, onChecksPanelChange, accessibilityAvailable = false, accessibilityButtonRef, seoButtonRef, optionsButtonRef,
    feedbackRequested = false, onFeedbackRequestHandled, onMoveStart, onToggleHint, onCollapsedChange, onExitReview,
    shortcutsRequested = false, onShortcutsRequestHandled
}: CommentToolbarProps) {
    const { path } = useContext(CommentsBootstrapperContext);
    const navRef = useRef<HTMLElement>(null);
    // The pill's buttons are one tab stop (a toolbar): ← and → move between them, Home and End to the first and the last
    const toolsRef = useRef<HTMLDivElement>(null);
    const tools = useRovingFocus(toolsRef, { orientation: 'horizontal' });
    const moveRef = useRef<HTMLButtonElement>(null);
    const movement = useToolbarMovement(navRef, onMoveStart);
    // Centred on the pill, above it (below it when there is no room): never over it
    const instruction = useToolbarNotice<HTMLDivElement>();
    const resumeDraft = useToolbarNotice<HTMLDivElement>();
    const resetPosition = () => { movement.reset(); requestAnimationFrame(() => moveRef.current?.focus()); };
    const shortcut = useShortcutsEnabled() ? addCommentShortcut : undefined;
    // A phone's pill keeps its width: the panels open from Options there
    const roomy = useSyncExternalStore(subscribeRoomy, isRoomy);
    const toggleChecks = (panel: ChecksPanelId) => onChecksPanelChange(checksPanel === panel ? undefined : panel);
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
                ref={instruction.ref}
                role="status"
                style={instruction.style}
                data-uier-capture-exclude=""
                className={cx('pointer-events-none fixed w-max max-w-[calc(100vw-2rem)]', canReviewToolbar() ? 'z-[54]' : 'z-[51]')}>
                {creatingPointComment && (
                    <p className="m-0 rounded-full border bg-background px-3 py-1.5 text-center text-sm text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                        {isCoarsePointer() && !canReviewToolbar()
                            ? 'Tap anywhere to pin a comment. Tap + to cancel.'
                            : isCoarsePointer() ? 'Tap anywhere to pin a comment.' : 'Click anywhere to pin a comment, or drag over an area. Esc to cancel.'}
                        {canReviewToolbar() && <Button size="sm" variant="plain" className="pointer-events-auto ml-2 rounded-full"
                            onClick={onCancelPointComment}>Cancel</Button>}
                    </p>
                )}
            </div>
            {/* Beside the instruction's place, not in the pill: the pill keeps its width */}
            {onResumeDraft && !creatingPointComment && !collapsed && (
                <div
                    ref={resumeDraft.ref}
                    style={resumeDraft.style}
                    data-uier-capture-exclude=""
                    className={cx('fixed w-max', canReviewToolbar() ? 'z-[54]' : 'z-[51]')}>
                    <Button
                        size="sm"
                        variant="outlined"
                        className="rounded-full bg-background text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
                        startDecorator={<Edit size={16} aria-hidden="true" />}
                        onClick={onResumeDraft}>
                        Resume draft
                    </Button>
                </div>
            )}
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
                        <IconTooltip label="Drag to move. Arrow keys move it; Home resets it.">
                            {/* A quiet grip: muted and thinner than the 1.75 stroke (inline, since `svg.lucide` sets it in CSS) until hovered, focused or dragged */}
                            <IconButton ref={moveRef} variant="plain"
                                className={cx('shrink-0 rounded-full hover:text-foreground focus-visible:text-foreground', movement.dragging ? 'text-foreground' : 'text-muted-foreground')}
                                aria-label="Move toolbar"
                                {...movement.handle} onKeyDown={movement.onKeyDown}><Drag style={{ strokeWidth: 1.25 }} /></IconButton>
                        </IconTooltip>
                    )}
                    {collapsed ? (
                        // No separate handle: the mark itself drags the pill, a click expands it
                        <IconTooltip label="Expand toolbar. Drag to move.">
                        <IconButton
                            ref={expandButtonRef}
                            variant="plain"
                            className="relative rounded-full"
                            aria-label={commentsLabel ? `Expand toolbar, ${commentsLabel}` : 'Expand toolbar'}
                            {...movement.handle}
                            style={{ touchAction: 'none', cursor: movement.dragging ? 'grabbing' : undefined }}
                            onKeyDown={movement.onKeyDown}
                            onClick={() => { if (!movement.wasDragged()) handleCollapsedChange(false); }}>
                            <Mark size={20} />
                            {badge}
                        </IconButton>
                        </IconTooltip>
                    ) : (
                        // Beside the move handle, whose arrow keys move the pill
                        <Row ref={toolsRef} role="toolbar" aria-label="Tools" onFocus={tools.onFocus} onKeyDown={tools.onKeyDown}>
                            <IconTooltip label="Add comment" shortcut={shortcut}>
                            <IconButton
                                ref={addButtonRef}
                                aria-label="Add comment"
                                aria-keyshortcuts={shortcut}
                                aria-pressed={creatingPointComment}
                                // On uier's own pages the toolbar's open popovers stay open to be pointed at
                                {...{ [holdsLayersAttribute]: '' }}
                                // Pressed: white on the black pill (21:1), not a faint tint
                                variant={creatingPointComment ? 'solid' : 'plain'}
                                className="rounded-full"
                                onClick={handleAddClick}>
                                <CommentIcon icon="add" size={24} variant="outlined" aria-hidden="true" />
                            </IconButton>
                            </IconTooltip>
                            <ToolbarFeedback key={path} onOpen={onFeedbackOpen} openRequested={feedbackRequested} onOpenRequestHandled={onFeedbackRequestHandled} />
                            <IconTooltip label="Inbox">
                            <IconButton
                                ref={inboxButtonRef}
                                variant="plain"
                                className="relative rounded-full"
                                aria-expanded={sidebarOpen}
                                // The inbox is the `DockablePanel` "inbox"; a comment on it saves this button as its opener
                                aria-controls={sidebarOpen ? 'uier-panel-inbox' : undefined}
                                onClick={onToggleSidebar}
                                aria-label={commentsLabel ? `Inbox, ${commentsLabel}` : 'Inbox'}>
                                <Inbox />
                                {badge}
                            </IconButton>
                            </IconTooltip>
                            {/* The page's checks, docked like the inbox (components/checks/PageChecks.tsx) */}
                            {roomy && accessibilityAvailable && (
                                <IconTooltip label="Accessibility">
                                <IconButton
                                    ref={accessibilityButtonRef}
                                    variant="plain"
                                    className="rounded-full"
                                    aria-label="Accessibility"
                                    aria-expanded={checksPanel === 'accessibility'}
                                    aria-controls={checksPanel === 'accessibility' ? 'uier-panel-accessibility' : undefined}
                                    onClick={() => toggleChecks('accessibility')}>
                                    <AccessibilityIcon />
                                </IconButton>
                                </IconTooltip>
                            )}
                            {roomy && (
                            <IconTooltip label="SEO">
                            <IconButton
                                ref={seoButtonRef}
                                variant="plain"
                                className="rounded-full"
                                aria-label="SEO"
                                aria-expanded={checksPanel === 'seo'}
                                aria-controls={checksPanel === 'seo' ? 'uier-panel-seo' : undefined}
                                onClick={() => toggleChecks('seo')}>
                                <SeoIcon />
                            </IconButton>
                            </IconTooltip>
                            )}
                            {showAbout && (
                                <IconTooltip label="About uier">
                                <IconButton
                                    ref={hintButtonRef}
                                    variant={hintOpen ? 'soft' : 'plain'}
                                    className="rounded-full"
                                    onClick={onToggleHint}
                                    aria-label="About uier"
                                    aria-expanded={hintOpen}
                                    aria-controls={hintOpen ? hintId : undefined}>
                                    <Info />
                                </IconButton>
                                </IconTooltip>
                            )}
                            <Divider orientation="vertical" className="mx-1 h-6" />
                            <ToolbarProfile />
                            <ToolbarOptions projectUrl={projectUrl} onExitReview={onExitReview} onResetPosition={movement.custom ? resetPosition : undefined}
                                triggerRef={optionsButtonRef}
                                pageChecks={roomy ? undefined : { accessibility: accessibilityAvailable, onOpen: onChecksPanelChange }}
                                shortcutsRequested={shortcutsRequested} onShortcutsRequestHandled={onShortcutsRequestHandled} />
                            <IconTooltip label="Collapse toolbar">
                            <IconButton
                                ref={collapseButtonRef}
                                variant="plain"
                                className="rounded-full"
                                aria-label="Collapse toolbar"
                                onClick={() => handleCollapsedChange(true)}>
                                <Down />
                            </IconButton>
                            </IconTooltip>
                        </Row>
                    )}
                </div>
            </nav>
        </InkScope>
    );
}
