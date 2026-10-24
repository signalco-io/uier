import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { getElementSelector } from '@signalco/js';
import { useWindowEvent } from '@signalco/hooks/useWindowEvent';
import { useDocumentEvent } from '@signalco/hooks/useDocumentEvent';
import { useComments } from '../hooks/useComments';
import { resolveAnchorElement, useCommentItemRects } from '../hooks/useCommentItemRects';
import { CommentsSidebar } from './sidebar/CommentsSidebar';
import { CommentToolbar } from './CommentToolbar';
import { CommentSelectionPopover } from './CommentSelectionPopover';
import { CommentSelectionHighlight } from './CommentSelectionHighlight';
import { CommentPointOverlay } from './CommentPointOverlay';
import { CommentBubble } from './CommentBubble';
import { CommentErrorBoundary } from './CommentErrorBoundary';
import { isShowcaseHintDismissed, rememberShowcaseHintDismissed, ShowcaseHint } from './ShowcaseHint';
import { getDeviceInfo } from './info/getDeviceInfo';
import { CommentsGlobalProps, CommentSelection, CommentPoint, CommentDraft, CommentItem, commentsListMaxLength } from './@types/Comments';

// Selection text limit of the comments API
const selectionTextMaxLength = 2000;

/** Whether the node is in the toolbar's shadow root (or is its host) */
function isToolbarNode(node: Node | null | undefined, rootElement: HTMLElement | undefined) {
    const rootNode = rootElement?.getRootNode();
    if (!node || !(rootNode instanceof ShadowRoot)) {
        return false;
    }

    return node.getRootNode() === rootNode || node === rootNode.host || rootNode.host.contains(node);
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

type CommentDraftState = CommentDraft & {
    /** New for every draft, so a new draft opens its popover again */
    key: number;
};

export function CommentsGlobal({
    mode,
    reviewParamKey = 'review',
    rootElement
}: CommentsGlobalProps) {
    const [creatingCommentSelection, setCreatingCommentSelection] = useState<CommentSelection>();
    const [creatingComment, setCreatingComment] = useState<CommentDraftState>();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [hintOpen, setHintOpen] = useState(() => mode === 'showcase' && !isShowcaseHintDismissed());
    const [focusCommentId, setFocusCommentId] = useState<string>();
    const hintId = useId();
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const inboxButtonRef = useRef<HTMLButtonElement>(null);
    const hintButtonRef = useRef<HTMLButtonElement>(null);
    const draftKeyRef = useRef(0);
    // The last focused element of the page (outside the toolbar), for comments created with the keyboard
    const lastPageFocusRef = useRef<Element | null>(null);

    const { query: commentItems } = useComments();
    const allComments = commentItems.data;
    const unresolvedComments = useMemo(
        () => sortByDocumentPosition((allComments ?? []).filter(c => !c.resolved)),
        [allComments]);
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

    const startDraft = (position: CommentDraft['position']) => {
        closeHintForUse();
        draftKeyRef.current += 1;
        setCreatingComment({
            key: draftKeyRef.current,
            position,
            device: getDeviceInfo()
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

    useDocumentEvent('selectionchange', () => {
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

        closeHintForUse();
        setCreatingCommentSelection({
            text: text.slice(0, selectionTextMaxLength),
            type: 'text',
            startSelector: getElementSelector(selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement),
            startOffset: selection.anchorOffset,
            startType: selection.anchorNode?.nodeType === Node.TEXT_NODE ? 'text' : 'element',
            endSelector: getElementSelector(selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode?.parentElement),
            endOffset: selection.focusOffset,
            endType: selection.focusNode?.nodeType === Node.TEXT_NODE ? 'text' : 'element'
        });
    });

    const creatingSelectionRects = useCommentItemRects(creatingCommentSelection);

    const handleCreateComment = () => {
        if (!creatingCommentSelection) {
            return;
        }

        const position = creatingCommentSelection;
        setCreatingCommentSelection(undefined);
        startDraft(position);
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

    const handleCreated = (comment: CommentItem) => {
        setCreatingComment(undefined);
        setFocusCommentId(comment.id);
    };
    const handleAutoFocused = useCallback(() => setFocusCommentId(undefined), []);

    // The new comment's pin takes the focus once it is placed; if it can't be placed on this
    // page, the focus goes back to Add comment instead of the page
    useEffect(() => {
        if (!focusCommentId) {
            return;
        }
        const timeout = window.setTimeout(() => {
            setFocusCommentId(undefined);
            addButtonRef.current?.focus();
        }, 1000);
        return () => window.clearTimeout(timeout);
    }, [focusCommentId]);

    const handleCloseSidebar = () => {
        setSidebarOpen(false);
        inboxButtonRef.current?.focus();
    };

    const handleExitReview = () => {
        const url = new URL(window.location.href);
        url.searchParams.delete(reviewParamKey);
        window.history.replaceState({}, '', url.toString());
    };

    return (
        <>
            {/* A failing comment (e.g. a stored selector this page can't resolve) renders nothing, the rest keeps working */}
            {unresolvedComments.length > 0 && (
                <section aria-label="Comments on this page">
                    {unresolvedComments.map((commentItem) => (
                        <CommentErrorBoundary key={commentItem.id} commentId={commentItem.id}>
                            <CommentBubble
                                commentItem={commentItem}
                                autoFocus={focusCommentId === commentItem.id}
                                onAutoFocused={handleAutoFocused} />
                        </CommentErrorBoundary>
                    ))}
                </section>
            )}
            {creatingComment && (
                <CommentErrorBoundary key={`new-${creatingComment.key}`}>
                    <CommentBubble
                        draft={creatingComment}
                        onCreated={handleCreated}
                        onCanceled={() => setCreatingComment(undefined)} />
                </CommentErrorBoundary>
            )}
            {creatingCommentSelection && (
                <CommentErrorBoundary>
                    <CommentSelectionHighlight commentSelection={creatingCommentSelection} />
                </CommentErrorBoundary>
            )}
            {creatingSelectionRects?.length > 0 && (
                <CommentSelectionPopover
                    rects={creatingSelectionRects}
                    onCreate={handleCreateComment} />
            )}
            {creatingCommentPoint && (
                <CommentPointOverlay onPoint={handleCreateCommentPoint} />
            )}
            {sidebarOpen && (
                <CommentsSidebar
                    onClose={handleCloseSidebar}
                    rootElement={rootElement}
                />
            )}
            <CommentToolbar
                mode={mode}
                creatingPointComment={creatingCommentPoint}
                commentsCount={unresolvedComments.length}
                commentsCountCapped={commentsCountCapped}
                hintOpen={hintOpen}
                hintId={hintId}
                addButtonRef={addButtonRef}
                inboxButtonRef={inboxButtonRef}
                hintButtonRef={hintButtonRef}
                onAddPointComment={handleAddPointComment}
                onShowSidebar={() => setSidebarOpen(true)}
                onToggleHint={() => hintOpen ? handleDismissHint(false) : setHintOpen(true)}
                onExitReview={handleExitReview} />
            {/* After the pill, so forward Tab from "About uier" reaches it */}
            {mode === 'showcase' && hintOpen && (
                <ShowcaseHint id={hintId} onDismiss={handleDismissHint} />
            )}
        </>
    );
}
