import { useRef, useState } from 'react';
import { getElementSelector } from '@signalco/js';
import { useWindowEvent } from '@signalco/hooks/useWindowEvent';
import { useDocumentEvent } from '@signalco/hooks/useDocumentEvent';
import { useComments } from '../hooks/useComments';
import { useCommentItemRects } from '../hooks/useCommentItemRects';
import { CommentsSidebar } from './sidebar/CommentsSidebar';
import { CommentToolbar } from './CommentToolbar';
import { CommentSelectionPopover } from './CommentSelectionPopover';
import { CommentSelectionHighlight } from './CommentSelectionHighlight';
import { CommentPointOverlay } from './CommentPointOverlay';
import { CommentBubble } from './CommentBubble';
import { isShowcaseHintDismissed, rememberShowcaseHintDismissed, ShowcaseHint } from './ShowcaseHint';
import { getDeviceInfo } from './info/getDeviceInfo';
import { CommentsGlobalProps, CommentSelection, CommentPoint, CommentDraft } from './@types/Comments';

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

export function CommentsGlobal({
    mode,
    reviewParamKey = 'review',
    rootElement
}: CommentsGlobalProps) {
    const [creatingCommentSelection, setCreatingCommentSelection] = useState<CommentSelection>();
    const [creatingComment, setCreatingComment] = useState<CommentDraft>();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [hintOpen, setHintOpen] = useState(() => mode === 'showcase' && !isShowcaseHintDismissed());
    const hintButtonRef = useRef<HTMLButtonElement>(null);

    const { query: commentItems } = useComments();
    const unresolvedComments = (commentItems.data ?? []).filter(c => !c.resolved);

    const [creatingCommentPoint, setCreatingCommentPoint] = useState(false);

    useWindowEvent('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Escape' && (creatingCommentSelection || creatingCommentPoint)) {
            event.stopPropagation();
            event.preventDefault();
            setCreatingCommentPoint(false);
            setCreatingCommentSelection(undefined);
        }
    }, [creatingCommentSelection, creatingCommentPoint]);

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

    const handleCreateComment = async () => {
        if (!creatingCommentSelection) {
            return;
        }

        setCreatingCommentSelection(undefined);
        setCreatingComment({
            position: creatingCommentSelection,
            device: getDeviceInfo()
        });
    };

    const handleCreateCommentPoint = async (commentPoint: CommentPoint) => {
        setCreatingCommentPoint(false);
        setCreatingComment({
            position: commentPoint,
            device: getDeviceInfo()
        });
    };

    const handleExitReview = () => {
        const url = new URL(window.location.href);
        url.searchParams.delete(reviewParamKey);
        window.history.replaceState({}, '', url.toString());
    };

    const handleDismissHint = (hadFocus: boolean) => {
        rememberShowcaseHintDismissed();
        setHintOpen(false);
        // Keep the keyboard focus in the toolbar
        if (hadFocus) {
            hintButtonRef.current?.focus();
        }
    };

    return (
        <>
            {unresolvedComments.map((commentItem) => (
                <CommentBubble
                    key={commentItem.id}
                    commentItem={commentItem} />
            ))}
            {creatingComment && (
                <CommentBubble
                    key="new"
                    draft={creatingComment}
                    onCreated={() => setCreatingComment(undefined)}
                    onCanceled={() => setCreatingComment(undefined)} />
            )}
            {creatingCommentSelection && (
                <CommentSelectionHighlight commentSelection={creatingCommentSelection} />
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
                    onClose={() => setSidebarOpen(false)}
                    rootElement={rootElement}
                />
            )}
            {mode === 'showcase' && hintOpen && (
                <ShowcaseHint onDismiss={handleDismissHint} />
            )}
            <CommentToolbar
                mode={mode}
                creatingPointComment={creatingCommentPoint}
                commentsCount={unresolvedComments.length}
                hintOpen={hintOpen}
                hintButtonRef={hintButtonRef}
                onAddPointComment={() => setCreatingCommentPoint((curr) => !curr)}
                onShowSidebar={() => setSidebarOpen(true)}
                onToggleHint={() => hintOpen ? handleDismissHint(false) : setHintOpen(true)}
                onExitReview={handleExitReview} />
        </>
    );
}
