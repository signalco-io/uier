'use client';

import React, { useCallback, useContext, Ref, useEffect, useRef, useSyncExternalStore } from 'react';
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
import { DrawIcon } from './canvas/CanvasIcons';
import { InkScope } from './InkScope';
import { ToolbarProfile } from './ToolbarProfile';
import { ToolbarOptions } from './ToolbarOptions';
import { ToolbarFeedback } from './ToolbarFeedback';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { AccessibilityIcon, SeoIcon, ConsentIcon } from './checks/ChecksIcons';
import type { ChecksAttention, ChecksPanelId } from './checks/PageChecks';
import { AttentionDot, checksButtonLabel } from './checks/ChecksAttention';
import { PageChecksMenu } from './checks/PageChecksMenu';
import { useToolbarMovement, useToolbarNotice } from '../hooks/useReviewMovement';
import { canReviewToolbar, holdsLayersAttribute } from '../toolbarReview';
import { addCommentShortcut, useShortcutsEnabled } from '../shortcuts';
import { useRovingFocus } from '../focusKeys';
import { useToolbarFeatures } from '../hooks/useToolbarFeatures';
import { useMessages } from '../i18n';

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
    /** Canvas mode is on (Draw on the page is pressed) */
    drawing?: boolean;
    drawButtonRef?: Ref<HTMLButtonElement>;
    /** Draw on the page: canvas mode (only when the project shows the tool) */
    onDraw?: () => void;
    onCancelPointComment: () => void;
    /** A draft pin with text is closed: "Resume draft", above the pill, opens it again */
    onResumeDraft?: () => void;
    /** Whether the inbox sidebar is open (the Inbox button opens and closes it) */
    sidebarOpen?: boolean;
    onToggleSidebar: () => void;
    /** The open Accessibility and SEO panels (each button opens and closes its own) */
    checksPanels?: readonly ChecksPanelId[];
    onChecksPanelChange: (panel: ChecksPanelId, open: boolean) => void;
    /** Whether the accessibility audit can load here (not in packaged clients) */
    accessibilityAvailable?: boolean;
    /** What the background checks of this page found to act on: a dot on their buttons (Options rows on a narrow screen) */
    checksAttention?: ChecksAttention;
    accessibilityButtonRef?: Ref<HTMLButtonElement>;
    seoButtonRef?: Ref<HTMLButtonElement>;
    consentButtonRef?: Ref<HTMLButtonElement>;
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
    addButtonRef, inboxButtonRef, hintButtonRef, sidebarOpen = false, onAddPointComment, drawing = false, drawButtonRef, onDraw, onCancelPointComment, onResumeDraft, onToggleSidebar, onFeedbackOpen,
    checksPanels = [], onChecksPanelChange, accessibilityAvailable = false, checksAttention, accessibilityButtonRef, seoButtonRef, consentButtonRef, optionsButtonRef,
    feedbackRequested = false, onFeedbackRequestHandled, onMoveStart, onToggleHint, onCollapsedChange, onExitReview,
    shortcutsRequested = false, onShortcutsRequestHandled
}: CommentToolbarProps) {
    const { path } = useContext(CommentsBootstrapperContext);
    const t = useMessages();
    const features = useToolbarFeatures();
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
    const toggleChecks = (panel: ChecksPanelId) => onChecksPanelChange(panel, !checksPanels.includes(panel));
    // The page tools this review shows, in the pill's order
    const checkTools = ([
        accessibilityAvailable && features.includes('accessibility') && 'accessibility',
        features.includes('seo') && 'seo',
        accessibilityAvailable && features.includes('consent') && 'consent'
    ] as const).filter((panel): panel is ChecksPanelId => Boolean(panel));
    // One button opens them all: closing any of their panels gives it the focus back
    const pageChecksButtonRef = useCallback((element: HTMLButtonElement | null) => {
        for (const ref of [accessibilityButtonRef, seoButtonRef, consentButtonRef]) {
            if (typeof ref === 'function') ref(element);
            else if (ref) (ref as { current: HTMLButtonElement | null }).current = element;
        }
    }, [accessibilityButtonRef, seoButtonRef, consentButtonRef]);
    const capped = commentsCountCapped;
    const badgeText = commentsCount > 99 && !capped ? '99+' : countText(commentsCount, capped);
    const commentsLabel = commentsCount ? t.toolbar.unread(badgeText, commentsCount, capped) : undefined;

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
                            ? t.toolbar.pointTouchCancel
                            : isCoarsePointer() ? t.toolbar.pointTouch : t.toolbar.pointMouse}
                        {canReviewToolbar() && <Button size="sm" variant="plain" className="pointer-events-auto ml-2 rounded-full"
                            onClick={onCancelPointComment}>{t.common.cancel}</Button>}
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
                        {t.toolbar.resumeDraft}
                    </Button>
                </div>
            )}
            <nav
                id="uier-feedback-toolbar"
                ref={navRef}
                aria-label={t.toolbar.navLabel}
                style={{ ...movement.style, width: 'max-content' }}
                className="fixed z-[51]">
                {/* Collapsed, the pill never overflows: no scroll container, so the unread count is not clipped */}
                <div
                    role="group"
                    aria-label={t.toolbar.groupLabel}
                    className={cx('flex max-w-full items-center rounded-full border bg-background p-1 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]', !collapsed && 'overflow-x-auto')}>
                    {!collapsed && (
                        <IconTooltip label={t.toolbar.moveTip}>
                            {/* A quiet grip: muted and thinner than the 1.75 stroke (inline, since `svg.lucide` sets it in CSS) until hovered, focused or dragged */}
                            <IconButton ref={moveRef} variant="plain"
                                className={cx('shrink-0 rounded-full hover:text-foreground focus-visible:text-foreground', movement.dragging ? 'text-foreground' : 'text-muted-foreground')}
                                aria-label={t.toolbar.move}
                                {...movement.handle} onKeyDown={movement.onKeyDown}><Drag style={{ strokeWidth: 1.25 }} /></IconButton>
                        </IconTooltip>
                    )}
                    {collapsed ? (
                        // No separate handle: the mark itself drags the pill, a click expands it
                        <IconTooltip label={t.toolbar.expandTip}>
                        <IconButton
                            ref={expandButtonRef}
                            variant="plain"
                            className="relative rounded-full"
                            aria-label={commentsLabel ? t.toolbar.expandWith(commentsLabel) : t.toolbar.expand}
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
                        <Row ref={toolsRef} role="toolbar" aria-label={t.toolbar.tools} onFocus={tools.onFocus} onKeyDown={tools.onKeyDown}>
                            <IconTooltip label={t.toolbar.addComment} shortcut={shortcut}>
                            <IconButton
                                ref={addButtonRef}
                                aria-label={t.toolbar.addComment}
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
                            {onDraw && (
                                <IconTooltip label={t.toolbar.draw}>
                                <IconButton
                                    ref={drawButtonRef}
                                    data-uier-draw-button=""
                                    aria-label={t.toolbar.draw}
                                    aria-pressed={drawing}
                                    // Pressed: white on the black pill, like Add comment in point mode
                                    variant={drawing ? 'solid' : 'plain'}
                                    className="rounded-full"
                                    onClick={onDraw}>
                                    <DrawIcon size={24} />
                                </IconButton>
                                </IconTooltip>
                            )}
                            <ToolbarFeedback key={path} onOpen={onFeedbackOpen} openRequested={feedbackRequested} onOpenRequestHandled={onFeedbackRequestHandled} />
                            <IconTooltip label={t.toolbar.inbox}>
                            <IconButton
                                ref={inboxButtonRef}
                                // Found by this, not by its name (in the toolbar's language)
                                data-uier-inbox-button=""
                                // Highlighted while its panel is open (as are Accessibility and SEO), like About's hint
                                variant={sidebarOpen ? 'soft' : 'plain'}
                                className="relative rounded-full"
                                aria-expanded={sidebarOpen}
                                // The inbox is the `DockablePanel` "inbox"; a comment on it saves this button as its opener
                                aria-controls={sidebarOpen ? 'uier-panel-inbox' : undefined}
                                onClick={onToggleSidebar}
                                aria-label={commentsLabel ? t.toolbar.inboxWith(commentsLabel) : t.toolbar.inbox}>
                                <Inbox />
                                {badge}
                            </IconButton>
                            </IconTooltip>
                            {/* The page's checks, docked like the inbox (components/checks/PageChecks.tsx): behind one Page checks
                                button when there are several (uier #353), else the one tool's own button */}
                            {roomy && checkTools.length > 1 && (
                                <PageChecksMenu tools={checkTools} openPanels={checksPanels} attention={checksAttention}
                                    onToggle={toggleChecks} buttonRef={pageChecksButtonRef} />
                            )}
                            {roomy && checkTools.length === 1 && (
                                <IconTooltip label={t.toolbar[checkTools[0]!]}>
                                <IconButton
                                    ref={pageChecksButtonRef}
                                    variant={checksPanels.includes(checkTools[0]!) ? 'soft' : 'plain'}
                                    className="relative rounded-full"
                                    aria-label={checksButtonLabel(checkTools[0]!, checksAttention)}
                                    aria-expanded={checksPanels.includes(checkTools[0]!)}
                                    aria-controls={checksPanels.includes(checkTools[0]!) ? `uier-panel-${checkTools[0]}` : undefined}
                                    onClick={() => toggleChecks(checkTools[0]!)}>
                                    {checkTools[0] === 'accessibility' ? <AccessibilityIcon /> : checkTools[0] === 'seo' ? <SeoIcon /> : <ConsentIcon />}
                                    <AttentionDot panel={checkTools[0]!} attention={checksAttention} className="absolute right-1.5 top-1.5" />
                                </IconButton>
                                </IconTooltip>
                            )}
                            {showAbout && (
                                <IconTooltip label={t.toolbar.about}>
                                <IconButton
                                    ref={hintButtonRef}
                                    variant={hintOpen ? 'soft' : 'plain'}
                                    className="rounded-full"
                                    onClick={onToggleHint}
                                    aria-label={t.toolbar.about}
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
                                pageChecks={roomy ? undefined : { accessibility: accessibilityAvailable && features.includes('accessibility'), seo: features.includes('seo'), consent: accessibilityAvailable && features.includes('consent'), attention: checksAttention, onOpen: panel => onChecksPanelChange(panel, true) }}
                                shortcutsRequested={shortcutsRequested} onShortcutsRequestHandled={onShortcutsRequestHandled} />
                            <IconTooltip label={t.toolbar.collapse}>
                            <IconButton
                                ref={collapseButtonRef}
                                variant="plain"
                                className="rounded-full"
                                aria-label={t.toolbar.collapse}
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
