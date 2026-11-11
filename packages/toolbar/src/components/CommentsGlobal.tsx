import { useToolbarFeatures } from '../hooks/useToolbarFeatures';
import { ReattachContext, describeAnchor } from './CommentAnchorDetails';
import { messages, useMessages, useToolbarLanguage } from '../i18n';
import { DockablePanel, panelsSideBySideNow, usePanelsSideBySide, usePanelSidesVersion } from './DockablePanel';
import { CommentsApiError } from '../hooks/api';
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { anchorSelector } from '../anchorSelector';
import { closeToolbarLayers, toolbarReviewTarget, watchToolbarPresses } from '../toolbarReview';
import { Button } from '@signalco/ui-primitives/Button';
import { commentKey, useComments, useSiteComments, useCommentsRefresh, useActivitySummary } from '../hooks/useComments';
import { newCommentDraftKey, newDrawingDraftKey, newRewriteDraftKey, useDrafts } from '../hooks/useDrafts';
import { CanvasMode } from './canvas/CanvasMode';
import { finishDrawing, frameOf, shapesInFrame, type CanvasFrame } from '../canvas/finish';
import type { CommentDrawing, DrawingShape } from '../drawing';
import { getCommentPlacement, resolveAnchorElement, selectionTextMaxLength, textOffsetWithin, useCommentItemRects } from '../hooks/useCommentItemRects';
import { CommentsSidebar } from './sidebar/CommentsSidebar';
import { PageChecks, type ChecksAttention, type ChecksPanelId, type ShownComment } from './checks/PageChecks';
import { auditAvailable } from '../checks/axeLoader';
import { CommentToolbar } from './CommentToolbar';
import { CommentSelectionPopover } from './CommentSelectionPopover';
import { CommentSelectionHighlight } from './CommentSelectionHighlight';
import { CommentAreaHighlight } from './CommentAreaHighlight';
import { CommentPointOverlay } from './CommentPointOverlay';
import { CommentBubble } from './CommentBubble';
import { InlineCommentThreads } from './InlineCommentThread';
import { CommentErrorBoundary } from './CommentErrorBoundary';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useToolbarNotice } from '../hooks/useReviewMovement';
import { InkScope } from './InkScope';
import { Toaster } from './Toaster';
import { useAnnounce } from './Announcer';
import { isShowcaseHintDismissed, rememberShowcaseHintDismissed, ShowcaseHint } from './ShowcaseHint';
import { toolbarConfig } from '../config';
import { usePagePath } from '../hooks/usePagePath';
import { takeLinkedCommentId } from '../review';
import { PanelSwitchContext } from './PanelTitle';
import { fitPanels, readInboxFilter, readOpenPanels, rememberInboxFilter, rememberOpenPanels, RestoredPanelContext, type DockPanelId } from '../openPanel';
import { openFeedbackEvent, startCommentEvent, takeToolbarRequest } from '../openFeedback';
import { captureCommentScreenshot } from '../screenshot';
import { activeModalDialog, isInActiveModal, listenToWindowKeydown } from '../modalLayer';
import { withLayer } from '../layerAnchor';
import { getDeviceInfo } from './info/getDeviceInfo';
import { isAddCommentShortcut, isLetterKeyTarget, useShortcutsEnabled } from '../shortcuts';
import { isSearchKey, isShortcutsHelpKey, sequenceTimeoutMs, shortcutLetter } from '../keyboard';
import { actOnThread, shortcutThread } from '../threadShortcuts';
import type { CommentsFilter, CommentsStatusFilter } from './sidebar/CommentsFilter';
import { CommentAnchor, CommentsGlobalProps, CommentSelection, CommentPoint, CommentDraft, CommentItem, commentTextMaxLength, isCommentArea } from './@types/Comments';

/** Whether the node is in the toolbar's shadow root (or is its host) */
function isToolbarNode(node: Node | null | undefined, rootElement: HTMLElement | undefined) {
    const rootNode = rootElement?.getRootNode();
    if (!node || !(rootNode instanceof ShadowRoot)) {
        return false;
    }

    const nodeRoot = node.getRootNode();
    return nodeRoot === rootNode || node === rootNode.host || rootNode.host.contains(node)
        || (nodeRoot instanceof ShadowRoot && nodeRoot.host.hasAttribute('data-uier-thread'));
}

/** The draft a new comment's text is kept in: a comment's, a rewrite's or a drawing's */
function draftKeyOf(kind: CommentDraft['kind']) {
    return kind === 'rewrite' ? newRewriteDraftKey : kind === 'drawing' ? newDrawingDraftKey : newCommentDraftKey;
}

/** A point comment in the middle of the element, for comments created with the keyboard */
function centerPoint(element: Element): CommentPoint {
    return {
        type: 'point',
        selector: anchorSelector(element),
        xNormal: 0.5,
        yNormal: 0.5
    };
}

/** Pins in page order (the order the anchors appear in the document), so Tab follows the page */
function sortByDocumentPosition(comments: CommentItem[]) {
    const anchors = new Map(comments.map(c => [c.id, resolveAnchorElement(c.position)]));
    return [...comments].sort((a, b) => {
        const anchorA = anchors.get(a.id);
        const anchorB = anchors.get(b.id);
        if (!anchorA || !anchorB || anchorA === anchorB) {
            return (anchorA ? 0 : 1) - (anchorB ? 0 : 1);
        }
        return anchorA.compareDocumentPosition(anchorB) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
}

const collapsedStorageKey = 'uier:toolbar-collapsed';

/** Whether the visitor collapsed the toolbar earlier in this tab (storage can be unavailable) */
function readCollapsed() {
    try {
        return window.sessionStorage.getItem(collapsedStorageKey) === 'true';
    } catch {
        return false;
    }
}

function rememberCollapsed(collapsed: boolean) {
    try {
        if (collapsed) {
            window.sessionStorage.setItem(collapsedStorageKey, 'true');
        } else {
            window.sessionStorage.removeItem(collapsedStorageKey);
        }
    } catch {
        // Not remembered, the toolbar is expanded on the next page
    }
}

type CommentDraftState = CommentDraft & {
    /** New for every draft, so a new draft opens its popover again */
    key: number;
    initiallyClosed?: boolean;
    /**
     * Sent as this comment (its temporary id): the draft stays on the page until the comment's pin
     * is there, in the same render, so a popover is always open (`handleCreated`)
     */
    sentAs?: string;
};

export function CommentsGlobal({
    mode,
    review,
    rootElement,
    onExitReview
}: CommentsGlobalProps) {
    const features = useToolbarFeatures();
    const drafts = useDrafts();
    const [creatingCommentSelection, setCreatingCommentSelection] = useState<CommentSelection>();
    const restorePageDrafts = () =>
        [newCommentDraftKey, newRewriteDraftKey].map(key => drafts.details(key))
            .filter(value => value?.text.trim() && value.anchor)
            .sort((a, b) => b!.updatedAt - a!.updatedAt)
            .map((saved, index) => ({ ...saved!.anchor!, key: -index, initiallyClosed: true }));
    const [creatingComments, setCreatingComments] = useState<CommentDraftState[]>(restorePageDrafts);
    const setCreatingComment = (draft: CommentDraftState) => setCreatingComments(current =>
        [...current.filter(other => other.kind !== draft.kind), draft]);
    const removeCreatingComment = (key: number) => setCreatingComments(current => current.filter(draft => draft.key !== key));
    useEffect(() => {
        // A send can finish after navigating away and back, or in another composer instance.
        const watch = (key: string, kind: CommentDraft['kind']) => drafts.subscribe(key, () => {
            if (!drafts.details(key)) setCreatingComments(current => current.filter(draft => draft.kind !== kind));
        });
        const stopComment = watch(newCommentDraftKey, 'comment');
        const stopRewrite = watch(newRewriteDraftKey, 'rewrite');
        const stopDrawing = watch(newDrawingDraftKey, 'drawing');
        return () => { stopComment(); stopRewrite(); stopDrawing(); };
    }, [drafts]);
    // Draft pins whose composer is open; a closed one is offered as "Resume draft" in the toolbar
    const [openDrafts, setOpenDrafts] = useState<ReadonlySet<string>>(() => new Set());
    const handleDraftOpenState = useCallback((key: string, open: boolean) => setOpenDrafts(current => {
        if (current.has(key) === open) return current;
        const next = new Set(current);
        if (open) next.add(key); else next.delete(key);
        return next;
    }), []);
    // The draft "Resume draft" reopens (its `key`), scrolled into view first when its pin is off-screen
    const [resumingDraft, setResumingDraft] = useState<number>();
    const handleDraftResumed = useCallback(() => setResumingDraft(undefined), []);
    const [activeThreads, setActiveThreads] = useState<ReadonlySet<string>>(() => new Set());
    // A comment just sent (its temporary id): its thread opens in place of the draft's popover (see `handleCreated`)
    const [continuedThread, setContinuedThread] = useState<string>();
    const handleThreadOpenState = useCallback((id: string, open: boolean) => {
        // Its pin is on the page: the draft it was sent from goes. Opened: later mounts of its pin
        // (after collapsing the toolbar) start closed as usual.
        setCreatingComments(current => current.some(draft => draft.sentAs === id) ? current.filter(draft => draft.sentAs !== id) : current);
        if (open) setContinuedThread(current => current === id ? undefined : current);
        setActiveThreads(current => {
            if (current.has(id) === open) return current;
            const next = new Set(current);
            if (open) next.add(id); else next.delete(id);
            return next;
        });
    }, []);
    // What `feedback` mode mounted for: the feedback form, or a new comment (`startCommentEvent`)
    const [mountRequest] = useState(takeToolbarRequest);
    // The panels open on the previous page stay open on this one (client-side navigation or a full load)
    const [restoredPanels, setRestoredPanels] = useState<readonly DockPanelId[]>(() => mountRequest ? [] : fitPanels(readOpenPanels()
        .filter(panel => panel === 'inbox' || (features.includes(panel) && (panel !== 'accessibility' || auditAvailable()))), panelsSideBySideNow()));
    // The open docked panels (the inbox, the Accessibility and SEO panels), oldest first: one on each
    // side where two fit side by side, else one (`fitPanels`). Opening one closes only the one on its side.
    const [openPanels, setOpenPanels] = useState<readonly DockPanelId[]>(restoredPanels);
    const sideBySide = usePanelsSideBySide();
    const sideBySideRef = useRef(sideBySide);
    sideBySideRef.current = sideBySide;
    const showPanel = useCallback((panel: DockPanelId, open: boolean) => setOpenPanels(current => open
        ? fitPanels([...current.filter(other => other !== panel), panel], sideBySideRef.current)
        : current.includes(panel) ? current.filter(other => other !== panel) : current), []);
    // Narrower, where two no longer fit, the newest stays
    const sidesVersion = usePanelSidesVersion();
    useEffect(() => setOpenPanels(current => fitPanels(current, sideBySide)), [sideBySide, sidesVersion]);
    const sidebarOpen = openPanels.includes('inbox');
    const setSidebarOpen = useCallback((open: boolean) => showPanel('inbox', open), [showPanel]);
    const checksPanels = useMemo(() => openPanels.filter((panel): panel is ChecksPanelId => panel !== 'inbox'), [openPanels]);
    useEffect(() => {
        const hidden = checksPanels.filter(panel => !features.includes(panel));
        if (hidden.length) setOpenPanels(current => current.filter(panel => !hidden.includes(panel as ChecksPanelId)));
    }, [checksPanels, features]);
    // What the checks of this page (run in the background) found to act on: a dot on their buttons
    const [checksAttention, setChecksAttention] = useState<ChecksAttention>({});
    // The page asked to give feedback (`openFeedbackEvent`, or `feedback` mode mounting for it)
    const [feedbackRequested, setFeedbackRequested] = useState(mountRequest === 'feedback');
    const [collapsed, setCollapsed] = useState(() => !mountRequest && readCollapsed());
    const [hintOpen, setHintOpen] = useState(() => !mountRequest && !restoredPanels.length && mode !== 'feedback' && !isShowcaseHintDismissed());
    // "About uier" and its hint introduce uier on uier.io's landing page (the showcase without a
    // project); its other pages, its app, reviews and embeds do without them
    const pagePath = usePagePath();
    const showAbout = mode === 'showcase' && !toolbarConfig.project && pagePath.split(/[?#]/)[0] === '/';
    // The thread to open once its pin is on the page: a comment that was just posted, the one a
    // comment link (`?uier-comment=`) points at, or "Show on page" in the inbox (`fromInbox`)
    // `reading`: J or K went to it, so its messages take the focus instead of its reply box
    const [openComment, setOpenComment] = useState<{ id: string; fromInbox?: boolean; reading?: boolean }>();
    const openCommentId = openComment?.id;
    const [linkedCommentId, setLinkedCommentId] = useState(takeLinkedCommentId);
    const linkHandledRef = useRef(false);
    // The inbox's status and search, kept while it is closed and on the next page
    const [sidebarFilter, setSidebarFilter] = useState<CommentsFilter>(() => readInboxFilter() ?? { status: 'unresolved' });
    useEffect(() => rememberInboxFilter(sidebarFilter), [sidebarFilter]);
    const announce = useAnnounce();
    const t = useMessages();
    // The page checks' reports are written in a language: a new one checks the page again
    const language = useToolbarLanguage();
    const hintId = useId();
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const inboxButtonRef = useRef<HTMLButtonElement>(null);
    const hintButtonRef = useRef<HTMLButtonElement>(null);
    const accessibilityButtonRef = useRef<HTMLButtonElement>(null);
    const seoButtonRef = useRef<HTMLButtonElement>(null);
    const optionsButtonRef = useRef<HTMLButtonElement>(null);
    const draftKeyRef = useRef(0);
    // The last focused review target, for comments created with the keyboard.
    const lastPageFocusRef = useRef<Element | null>(null);

    const { path, query: commentItems, reattach } = useComments(true);
    const [reattaching, setReattaching] = useState<{ comment: CommentItem; candidate?: CommentAnchor; mode?: 'point' | 'text' }>();
    const requestReattach = (comment: CommentItem) => {
        if (comment.path !== path || !(comment.permissions?.edit ?? comment.isMine)) return;
        handleCollapsedChange(false);
        reattach.reset();
        setCreatingCommentPoint(false);
        setCreatingCommentSelection(undefined);
        setOpenComment(undefined);
        setSidebarOpen(false);
        setReattaching({ comment });
    };
    const finishReattach = () => {
        setReattaching(undefined);
        setCreatingCommentSelection(undefined);
        setSidebarOpen(true);
    };
    // While the menu, popover or dialog it is in is open: its opener is saved with it (layerAnchor.ts)
    const chooseAnchor = (anchor: CommentAnchor, element?: Element) => {
        const candidate = withLayer(anchor, element);
        setReattaching(current => current ? { ...current, candidate, mode: undefined } : current);
    };
    const saveAnchor = async () => {
        if (!reattaching?.candidate) return;
        try {
            await reattach.mutateAsync({ commentId: reattaching.comment.id, path, position: reattaching.candidate,
                expectedRevision: reattaching.comment.anchorContext?.revision ?? null });
            announce(messages().page.reattached);
            finishReattach();
        } catch (error) {
            if (error instanceof CommentsApiError && [401, 403, 404].includes(error.status)) {
                announce(messages().page.noLongerEditable);
                finishReattach();
            }
        }
    };
    useCommentsRefresh(!collapsed);
    const activityQuery = useActivitySummary();
    const allComments = commentItems.data;
    // Old routing settings must not move a thread onto a different view. A direct link can still show its saved details.
    const linkedSite = useSiteComments(Boolean(linkedCommentId && commentItems.isSuccess && !allComments?.some(comment => comment.id === linkedCommentId)));
    // Keep a reply being written if another reviewer resolves the thread during refresh.
    // Its draft stays attached to the same stable component and receives the new Done status.
    const pinnedComments = useMemo(
        () => sortByDocumentPosition((allComments ?? []).filter(comment =>
            !comment.archivedAt && comment.position.type !== 'page' && (!comment.resolved || (activeThreads.has(comment.id) && Boolean(drafts.get(comment.id)))))),
        [allComments, drafts, activeThreads]);
    // The API lists at most this many comments; the page can have more

    const [creatingCommentPoint, setCreatingCommentPoint] = useState(mountRequest === 'comment');
    const shortcutsEnabled = useShortcutsEnabled();
    // Canvas mode (docs/canvas-mode.md): drawing on the page, then one comment with the drawing.
    // `initialShapes`: a drawing's draft drawn on again (Edit drawing), on the content of `initialFrame`.
    const [canvas, setCanvas] = useState<{ key: number; initialShapes?: DrawingShape[]; initialFrame?: CanvasFrame }>();
    const drawButtonRef = useRef<HTMLButtonElement>(null);

    /** The visitor found the feature: the first-run hint is not needed anymore */
    const closeHintForUse = () => {
        if (showAbout) rememberShowcaseHintDismissed();
        setHintOpen(false);
    };

    const startDraft = (anchor: CommentDraft['position'], kind: CommentDraft['kind'] = 'comment', element?: Element, drawing?: CommentDrawing) => {
        if (kind === 'rewrite' && !features.includes('rewrite')) return;
        if (kind === 'drawing' && (!features.includes('draw') || !drawing)) return;
        // While the menu, popover or dialog it is in is open: its opener is saved with it (layerAnchor.ts)
        const position = withLayer(anchor, element);
        // On uier's own pages the toolbar's popovers stayed open while pointing: those the comment is not on close
        closeToolbarLayers(element ?? resolveAnchorElement(position));
        closeHintForUse();
        draftKeyRef.current += 1;
        const draftKey = draftKeyOf(kind);
        const existing = drafts.details(draftKey);
        // A drawing is new every time: text kept from an earlier one stays with it
        if (kind !== 'drawing' && existing?.text.trim() && existing.anchor) {
            setCreatingComment({ ...existing.anchor, key: draftKeyRef.current });
            return;
        }
        drafts.setDetails(draftKey, { anchor: { kind, position } });
        // A rewrite starts from the selected text (when it fits a comment's length)
        if (kind === 'rewrite' && position.type === 'text') {
            drafts.set(newRewriteDraftKey, position.text.length <= commentTextMaxLength ? position.text : '');
        }
        setCreatingComment({
            key: draftKeyRef.current,
            position,
            kind,
            ...(drawing ? { drawing } : {}),
            device: getDeviceInfo(),
            screenshot: captureCommentScreenshot(position, rootElement, drawing)
        });
    };

    /**
     * A drawing's draft drawn on again: canvas mode with its shapes, on the content of the scroll container
     * its area is in (so they scroll with it); the draft's text stays for the comment. `false` when its area
     * is not on the page as it was drawn (missing, or in a closed menu, popover or dialog).
     */
    const resumeDrawing = (draft: CommentDraftState) => {
        if (!draft.drawing || draft.position.type !== 'point') return false;
        const placement = getCommentPlacement(draft.position);
        const area = placement.state === 'exact' ? placement.rects[0] : undefined;
        if (!area) return false;
        const frame = frameOf(resolveAnchorElement(draft.position));
        removeCreatingComment(draft.key);
        draftKeyRef.current += 1;
        setCanvas({ key: draftKeyRef.current, initialShapes: shapesInFrame(draft.drawing, area, frame), initialFrame: frame });
        return true;
    };

    /** Draw on the page (the pill's button): canvas mode starts; pressed again with nothing drawn, it ends */
    const toggleCanvas = () => {
        if (reattaching || !features.includes('draw')) return;
        if (canvas) {
            // With shapes drawn, the panel's Discard or Comment ends it: the drawing is never lost by a second press
            const panel = rootElement?.getRootNode();
            const comment = panel instanceof ShadowRoot ? panel.querySelector<HTMLElement>('[data-uier-canvas-comment]') : null;
            if (comment && !(comment as HTMLButtonElement).disabled) comment.focus();
            else setCanvas(undefined);
            return;
        }
        closeHintForUse();
        setCreatingCommentPoint(false);
        setCreatingCommentSelection(undefined);
        window.getSelection()?.removeAllRanges();
        setOpenComment(undefined);
        // One session, one comment: an unsent drawing's comment is drawn on again, never replaced by a new one.
        // Its area off the page: its form opens instead, like Resume draft.
        const unsent = creatingComments.find(draft => draft.kind === 'drawing' && draft.drawing && !draft.sentAs);
        if (unsent && !resumeDrawing(unsent)) {
            draftKeyRef.current += 1;
            setCreatingComment({ kind: unsent.kind, position: unsent.position, drawing: unsent.drawing, key: draftKeyRef.current, initiallyClosed: true });
            setResumingDraft(draftKeyRef.current);
            return;
        }
        if (unsent) return;
        draftKeyRef.current += 1;
        setCanvas({ key: draftKeyRef.current });
    };
    const discardCanvas = () => {
        setCanvas(undefined);
        drawButtonRef.current?.focus();
    };
    /** Comment in canvas mode: the drawing becomes a draft comment on its area, its form open */
    const commentOnDrawing = (shapes: DrawingShape[], frame: CanvasFrame) => {
        const finished = finishDrawing(shapes, frame);
        if (typeof finished === 'string') return finished;
        setCanvas(undefined);
        startDraft(finished.position, 'drawing', finished.element, finished.drawing);
    };

    /** Keyboard path: pin a new comment to the focused page element (or the main content) */
    const startDraftOnFocusedElement = (element?: Element | null) => {
        const modal = activeModalDialog();
        const target = element?.isConnected && element !== document.body && element !== document.documentElement && isInActiveModal(element)
            ? element
            : modal ?? document.querySelector('main') ?? document.body;
        setCreatingCommentPoint(false);
        startDraft(centerPoint(target), 'comment', target);
    };

    const handleDismissHint = (hadFocus: boolean) => {
        rememberShowcaseHintDismissed();
        setHintOpen(false);
        // Keep the keyboard focus in the toolbar
        if (hadFocus) {
            hintButtonRef.current?.focus();
        }
    };

    const handleFeedbackRequest = useEffectEvent(() => {
        closeHintForUse();
        if (collapsed) {
            handleCollapsedChange(false);
        }
        setFeedbackRequested(true);
    });
    // The page asked to comment (`startUierComment()`, the app's C): what the + button or C starts,
    // a comment on the page text selected, else point mode (started, never ended, by a repeat)
    const handleCommentRequest = useEffectEvent(() => {
        if (reattaching || canvas) return;
        closeHintForUse();
        if (collapsed) {
            handleCollapsedChange(false);
        }
        if (creatingCommentSelection) {
            handleCreateComment('comment');
            return;
        }
        setCreatingCommentPoint(true);
    });
    useEffect(() => {
        const feedback = () => handleFeedbackRequest();
        const comment = () => handleCommentRequest();
        window.addEventListener(openFeedbackEvent, feedback);
        window.addEventListener(startCommentEvent, comment);
        return () => {
            window.removeEventListener(openFeedbackEvent, feedback);
            window.removeEventListener(startCommentEvent, comment);
        };
    }, []);

    // On uier's own pages: what a touch pressed, for the toolbar popovers that stay open (toolbarReview.ts)
    useEffect(() => watchToolbarPresses(), []);

    useEffect(() => {
        const trackFocus = (event: Event) => {
            const target = event.composedPath()[0];
            if (target instanceof Element && target !== addButtonRef.current
                && (!isToolbarNode(target, rootElement) || toolbarReviewTarget(target))) {
                lastPageFocusRef.current = target;
            }
        };
        const root = rootElement?.getRootNode();
        document.addEventListener('focusin', trackFocus);
        // Focus changes within one shadow tree are not reported to the document.
        root?.addEventListener('focusin', trackFocus);
        return () => {
            document.removeEventListener('focusin', trackFocus);
            root?.removeEventListener('focusin', trackFocus);
        };
    }, [rootElement]);

    // Also the review layer's own Escape while its host is in the page's menu or dialog (modalLayer.ts)
    const handleEscape = useEffectEvent((event: KeyboardEvent) => {
        if (event.key !== 'Escape') {
            return;
        }

        if (reattaching && !reattach.isPending) {
            event.stopPropagation(); event.preventDefault(); finishReattach(); return;
        }
        if (creatingCommentSelection || creatingCommentPoint) {
            event.stopPropagation();
            event.preventDefault();
            setCreatingCommentPoint(false);
            setCreatingCommentSelection(undefined);
            return;
        }

        // Escape on the pill closes the hint as well (the hint handles its own Escape)
        if (hintOpen && showAbout && isToolbarNode(document.activeElement, rootElement)) {
            handleDismissHint(false);
        }
    });
    useEffect(() => listenToWindowKeydown(event => handleEscape(event)), []);

    // In point mode, Enter on a focused page element pins the comment to it (instead of e.g.
    // following the link). Capture phase, so the page does not handle the key first.
    useEffect(() => {
        if (!creatingCommentPoint && reattaching?.mode !== 'point') {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            // Inbox controls handle Escape themselves; placement must cancel before that.
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (reattaching) finishReattach();
                else setCreatingCommentPoint(false);
                addButtonRef.current?.focus();
                return;
            }
            if (event.key !== 'Enter' || event.isComposing) {
                return;
            }
            const target = event.composedPath()[0];
            const active = target instanceof Element ? target : document.activeElement;
            if (isToolbarNode(active, rootElement) && (!toolbarReviewTarget(active) || active === addButtonRef.current)) {
                // The toolbar's own buttons handle Enter (Add comment pins to the last page focus)
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (reattaching?.mode === 'point') {
                if (active && active !== document.body && active !== document.documentElement) chooseAnchor(centerPoint(active), active);
            } else startDraftOnFocusedElement(active);
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    });

    // `?` and the keys that open the inbox or its search
    const [shortcutsRequested, setShortcutsRequested] = useState(false);
    const [inboxFocus, setInboxFocus] = useState<{ target: 'inbox' | 'search'; key: number }>();
    // When G was pressed: I soon after opens the inbox
    const goPressedRef = useRef(0);
    const openInbox = (target: 'inbox' | 'search') => {
        setHintOpen(false);
        setSidebarOpen(true);
        setInboxFocus({ target, key: Date.now() });
    };
    /** J and K: the next or the previous card in the open inbox, else the next or the previous pin's thread, in page order */
    const moveThread = (step: 1 | -1) => {
        const root = rootElement?.getRootNode();
        if (!(root instanceof ShadowRoot)) return false;
        if (sidebarOpen) {
            const cards = [...root.querySelectorAll<HTMLElement>('#uier-panel-inbox [data-uier-thread-scope]')];
            const from = cards.findIndex(card => card.contains(root.activeElement));
            const next = from < 0 ? cards.at(step > 0 ? 0 : -1) : cards[from + step];
            next?.focus({ preventScroll: true });
            next?.scrollIntoView({ block: 'nearest' });
            return cards.length > 0;
        }
        const from = pinnedComments.findIndex(comment => activeThreads.has(comment.id));
        const next = from < 0 ? pinnedComments.at(step > 0 ? 0 : -1) : pinnedComments[from + step];
        if (next) setOpenComment({ id: next.id, reading: true });
        return pinnedComments.length > 0;
    };

    // C (`shortcuts.ts`): point mode starts or ends, like the + button with a pointer; with page text
    // selected, the selection gets the comment. `?` lists the shortcuts (Options), G then I opens the
    // inbox and `/` its search, J and K go from thread to thread, and R, S and A reply, go to Mark as
    // done and assign in the thread with the focus (or the one open). Bubble phase, so the page's own
    // handling of the key (`preventDefault`) wins. The toolbar's dialogs (options, feedback, an expanded form) keep their
    // keys; a thread's popover keeps C, but the thread keys work in it.
    const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
        // Canvas mode has its own keys (the tools' letters)
        if (reattaching || canvas || isLetterKeyTarget(event)) {
            return;
        }
        const target = event.composedPath()[0];
        const element = target instanceof Element ? target : undefined;
        const inDialog = Boolean(element && isToolbarNode(element, rootElement) && element.closest('[role="dialog"], [role="alertdialog"], dialog'));
        if (isAddCommentShortcut(event)) {
            if (inDialog) return;
            event.preventDefault();
            if (creatingCommentSelection) {
                handleCreateComment('comment');
                return;
            }
            closeHintForUse();
            setCreatingCommentPoint(current => !current);
            return;
        }
        if (creatingCommentPoint || (inDialog && !element?.closest('[data-uier-thread-scope]'))) return;
        if (isShortcutsHelpKey(event)) {
            event.preventDefault();
            setShortcutsRequested(true);
            return;
        }
        if (isSearchKey(event)) {
            event.preventDefault();
            openInbox('search');
            return;
        }
        const letter = shortcutLetter(event);
        if (!letter) return;
        const goPressed = goPressedRef.current;
        goPressedRef.current = 0;
        if (letter === 'i' && goPressed && Date.now() - goPressed <= sequenceTimeoutMs) {
            event.preventDefault();
            openInbox('inbox');
        } else if (letter === 'g') {
            event.preventDefault();
            goPressedRef.current = Date.now();
        } else if (letter === 'j' || letter === 'k') {
            if (moveThread(letter === 'j' ? 1 : -1)) event.preventDefault();
        } else if (letter === 'r' || letter === 's' || letter === 'a') {
            const root = rootElement?.getRootNode();
            const thread = root instanceof ShadowRoot ? shortcutThread(root) : undefined;
            if (thread && actOnThread(thread, letter)) event.preventDefault();
        }
    });
    useEffect(() => {
        if (collapsed || !shortcutsEnabled) {
            return;
        }
        return listenToWindowKeydown(event => handleShortcut(event));
    }, [collapsed, shortcutsEnabled]);

    const handleSelectionChange = useEffectEvent(() => {
        // A collapsed toolbar leaves normal page selection alone, without review controls.
        if (collapsed) {
            return;
        }

        // Ignore if selection is empty or no selection in document
        const selection = window.getSelection();
        const text = selection?.toString();
        if (!selection || !text?.trim().length) {
            setCreatingCommentSelection(undefined);
            return;
        }

        // Text selected in the toolbar itself
        if (isToolbarNode(selection.anchorNode, rootElement) || isToolbarNode(selection.focusNode, rootElement)) {
            return;
        }

        // A boundary in a text node is stored as a character offset in all the text of its
        // element, so it is found again even when it is not the element's first text node
        const boundary = (node: Node | null, offset: number) => {
            const element = node instanceof Element ? node : node?.parentElement;
            const isText = node?.nodeType === Node.TEXT_NODE;
            return {
                selector: anchorSelector(element),
                offset: isText && element && node ? textOffsetWithin(element, node, offset) : offset,
                type: isText ? 'text' as const : 'element' as const
            };
        };
        const start = boundary(selection.anchorNode, selection.anchorOffset);
        const end = boundary(selection.focusNode, selection.focusOffset);

        closeHintForUse();
        const position: CommentSelection = {
            text: text.slice(0, selectionTextMaxLength),
            type: 'text',
            startSelector: start.selector,
            startOffset: start.offset,
            startType: start.type,
            endSelector: end.selector,
            endOffset: end.offset,
            endType: end.type
        };
        if (reattaching) {
            if (reattaching.mode === 'text') setReattaching({ ...reattaching, candidate: position });
            return;
        }
        setCreatingCommentSelection(position);
    });

    useEffect(() => {
        const onSelectionChange = () => handleSelectionChange();
        document.addEventListener('selectionchange', onSelectionChange);
        return () => document.removeEventListener('selectionchange', onSelectionChange);
    }, []);

    const creatingSelectionRects = useCommentItemRects(creatingCommentSelection);

    const handleCreateComment = (kind: CommentDraft['kind']) => {
        if (!creatingCommentSelection) {
            return;
        }

        const position = creatingCommentSelection;
        setCreatingCommentSelection(undefined);
        startDraft(position, kind);
    };

    const handleCreateCommentPoint = (commentPoint: CommentPoint, element: Element) => {
        setCreatingCommentPoint(false);
        startDraft(commentPoint, 'comment', element);
    };

    const handleAddPointComment = (fromKeyboard: boolean) => {
        if (reattaching || canvas) return;
        if (fromKeyboard) {
            // Point mode needs a pointer; with the keyboard the comment goes on the element
            // that had the focus before the toolbar
            startDraftOnFocusedElement(lastPageFocusRef.current);
            return;
        }

        closeHintForUse();
        setCreatingCommentPoint((curr) => !curr);
    };

    /** Opens the inbox on the status of a comment it should show (and without a search that could hide it) */
    const showInSidebar = (status: CommentsStatusFilter) => {
        setSidebarFilter({ status });
        setSidebarOpen(true);
    };

    // The latest closed draft pin with text (a closed draft pin always has text)
    const resumableDraft = creatingComments
        .filter(draft => (draft.kind !== 'rewrite' || features.includes('rewrite')) && (draft.kind !== 'drawing' || features.includes('draw')) && !openDrafts.has(draftKeyOf(draft.kind)) && drafts.get(draftKeyOf(draft.kind))?.trim())
        .sort((a, b) => (drafts.details(draftKeyOf(b.kind))?.updatedAt ?? 0) - (drafts.details(draftKeyOf(a.kind))?.updatedAt ?? 0))[0];
    const resumeDraft = () => {
        if (!resumableDraft) return;
        closeHintForUse();
        setCreatingCommentPoint(false);
        setCreatingCommentSelection(undefined);
        draftKeyRef.current += 1;
        // Like reopening its pin: a new capture, then the composer with the text
        setCreatingComment({ kind: resumableDraft.kind, position: resumableDraft.position, drawing: resumableDraft.drawing, key: draftKeyRef.current, initiallyClosed: true });
        setResumingDraft(draftKeyRef.current);
    };

    // A posted comment's pin is there at once, and its thread is open in place of the draft's popover
    // (one popover, never closing and opening again): its reply box waits until it is saved. The
    // comment comes into the list a moment later (the query cache notifies in a later task), so the
    // draft stays until then (`sentAs`, see `shownCreatingComments`).
    const handleCreated = (localId: string, draftKey: number) => {
        setCreatingComments(current => current.map(draft => draft.key === draftKey ? { ...draft, sentAs: localId } : draft));
        setContinuedThread(localId);
    };
    // It was not posted: the draft, with its text back, is on the page again. One started meanwhile
    // stays as it is, with its own image and screenshot choice; the text is back in it.
    const restoreCreatingComment = (kind: CommentDraft['kind'], sendError: unknown, choice: Pick<CommentDraft, 'omitScreenshot' | 'image' | 'drawing'>) => {
        // The draft it was sent from has nothing to show any more
        setCreatingComments(current => current.filter(other => !other.sentAs));
        const saved = drafts.details(draftKeyOf(kind));
        if (!saved?.text.trim() || !saved.anchor) return;
        draftKeyRef.current += 1;
        const restored = { ...saved.anchor, key: draftKeyRef.current, sendError, ...choice };
        setCreatingComments(current => current.some(other => other.kind === kind) ? current : [...current, restored]);
    };
    const handleAutoOpened = useCallback(() => setOpenComment(undefined), []);
    // Each layer a pin opens on its way (a thread, a menu) gives its thread another second to open
    const [autoOpenStep, setAutoOpenStep] = useState(0);
    const handleAutoOpenStep = useCallback(() => setAutoOpenStep(step => step + 1), []);
    const handleShortcutsRequestHandled = useCallback(() => setShortcutsRequested(false), []);

    // A comment link opens the thread on its pin; done threads and feedback have no pin, the
    // inbox shows them
    useEffect(() => {
        if (!linkedCommentId || linkHandledRef.current || !allComments) {
            return;
        }
        const linked = allComments.find(c => c.id === linkedCommentId) ?? linkedSite.data?.find(c => c.id === linkedCommentId);
        if (!linked) {
            if (linkedSite.isSuccess) linkHandledRef.current = true;
            return;
        }
        linkHandledRef.current = true;
        if (linked.path !== path) {
            // Not this page's (any more): all pages, narrowed to its public id
            setSidebarFilter({ status: linked.archivedAt ? 'archived' : linked.resolved ? 'resolved' : 'unresolved', page: 'all', keywords: linked.number !== undefined ? `#${linked.number}` : undefined });
            setSidebarOpen(true);
            announce(messages().page.earlierPageState);
            return;
        }
        if (linked.archivedAt || linked.resolved || linked.position.type === 'page') {
            showInSidebar(linked.archivedAt ? 'archived' : linked.resolved ? 'resolved' : 'unresolved');
        } else {
            setOpenComment({ id: linked.id });
        }
    }, [allComments, linkedCommentId, linkedSite.data, linkedSite.isSuccess, path, announce]);

    // When the thread's pin can't be placed on this page (the element is gone or hidden), the inbox
    // shows it. "Show on page" goes back to the inbox as it was and says why. A pin in a closed layer
    // of the toolbar opens that layer first: the second starts again with every layer it opens, since
    // each one has to render before the pin has its place (a busy page took longer than one second
    // for both, and the inbox opened instead of the comment).
    useEffect(() => {
        if (!openComment || collapsed) {
            return;
        }
        const timeout = window.setTimeout(() => {
            setOpenComment(undefined);
            if (openComment.fromInbox) {
                setSidebarOpen(true);
                announce(messages().page.notOnPage);
            } else {
                showInSidebar('unresolved');
            }
        }, 1000);
        return () => window.clearTimeout(timeout);
    }, [openComment, collapsed, autoOpenStep]);

    const handleCloseSidebar = () => {
        setSidebarOpen(false);
        inboxButtonRef.current?.focus();
    };

    // A new anchor's panel takes the checks panels' place (the inbox's own is closed for it)
    useEffect(() => {
        if (reattaching) setOpenPanels(current => current.filter(panel => panel === 'inbox'));
    }, [reattaching]);
    // Remembered for the next page; a panel closed here is no longer a restored one
    useEffect(() => {
        rememberOpenPanels(openPanels);
        setRestoredPanels(current => current.every(panel => openPanels.includes(panel)) ? current : current.filter(panel => openPanels.includes(panel)));
    }, [openPanels]);
    const changeChecksPanel = (panel: ChecksPanelId, open: boolean) => {
        if (reattaching || !features.includes(panel)) return;
        if (!open) {
            closeChecks(panel);
            return;
        }
        setHintOpen(false);
        showPanel(panel, true);
    };
    // The focus goes back to the panel's button (Options on a narrow screen)
    const closeChecks = (panel: ChecksPanelId) => {
        ((panel === 'seo' ? seoButtonRef : accessibilityButtonRef).current ?? optionsButtonRef.current)?.focus();
        showPanel(panel, false);
    };
    // A panel's title menu: the panels this review shows, and one shown in another's place. One open already (on the
    // other side) gets the focus, as the new one's Close does when it opens.
    const accessibilityShown = auditAvailable() && features.includes('accessibility');
    const seoShown = features.includes('seo');
    const panelSwitch = useMemo(() => ({
        panels: [
            { id: 'inbox' as const, label: t.inbox.label },
            ...(accessibilityShown && !reattaching ? [{ id: 'accessibility' as const, label: t.toolbar.accessibility }] : []),
            ...(seoShown && !reattaching ? [{ id: 'seo' as const, label: t.toolbar.seo }] : [])
        ],
        switchTo: (from: DockPanelId, to: DockPanelId) => {
            const shown = openPanels.includes(to);
            setHintOpen(false);
            showPanel(from, false);
            showPanel(to, true);
            if (shown) requestAnimationFrame(() => (rootElement?.getRootNode() as ShadowRoot | Document | undefined)
                ?.querySelector<HTMLElement>(`#uier-panel-${to} [data-uier-panel-close]`)?.focus());
        }
    }), [t, accessibilityShown, seoShown, reattaching, openPanels, showPanel, rootElement]);
    // "Show" after a panel's quick action: the comment's thread on its pin, or the inbox for one about
    // the page. The panel it was in closes; one on the other side stays.
    const handleShowCheckComment = (comment: ShownComment, panel: ChecksPanelId) => {
        showPanel(panel, false);
        handleCollapsedChange(false);
        if (comment.page) {
            setSidebarFilter({ status: 'unresolved', keywords: comment.number !== undefined ? `#${comment.number}` : undefined });
            setSidebarOpen(true);
        } else {
            setOpenComment({ id: comment.commentId });
        }
    };

    // "Show on page" in the inbox (only while the pin can be placed): the thread opens on its pin
    // (and takes the focus)
    const handleShowOnPage = (commentId: string) => {
        handleCollapsedChange(false);
        const comment = allComments?.find(comment => comment.id === commentId);
        // An inbox control is only on the page while its panel is open.
        if (!toolbarReviewTarget(resolveAnchorElement(comment?.position))?.closest('#uier-panel-inbox')) {
            setSidebarOpen(false);
        }
        setOpenComment({ id: commentId, fromInbox: true });
    };

    const handleCollapsedChange = (next: boolean) => {
        rememberCollapsed(next);
        setCollapsed(next);
        if (next) {
            // Hide the review layer without discarding a comment or reply draft.
            setCreatingCommentPoint(false);
            setCreatingCommentSelection(undefined);
            setOpenComment(undefined);
            setContinuedThread(undefined);
            setReattaching(undefined);
            setCanvas(undefined);
            closeHintForUse();
        }
    };

    // The reviewed project in the uier app: the script's project, whose comments these are, else
    // the review link's code (`?review=true` on a project's site still has a project)
    const projectCode = review ? toolbarConfig.project ?? review.projectCode : undefined;
    const projectUrl = projectCode
        ? `${toolbarConfig.apiUrl}/app/projects/${encodeURIComponent(projectCode)}`
        : undefined;

    // A sent draft until its comment's pin is in the list (`handleCreated`)
    const shownCreatingComments = creatingComments.filter(draft => (draft.kind !== 'rewrite' || features.includes('rewrite')) &&
        (draft.kind !== 'drawing' || features.includes('draw')) &&
        (!draft.sentAs || !pinnedComments.some(comment => commentKey(comment) === draft.sentAs)));

    // Keep the pill, movement and inbox mounted across SPA navigation. Only state tied to
    // the old page's DOM is discarded, before children can commit against the new draft store.
    const activePath = useRef(path);
    activePath.current = path;
    const [previousPath, setPreviousPath] = useState(path);
    if (previousPath !== path) {
        setPreviousPath(path);
        setCreatingComments(restorePageDrafts());
        setCreatingCommentSelection(undefined);
        setCreatingCommentPoint(false);
        setOpenDrafts(new Set());
        setResumingDraft(undefined);
        setActiveThreads(new Set());
        setContinuedThread(undefined);
        setOpenComment(undefined);
        setReattaching(undefined);
        setCanvas(undefined);
        setFeedbackRequested(false);
        setLinkedCommentId(takeLinkedCommentId());
        linkHandledRef.current = false;
        lastPageFocusRef.current = null;
        setRestoredPanels(openPanels);
    }

    const candidatePlacement = reattaching?.candidate ? getCommentPlacement(reattaching.candidate) : undefined;
    return (
        <ReattachContext.Provider value={requestReattach}>
            {commentItems.isError && (
                <CommentsLoadError error={commentItems.error} onRetry={() => commentItems.refetch()} />
            )}
            {!collapsed && <InlineCommentThreads key={path} comments={pinnedComments} />}
            {/* A failing comment (e.g. a stored selector this page can't resolve) renders nothing, the rest keeps working */}
            {!collapsed && pinnedComments.length > 0 && (
                <section aria-label={t.page.comments}>
                    {pinnedComments.map((commentItem) => (
                        <CommentErrorBoundary key={`${path}:${commentKey(commentItem)}`} commentId={commentItem.id}>
                            <CommentBubble
                                commentItem={commentItem}
                                onOpenStateChange={handleThreadOpenState}
                                autoOpen={openCommentId === commentItem.id}
                                continuesDraft={continuedThread === commentKey(commentItem)}
                                autoOpenReading={openComment?.reading}
                                onAutoOpened={handleAutoOpened}
                                onAutoOpenStep={handleAutoOpenStep} />
                        </CommentErrorBoundary>
                    ))}
                </section>
            )}
            {!collapsed && shownCreatingComments.map(creatingComment => (
                <CommentErrorBoundary key={`${path}:new-${creatingComment.key}`}>
                    <CommentBubble
                        draft={creatingComment}
                        initiallyClosed={creatingComment.initiallyClosed}
                        autoOpen={resumingDraft === creatingComment.key}
                        onAutoOpened={handleDraftResumed}
                        onOpenStateChange={handleDraftOpenState}
                        draftPinOffset={pinnedComments.some(comment => resolveAnchorElement(comment.position) === resolveAnchorElement(creatingComment.position)) ? 36 : 0}
                        onCreated={localId => { if (activePath.current === path) handleCreated(localId, creatingComment.key); }}
                        onSendFailed={(error, choice) => { if (activePath.current === path) restoreCreatingComment(creatingComment.kind, error, choice); }}
                        onEditDrawing={creatingComment.kind === 'drawing' && !canvas ? () => resumeDrawing(creatingComment) : undefined}
                        onCanceled={() => removeCreatingComment(creatingComment.key)} />
                </CommentErrorBoundary>
            ))}
            {!collapsed && creatingCommentSelection && (
                <CommentErrorBoundary>
                    <CommentSelectionHighlight commentSelection={creatingCommentSelection} />
                </CommentErrorBoundary>
            )}
            {!collapsed && creatingSelectionRects?.length > 0 && (
                <CommentSelectionPopover
                    rects={creatingSelectionRects}
                    onCreate={() => handleCreateComment('comment')}
                    onRewrite={() => handleCreateComment('rewrite')} />
            )}
            {!collapsed && reattaching && <>
                {reattaching.mode === 'point' && <CommentPointOverlay onPoint={chooseAnchor} />}
                {reattaching.candidate?.type === 'text' && <CommentSelectionHighlight commentSelection={reattaching.candidate} />}
                {isCommentArea(reattaching.candidate) && candidatePlacement?.rects[0] && <CommentAreaHighlight rect={candidatePlacement.rects[0]} active />}
                <InkScope>
                    {reattaching.mode ? <div className="fixed top-4 left-1/2 z-[60] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border bg-background p-3 text-sm text-foreground" role="region" aria-label={t.page.chooseAnchor}>
                        <p role="status" className="m-0">{reattaching.mode === 'point' ? t.page.chooseElementHelp : t.page.chooseTextHelp}</p>
                        <div className="mt-2 flex gap-2">
                            {reattaching.mode === 'text' && <Button size="sm" className="min-h-11" disabled={!reattaching.candidate} onClick={() => setReattaching({ ...reattaching, mode: undefined })}>{t.page.useSelectedText}</Button>}
                            <Button size="sm" variant="plain" className="min-h-11" onClick={finishReattach}>{t.common.cancel}</Button>
                        </div>
                    </div> : <DockablePanel id="inbox" label={t.thread.reattach} onKeyDown={event => {
                        if (event.key === 'Escape' && !reattach.isPending) { event.stopPropagation(); finishReattach(); }
                    }}>
                        <div className="h-full overflow-y-auto p-4 text-sm">
                            <h2 className="m-0 text-base font-semibold">{t.thread.reattach}</h2>
                            <p>{t.page.reattachHelp}</p>
                            <div className="flex flex-wrap gap-2">
                                <Button autoFocus size="sm" variant="outlined" className="min-h-11" disabled={reattach.isPending}
                                    onClick={() => setReattaching({ ...reattaching, mode: 'point', candidate: undefined })}>{t.page.chooseElement}</Button>
                                <Button size="sm" variant="outlined" className="min-h-11" disabled={reattach.isPending}
                                    onClick={() => { window.getSelection()?.removeAllRanges(); setReattaching({ ...reattaching, mode: 'text', candidate: undefined }); }}>{t.page.chooseText}</Button>
                            </div>
                            <p role="status">{reattaching.candidate ? t.page.reviewAnchor : t.page.chooseHow}</p>
                            {reattaching.candidate && <>
                                <p className="break-words" data-uier-anchor-candidate="">{describeAnchor(reattaching.candidate, t)}</p>
                                <p>{candidatePlacement && t.anchor.state[candidatePlacement.state]}</p>
                            </>}
                            {reattach.error instanceof CommentsApiError && reattach.error.status === 409
                                ? <p role="alert" className="text-sm">{t.page.anchorChanged}</p>
                                : <CommentsErrorMessage error={reattach.error} />}
                            {reattach.error instanceof CommentsApiError && reattach.error.status === 409 && <Button variant="outlined" size="sm" className="min-h-11" onClick={() => {
                                const latest = allComments?.find(comment => comment.id === reattaching.comment.id);
                                if (latest) requestReattach(latest);
                            }}>{t.page.startAgain}</Button>}
                            <div className="mt-4 flex gap-2">
                                <Button size="sm" className="min-h-11" disabled={reattach.isPending || !candidatePlacement?.rects.length || candidatePlacement.state !== 'exact'} onClick={() => void saveAnchor()}>{t.page.confirmAnchor}</Button>
                                <Button size="sm" variant="plain" className="min-h-11" disabled={reattach.isPending} onClick={finishReattach}>{t.common.cancel}</Button>
                            </div>
                        </div>
                    </DockablePanel>}
                </InkScope>
            </>}
            {!collapsed && creatingCommentPoint && (
                <CommentPointOverlay onPoint={handleCreateCommentPoint} />
            )}
            {!collapsed && canvas && features.includes('draw') && (
                <CommentErrorBoundary>
                    <CanvasMode key={canvas.key} initialShapes={canvas.initialShapes} initialFrame={canvas.initialFrame} onDiscard={discardCanvas} onComment={commentOnDrawing} />
                </CommentErrorBoundary>
            )}
            <PanelSwitchContext value={panelSwitch}>
            <RestoredPanelContext value={restoredPanels}>
                {sidebarOpen && (
                    <CommentsSidebar
                        filter={sidebarFilter}
                        onFilterChange={setSidebarFilter}
                        onClose={handleCloseSidebar}
                        onShowOnPage={handleShowOnPage}
                        focusRequest={inboxFocus} />
                )}
                <PageChecks key={`${path}:${language}:${features.join(',')}`}
                    panels={checksPanels}
                    collapsed={collapsed}
                    onClose={closeChecks}
                    onShowComment={handleShowCheckComment}
                    onAttentionChange={setChecksAttention} />
            </RestoredPanelContext>
            </PanelSwitchContext>
            <CommentToolbar
                mode={mode}
                creatingPointComment={creatingCommentPoint}
                collapsed={collapsed}
                commentsCount={activityQuery.data?.unread ?? 0}
                hintOpen={hintOpen && showAbout}
                showAbout={showAbout}
                hintId={hintId}
                projectUrl={projectUrl}
                addButtonRef={addButtonRef}
                inboxButtonRef={inboxButtonRef}
                hintButtonRef={hintButtonRef}
                onAddPointComment={handleAddPointComment}
                drawing={Boolean(canvas)}
                drawButtonRef={drawButtonRef}
                onDraw={features.includes('draw') ? toggleCanvas : undefined}
                // Not over the inbox or while choosing a new anchor
                onResumeDraft={resumableDraft && !sidebarOpen && !reattaching ? resumeDraft : undefined}
                onCancelPointComment={() => { setCreatingCommentPoint(false); addButtonRef.current?.focus(); }}
                sidebarOpen={sidebarOpen}
                checksPanels={checksPanels}
                onChecksPanelChange={changeChecksPanel}
                accessibilityAvailable={auditAvailable()}
                checksAttention={checksAttention}
                accessibilityButtonRef={accessibilityButtonRef}
                seoButtonRef={seoButtonRef}
                optionsButtonRef={optionsButtonRef}
                onToggleSidebar={() => {
                    if (reattaching) return;
                    if (sidebarOpen) handleCloseSidebar();
                    else { setHintOpen(false); setSidebarOpen(true); }
                }}
                onMoveStart={() => {
                    setCreatingCommentPoint(false);
                    setCreatingCommentSelection(undefined);
                    closeHintForUse();
                }}
                onFeedbackOpen={() => {
                    setCreatingCommentPoint(false);
                    closeHintForUse();
                }}
                feedbackRequested={feedbackRequested}
                onFeedbackRequestHandled={() => setFeedbackRequested(false)}
                onToggleHint={() => hintOpen ? handleDismissHint(false) : setHintOpen(true)}
                onCollapsedChange={handleCollapsedChange}
                onExitReview={onExitReview}
                shortcutsRequested={shortcutsRequested}
                onShortcutsRequestHandled={handleShortcutsRequestHandled} />
            {/* After the pill, so forward Tab from "About uier" reaches it */}
            {hintOpen && showAbout && !collapsed && (
                <ShowcaseHint id={hintId} pointAtRef={hintButtonRef} onDismiss={handleDismissHint} />
            )}
            <Toaster />
        </ReattachContext.Provider>
    );
}

/** Beside the pill, wherever it was moved: never over it */
function CommentsLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
    const notice = useToolbarNotice<HTMLDivElement>();
    const t = useMessages();
    return (
        <InkScope>
            <div ref={notice.ref} style={notice.style} className="fixed z-[51] flex w-max max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border bg-background p-3 text-foreground">
                <div>
                    <p className="m-0 text-sm">{t.page.notLoaded}</p>
                    <CommentsErrorMessage error={error} />
                </div>
                <Button variant="outlined" size="sm" onClick={onRetry}>{t.common.retry}</Button>
            </div>
        </InkScope>
    );
}
