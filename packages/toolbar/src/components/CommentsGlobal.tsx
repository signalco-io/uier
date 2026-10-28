import { ReattachContext, describeAnchor, anchorStateText } from './CommentAnchorDetails';
import { DockablePanel } from './DockablePanel';
import { CommentsApiError } from '../hooks/api';
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { anchorSelector } from '../anchorSelector';
import { toolbarReviewTarget } from '../toolbarReview';
import { useWindowEvent } from '@signalco/hooks/useWindowEvent';
import { Button } from '@signalco/ui-primitives/Button';
import { commentKey, useComments, useSiteComments, useCommentsRefresh, useActivitySummary } from '../hooks/useComments';
import { newCommentDraftKey, newRewriteDraftKey, useDrafts } from '../hooks/useDrafts';
import { getCommentPlacement, resolveAnchorElement, selectionTextMaxLength, textOffsetWithin, useCommentItemRects } from '../hooks/useCommentItemRects';
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
import { Toaster } from './Toaster';
import { useAnnounce } from './Announcer';
import { isShowcaseHintDismissed, rememberShowcaseHintDismissed, ShowcaseHint } from './ShowcaseHint';
import { useProjectViewer } from '../project/ProjectGate';
import { useVisitor } from '../hooks/useVisitor';
import { toolbarConfig } from '../config';
import { takeLinkedCommentId } from '../review';
import { openFeedbackEvent, takeFeedbackRequest } from '../openFeedback';
import { captureCommentScreenshot } from '../screenshot';
import { getDeviceInfo } from './info/getDeviceInfo';
import type { CommentsFilter, CommentsStatusFilter } from './sidebar/CommentsFilter';
import { CommentAnchor, CommentsGlobalProps, CommentSelection, CommentPoint, CommentDraft, CommentItem, commentTextMaxLength } from './@types/Comments';

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
};

export function CommentsGlobal({
    mode,
    review,
    rootElement,
    onExitReview
}: CommentsGlobalProps) {
    const drafts = useDrafts();
    const [creatingCommentSelection, setCreatingCommentSelection] = useState<CommentSelection>();
    const [creatingComments, setCreatingComments] = useState<CommentDraftState[]>(() =>
        [newCommentDraftKey, newRewriteDraftKey].map(key => drafts.details(key))
            .filter(value => value?.text.trim() && value.anchor)
            .sort((a, b) => b!.updatedAt - a!.updatedAt)
            .map((saved, index) => ({ ...saved!.anchor!, key: -index, initiallyClosed: true })));
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
        return () => { stopComment(); stopRewrite(); };
    }, [drafts]);
    const [activeThreads, setActiveThreads] = useState<ReadonlySet<string>>(() => new Set());
    // A comment being sent (its temporary id), whose thread opens once it is saved (see `handleSaved`)
    const awaitingThreadRef = useRef<string>(undefined);
    const handleThreadOpenState = useCallback((id: string, open: boolean) => {
        // A thread opened meanwhile (the one being sent, too) stays the only one
        if (open) awaitingThreadRef.current = undefined;
        setActiveThreads(current => {
            if (current.has(id) === open) return current;
            const next = new Set(current);
            if (open) next.add(id); else next.delete(id);
            return next;
        });
    }, []);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    // The page asked to give feedback (`openFeedbackEvent`, or `feedback` mode mounting for it)
    const [feedbackRequested, setFeedbackRequested] = useState(takeFeedbackRequest);
    const [collapsed, setCollapsed] = useState(() => !feedbackRequested && readCollapsed());
    const project = useProjectViewer();
    const { query: visitor } = useVisitor();
    const [hintOpen, setHintOpen] = useState(() => !feedbackRequested && mode !== 'feedback' && !isShowcaseHintDismissed());
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
    const chooseAnchor = (candidate: CommentAnchor) => setReattaching(current => current ? { ...current, candidate, mode: undefined } : current);
    const saveAnchor = async () => {
        if (!reattaching?.candidate) return;
        try {
            await reattach.mutateAsync({ commentId: reattaching.comment.id, path, position: reattaching.candidate,
                expectedRevision: reattaching.comment.anchorContext?.revision ?? null });
            announce('Comment reattached. Original evidence is unchanged.');
            finishReattach();
        } catch (error) {
            if (error instanceof CommentsApiError && [401, 403, 404].includes(error.status)) {
                announce('This comment is no longer available to edit.');
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
            comment.position.type !== 'page' && (!comment.resolved || (activeThreads.has(comment.id) && Boolean(drafts.get(comment.id)))))),
        [allComments, drafts, activeThreads]);
    // The API lists at most this many comments; the page can have more

    const [creatingCommentPoint, setCreatingCommentPoint] = useState(false);

    /** The visitor found the feature: the first-run hint is not needed anymore */
    const closeHintForUse = () => {
        rememberShowcaseHintDismissed();
        setHintOpen(false);
    };

    const startDraft = (position: CommentDraft['position'], kind: CommentDraft['kind'] = 'comment') => {
        closeHintForUse();
        awaitingThreadRef.current = undefined;
        draftKeyRef.current += 1;
        const draftKey = kind === 'rewrite' ? newRewriteDraftKey : newCommentDraftKey;
        const existing = drafts.details(draftKey);
        if (existing?.text.trim() && existing.anchor) {
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
            device: getDeviceInfo(),
            screenshot: captureCommentScreenshot(position, rootElement)
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

    const handleFeedbackRequest = useEffectEvent(() => {
        closeHintForUse();
        if (collapsed) {
            handleCollapsedChange(false);
        }
        setFeedbackRequested(true);
    });
    useEffect(() => {
        const listener = () => handleFeedbackRequest();
        window.addEventListener(openFeedbackEvent, listener);
        return () => window.removeEventListener(openFeedbackEvent, listener);
    }, []);

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

    useWindowEvent('keydown', (event: KeyboardEvent) => {
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
        if (hintOpen && isToolbarNode(document.activeElement, rootElement)) {
            handleDismissHint(false);
        }
    }, [creatingCommentSelection, creatingCommentPoint, hintOpen, rootElement, reattaching, reattach.isPending]);

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
                if (active && active !== document.body && active !== document.documentElement) chooseAnchor(centerPoint(active));
            } else startDraftOnFocusedElement(active);
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

    const handleCreateCommentPoint = (commentPoint: CommentPoint) => {
        setCreatingCommentPoint(false);
        startDraft(commentPoint);
    };

    const handleAddPointComment = (fromKeyboard: boolean) => {
        if (reattaching) return;
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

    // A posted comment's pin is there at once; its thread opens when it is saved (at its full size,
    // so the popover takes the side with room), unless something else was started meanwhile
    const handleCreated = (localId: string, draftKey: number) => {
        removeCreatingComment(draftKey);
        awaitingThreadRef.current = localId;
    };
    const handleSaved = (localId: string, commentId: string) => {
        if (awaitingThreadRef.current !== localId) return;
        awaitingThreadRef.current = undefined;
        setOpenComment({ id: commentId });
    };
    // It was not posted: the draft, with its text back, is on the page again
    const restoreCreatingComment = (kind: CommentDraft['kind'], sendError: unknown) => {
        const saved = drafts.details(kind === 'rewrite' ? newRewriteDraftKey : newCommentDraftKey);
        if (!saved?.text.trim() || !saved.anchor) return;
        draftKeyRef.current += 1;
        setCreatingComment({ ...saved.anchor, key: draftKeyRef.current, sendError });
    };
    const handleAutoOpened = useCallback(() => setOpenComment(undefined), []);

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
            setSidebarFilter({ status: linked.resolved ? 'resolved' : 'unresolved', page: 'all', keywords: linked.number !== undefined ? `#${linked.number}` : undefined });
            setSidebarOpen(true);
            announce('This comment uses an earlier page-state setting. Its saved details are in the inbox.');
            return;
        }
        if (linked.resolved || linked.position.type === 'page') {
            showInSidebar(linked.resolved ? 'resolved' : 'unresolved');
        } else {
            setOpenComment({ id: linked.id });
        }
    }, [allComments, linkedCommentId, linkedSite.data, linkedSite.isSuccess, path, announce]);

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
        awaitingThreadRef.current = undefined;
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
            awaitingThreadRef.current = undefined;
            setReattaching(undefined);
            closeHintForUse();
        }
    };

    // The reviewed project in the uier app: the script's project, whose comments these are, else
    // the review link's code (`?review=true` on a project's site still has a project)
    const projectCode = review ? toolbarConfig.project ?? review.projectCode : undefined;
    const projectUrl = projectCode
        ? `${toolbarConfig.apiUrl}/app/projects/${encodeURIComponent(projectCode)}`
        : undefined;

    const candidatePlacement = reattaching?.candidate ? getCommentPlacement(reattaching.candidate) : undefined;
    return (
        <ReattachContext.Provider value={requestReattach}>
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
                        <CommentErrorBoundary key={commentKey(commentItem)} commentId={commentItem.id}>
                            <CommentBubble
                                commentItem={commentItem}
                                onOpenStateChange={handleThreadOpenState}
                                autoOpen={openCommentId === commentItem.id}
                                onAutoOpened={handleAutoOpened} />
                        </CommentErrorBoundary>
                    ))}
                </section>
            )}
            {!collapsed && creatingComments.map(creatingComment => (
                <CommentErrorBoundary key={`new-${creatingComment.key}`}>
                    <CommentBubble
                        draft={creatingComment}
                        initiallyClosed={creatingComment.initiallyClosed}
                        draftPinOffset={pinnedComments.some(comment => resolveAnchorElement(comment.position) === resolveAnchorElement(creatingComment.position)) ? 36 : 0}
                        onCreated={localId => handleCreated(localId, creatingComment.key)}
                        onSaved={handleSaved}
                        onSendFailed={error => restoreCreatingComment(creatingComment.kind, error)}
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
                <InkScope>
                    {reattaching.mode ? <div className="fixed top-4 left-1/2 z-[60] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border bg-background p-3 text-sm text-foreground" role="region" aria-label="Choose new anchor">
                        <p role="status" className="m-0">{reattaching.mode === 'point' ? 'Click an element, or focus it and press Enter.' : 'Select text on the page, then use the selection.'}</p>
                        <div className="mt-2 flex gap-2">
                            {reattaching.mode === 'text' && <Button size="sm" className="min-h-11" disabled={!reattaching.candidate} onClick={() => setReattaching({ ...reattaching, mode: undefined })}>Use selected text</Button>}
                            <Button size="sm" variant="plain" className="min-h-11" onClick={finishReattach}>Cancel</Button>
                        </div>
                    </div> : <DockablePanel id="inbox" label="Reattach comment" onKeyDown={event => {
                        if (event.key === 'Escape' && !reattach.isPending) { event.stopPropagation(); finishReattach(); }
                    }}>
                        <div className="h-full overflow-y-auto p-4 text-sm">
                            <h2 className="m-0 text-base font-semibold">Reattach comment</h2>
                            <p>Choose an element or select text on this page. Confirm to move the anchor. Messages and saved evidence stay the same.</p>
                            <div className="flex flex-wrap gap-2">
                                <Button autoFocus size="sm" variant="outlined" className="min-h-11" disabled={reattach.isPending}
                                    onClick={() => setReattaching({ ...reattaching, mode: 'point', candidate: undefined })}>Choose element</Button>
                                <Button size="sm" variant="outlined" className="min-h-11" disabled={reattach.isPending}
                                    onClick={() => { window.getSelection()?.removeAllRanges(); setReattaching({ ...reattaching, mode: 'text', candidate: undefined }); }}>Choose text</Button>
                            </div>
                            <p role="status">{reattaching.candidate ? 'Review the new anchor, then confirm.' : 'Choose how to select the new target.'}</p>
                            {reattaching.candidate && <>
                                <p className="break-words" data-uier-anchor-candidate="">{describeAnchor(reattaching.candidate)}</p>
                                <p>{candidatePlacement && anchorStateText[candidatePlacement.state]}</p>
                            </>}
                            {reattach.error instanceof CommentsApiError && reattach.error.status === 409
                                ? <p role="alert" className="text-sm">The anchor changed. Start again to review the latest anchor.</p>
                                : <CommentsErrorMessage error={reattach.error} />}
                            {reattach.error instanceof CommentsApiError && reattach.error.status === 409 && <Button variant="outlined" size="sm" className="min-h-11" onClick={() => {
                                const latest = allComments?.find(comment => comment.id === reattaching.comment.id);
                                if (latest) requestReattach(latest);
                            }}>Start again</Button>}
                            <div className="mt-4 flex gap-2">
                                <Button size="sm" className="min-h-11" disabled={reattach.isPending || !candidatePlacement?.rects.length || candidatePlacement.state !== 'exact'} onClick={() => void saveAnchor()}>Confirm anchor</Button>
                                <Button size="sm" variant="plain" className="min-h-11" disabled={reattach.isPending} onClick={finishReattach}>Cancel</Button>
                            </div>
                        </div>
                    </DockablePanel>}
                </InkScope>
            </>}
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
                commentsCount={activityQuery.data?.unread ?? 0}
                hintOpen={hintOpen}
                hintId={hintId}
                projectUrl={projectUrl}
                addButtonRef={addButtonRef}
                inboxButtonRef={inboxButtonRef}
                hintButtonRef={hintButtonRef}
                onAddPointComment={handleAddPointComment}
                onCancelPointComment={() => { setCreatingCommentPoint(false); addButtonRef.current?.focus(); }}
                sidebarOpen={sidebarOpen}
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
                onExitReview={onExitReview} />
            {/* After the pill, so forward Tab from "About uier" reaches it */}
            {hintOpen && !collapsed && (toolbarConfig.project || visitor.data) && (
                <ShowcaseHint id={hintId} pointAtRef={addButtonRef} onDismiss={handleDismissHint} access={project.access} brief={project.brief} privateAppFeedback={visitor.data?.privateAppFeedback} />
            )}
            <Toaster />
        </ReattachContext.Provider>
    );
}
