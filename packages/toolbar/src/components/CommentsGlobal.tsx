import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { getElementSelector } from '@signalco/js';
import { useWindowEvent } from '@signalco/hooks/useWindowEvent';
import { useDocumentEvent } from '@signalco/hooks/useDocumentEvent';
import { Button } from '@signalco/ui-primitives/Button';
import { useComments } from '../hooks/useComments';
import { newRewriteDraftKey, useDrafts } from '../hooks/useDrafts';
import { resolveAnchorElement, selectionTextMaxLength, textOffsetWithin, useCommentItemRects } from '../hooks/useCommentItemRects';
import { CommentsSidebar } from './sidebar/CommentsSidebar';
import { CommentToolbar } from './CommentToolbar';
import { CommentSelectionPopover } from './CommentSelectionPopover';
import { CommentSelectionHighlight } from './CommentSelectionHighlight';
import { CommentPointOverlay } from './CommentPointOverlay';
import { CommentBubble } from './CommentBubble';
import { InlineCommentThreads } from './InlineCommentThread';
import { CommentErrorBoundary } from './CommentErrorBoundary';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { InkScope } from './InkScope';
import { useAnnounce } from './Announcer';
import { isShowcaseHintDismissed, rememberShowcaseHintDismissed, ShowcaseHint } from './ShowcaseHint';
import { toolbarConfig } from '../config';
import { takeLinkedCommentId } from '../review';
import type { CommentsFilter, CommentsStatusFilter } from './sidebar/CommentsFilter';
import { CommentsGlobalProps, CommentSelection, CommentPoint, CommentDraft, CommentItem, commentsListMaxLength, commentTextMaxLength } from './@types/Comments';

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

/** A point comment in the middle of the element, for comments created with the keyboard */
function centerPoint(element: Element): CommentPoint {
    return {
        type: 'point',
        selector: getElementSelector(element),
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
};

export function CommentsGlobal({
    mode,
    review,
    rootElement,
    onExitReview
}: CommentsGlobalProps) {
    const [creatingCommentSelection, setCreatingCommentSelection] = useState<CommentSelection>();
    const [creatingComment, setCreatingComment] = useState<CommentDraftState>();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(readCollapsed);
    const [hintOpen, setHintOpen] = useState(() => mode === 'showcase' && !isShowcaseHintDismissed());
    // The thread to open once its pin is on the page: a comment that was just posted, the one a
    // comment link (`?uier-comment=`) points at, or "Show on page" in the inbox (`fromInbox`)
    const [openComment, setOpenComment] = useState<{ id: string; fromInbox?: boolean }>();
    const openCommentId = openComment?.id;
    const [linkedCommentId] = useState(takeLinkedCommentId);
    const linkHandledRef = useRef(false);
    // The inbox's status and search, kept while it is closed
    const [sidebarFilter, setSidebarFilter] = useState<CommentsFilter>({ status: 'unresolved' });
    const announce = useAnnounce();
    const hintId = useId();
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const inboxButtonRef = useRef<HTMLButtonElement>(null);
    const hintButtonRef = useRef<HTMLButtonElement>(null);
    const draftKeyRef = useRef(0);
    // The last focused element of the page (outside the toolbar), for comments created with the keyboard
    const lastPageFocusRef = useRef<Element | null>(null);

    const { query: commentItems } = useComments();
    const drafts = useDrafts();
    const allComments = commentItems.data;
    const unresolvedComments = useMemo(
        () => sortByDocumentPosition((allComments ?? []).filter(c => !c.resolved)),
        [allComments]);
    // Feedback and bug reports are about the whole page: in the inbox, without a pin
    const pinnedComments = useMemo(
        () => unresolvedComments.filter(c => c.position.type !== 'page'),
        [unresolvedComments]);
    // The API lists at most this many comments; the page can have more
    const commentsCountCapped = (allComments?.length ?? 0) >= commentsListMaxLength;

    const [creatingCommentPoint, setCreatingCommentPoint] = useState(false);

    /** The visitor found the feature: the first-run hint is not needed anymore */
    const closeHintForUse = () => {
        if (hintOpen) {
            rememberShowcaseHintDismissed();
            setHintOpen(false);
        }
    };

    const startDraft = (position: CommentDraft['position'], kind: CommentDraft['kind'] = 'comment') => {
        closeHintForUse();
        draftKeyRef.current += 1;
        // A rewrite starts from the selected text (when it fits a comment's length)
        if (kind === 'rewrite' && position.type === 'text') {
            drafts.set(newRewriteDraftKey, position.text.length <= commentTextMaxLength ? position.text : '');
        }
        setCreatingComment({
            key: draftKeyRef.current,
            position,
            kind
        });
    };

    /** Keyboard path: pin a new comment to the focused page element (or the main content) */
    const startDraftOnFocusedElement = (element?: Element | null) => {
        const target = element?.isConnected && element !== document.body && element !== document.documentElement
            ? element
            : document.querySelector('main') ?? document.body;
        setCreatingCommentPoint(false);
        startDraft(centerPoint(target));
    };

    const handleDismissHint = (hadFocus: boolean) => {
        rememberShowcaseHintDismissed();
        setHintOpen(false);
        // Keep the keyboard focus in the toolbar
        if (hadFocus) {
            hintButtonRef.current?.focus();
        }
    };

    useDocumentEvent('focusin', (event: FocusEvent) => {
        const target = event.target;
        if (target instanceof Element && !isToolbarNode(target, rootElement)) {
            lastPageFocusRef.current = target;
        }
    });

    useWindowEvent('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Escape') {
            return;
        }

        if (creatingCommentSelection || creatingCommentPoint) {
            event.stopPropagation();
            event.preventDefault();
            setCreatingCommentPoint(false);
            setCreatingCommentSelection(undefined);
            return;
        }

        // Escape on the pill closes the hint as well (the hint handles its own Escape)
        if (hintOpen && isToolbarNode(document.activeElement, rootElement)) {
            handleDismissHint(false);
        }
    }, [creatingCommentSelection, creatingCommentPoint, hintOpen, rootElement]);

    // In point mode, Enter on a focused page element pins the comment to it (instead of e.g.
    // following the link). Capture phase, so the page does not handle the key first.
    useEffect(() => {
        if (!creatingCommentPoint) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.isComposing) {
                return;
            }
            const active = document.activeElement;
            if (isToolbarNode(active, rootElement)) {
                // The toolbar's own buttons handle Enter (Add comment pins to the last page focus)
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            startDraftOnFocusedElement(active);
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    });

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
                selector: getElementSelector(element),
                offset: isText && element && node ? textOffsetWithin(element, node, offset) : offset,
                type: isText ? 'text' as const : 'element' as const
            };
        };
        const start = boundary(selection.anchorNode, selection.anchorOffset);
        const end = boundary(selection.focusNode, selection.focusOffset);

        closeHintForUse();
        setCreatingCommentSelection({
            text: text.slice(0, selectionTextMaxLength),
            type: 'text',
            startSelector: start.selector,
            startOffset: start.offset,
            startType: start.type,
            endSelector: end.selector,
            endOffset: end.offset,
            endType: end.type
        });
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

    const handleCreateCommentPoint = (commentPoint: CommentPoint) => {
        setCreatingCommentPoint(false);
        startDraft(commentPoint);
    };

    const handleAddPointComment = (fromKeyboard: boolean) => {
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

    // A posted comment shows its thread
    const handleCreated = (comment: CommentItem) => {
        setCreatingComment(undefined);
        setOpenComment({ id: comment.id });
    };
    const handleAutoOpened = useCallback(() => setOpenComment(undefined), []);

    // A comment link opens the thread on its pin; done threads and feedback have no pin, the
    // inbox shows them
    useEffect(() => {
        if (!linkedCommentId || linkHandledRef.current || !allComments) {
            return;
        }
        linkHandledRef.current = true;
        const linked = allComments.find(c => c.id === linkedCommentId);
        if (!linked) {
            return;
        }
        if (linked.resolved || linked.position.type === 'page') {
            showInSidebar(linked.resolved ? 'resolved' : 'unresolved');
        } else {
            setOpenComment({ id: linked.id });
        }
    }, [allComments, linkedCommentId]);

    // When the thread's pin can't be placed on this page (the element is gone or hidden), the inbox
    // shows it. "Show on page" goes back to the inbox as it was and says why.
    useEffect(() => {
        if (!openComment || collapsed) {
            return;
        }
        const timeout = window.setTimeout(() => {
            setOpenComment(undefined);
            if (openComment.fromInbox) {
                setSidebarOpen(true);
                announce('This comment\'s place is not on the page right now.');
            } else {
                showInSidebar('unresolved');
            }
        }, 1000);
        return () => window.clearTimeout(timeout);
    }, [openComment, collapsed]);

    const handleCloseSidebar = () => {
        setSidebarOpen(false);
        inboxButtonRef.current?.focus();
    };

    // "Show on page" in the inbox (only while the pin can be placed): the thread opens on its pin
    // (and takes the focus)
    const handleShowOnPage = (commentId: string) => {
        handleCollapsedChange(false);
        setSidebarOpen(false);
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
            closeHintForUse();
        }
    };

    // The reviewed project in the uier app: the script's project, whose comments these are, else
    // the review link's code (`?review=true` on a project's site still has a project)
    const projectCode = review ? toolbarConfig.project ?? review.projectCode : undefined;
    const projectUrl = projectCode
        ? `${toolbarConfig.apiUrl}/app/projects/${encodeURIComponent(projectCode)}`
        : undefined;

    return (
        <>
            {commentItems.isError && (
                <InkScope>
                    <div className="fixed bottom-20 left-1/2 z-[51] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-background p-3 text-foreground">
                        <div>
                            <p className="m-0 text-sm">Comments could not be loaded.</p>
                            <CommentsErrorMessage error={commentItems.error} />
                        </div>
                        <Button variant="outlined" size="sm" onClick={() => commentItems.refetch()}>Try again</Button>
                    </div>
                </InkScope>
            )}
            {!collapsed && <InlineCommentThreads comments={pinnedComments} />}
            {/* A failing comment (e.g. a stored selector this page can't resolve) renders nothing, the rest keeps working */}
            {!collapsed && pinnedComments.length > 0 && (
                <section aria-label="Comments on this page">
                    {pinnedComments.map((commentItem) => (
                        <CommentErrorBoundary key={commentItem.id} commentId={commentItem.id}>
                            <CommentBubble
                                commentItem={commentItem}
                                autoOpen={openCommentId === commentItem.id}
                                onAutoOpened={handleAutoOpened} />
                        </CommentErrorBoundary>
                    ))}
                </section>
            )}
            {!collapsed && creatingComment && (
                <CommentErrorBoundary key={`new-${creatingComment.key}`}>
                    <CommentBubble
                        draft={creatingComment}
                        onCreated={handleCreated}
                        onCanceled={() => setCreatingComment(undefined)} />
                </CommentErrorBoundary>
            )}
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
            {!collapsed && creatingCommentPoint && (
                <CommentPointOverlay onPoint={handleCreateCommentPoint} />
            )}
            {sidebarOpen && (
                <CommentsSidebar
                    filter={sidebarFilter}
                    onFilterChange={setSidebarFilter}
                    onClose={handleCloseSidebar}
                    onShowOnPage={handleShowOnPage} />
            )}
            <CommentToolbar
                mode={mode}
                creatingPointComment={creatingCommentPoint}
                collapsed={collapsed}
                commentsCount={unresolvedComments.length}
                commentsCountCapped={commentsCountCapped}
                hintOpen={hintOpen}
                hintId={hintId}
                projectUrl={projectUrl}
                addButtonRef={addButtonRef}
                inboxButtonRef={inboxButtonRef}
                hintButtonRef={hintButtonRef}
                onAddPointComment={handleAddPointComment}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                onFeedbackOpen={() => {
                    setCreatingCommentPoint(false);
                    closeHintForUse();
                }}
                onToggleHint={() => hintOpen ? handleDismissHint(false) : setHintOpen(true)}
                onCollapsedChange={handleCollapsedChange}
                onExitReview={onExitReview} />
            {/* After the pill, so forward Tab from "About uier" reaches it */}
            {mode === 'showcase' && hintOpen && !collapsed && (
                <ShowcaseHint id={hintId} pointAtRef={addButtonRef} onDismiss={handleDismissHint} />
            )}
        </>
    );
}
