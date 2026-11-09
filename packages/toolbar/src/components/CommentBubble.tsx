'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { Pin, pinLabel } from '@uier/brand';
import { newLocalId, useComments } from '../hooks/useComments';
import { lowestRect, resolveAnchorElement, useCommentPlacement } from '../hooks/useCommentItemRects';
import { cancelCommentScreenshot, captureCommentScreenshot } from '../screenshot';
import { newCommentDraftKey, newRewriteDraftKey, useDrafts } from '../hooks/useDrafts';
import { CommentThread } from './CommentThread';
import { CommentComposer, type CommentComposerHandle } from './CommentComposer';
import { CommentSelectionHighlight } from './CommentSelectionHighlight';
import { CommentAreaHighlight } from './CommentAreaHighlight';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { useAnnounce } from './Announcer';
import { getDeviceInfo } from './info/getDeviceInfo';
import { holdsLayersAttribute, isToolbarAnchor, pressableToolbarOpener, toolbarPinId, toolbarSurface } from '../toolbarReview';
import { RewriteSuggestions } from './RewriteSuggestions';
import { ComposerAttachButton, ComposerAttachmentsHeader, useAttachedImage, type AttachedImage } from './ComposerAttachments';
import { ComposerModal, ExpandComposerButton } from './ComposerModal';
import { CommentDraft, CommentItem, CommentItemPosition, commentTextMaxLength, floatingShadowClassName, isCommentArea } from './@types/Comments';

// Bubble (the pin) half size, how far its message count badge reaches past the right edge (Pin,
// @uier/brand) and its minimal distance from the left and right window edges
const bubbleHalfSize = 16;
const bubbleBadgeOverhang = 5;
const bubbleWindowMargin = 4;

/**
 * Space the thread popover keeps from the window edges. The bottom leaves room for the toolbar
 * pill (bottom-4, 48px tall), so the reply box is never underneath it.
 */
const popoverCollisionPadding = { top: 8, left: 8, right: 8, bottom: 80 };

/** Keeps the bubble inside the window horizontally, e.g. for text that ends at the right edge on mobile */
function bubbleLeft(rect: DOMRect | undefined) {
    const left = (rect?.right ?? 0) + 16;
    const halfHitArea = window.matchMedia('(pointer: coarse)').matches ? 22 : bubbleHalfSize;
    const min = halfHitArea + bubbleWindowMargin;
    const max = document.documentElement.clientWidth - Math.max(halfHitArea, bubbleHalfSize + bubbleBadgeOverhang) - bubbleWindowMargin;
    return max > min ? Math.min(Math.max(left, min), max) : left;
}

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scrolls a comment's place into the middle of the window: its element, or an area itself (its
 * element can be much larger). An area taller than half the window brings its pin, at the bottom.
 */
function scrollAnchorIntoView(position: CommentItemPosition, rect: DOMRect | undefined, behavior: ScrollBehavior, closed = false) {
    // An area, and the opener of the closed menu that holds the anchor, by the placed rectangle
    if ((isCommentArea(position) || closed) && rect) {
        const target = rect.height <= window.innerHeight / 2 ? rect.top + rect.height / 2 : rect.bottom;
        window.scrollBy({ top: target - window.innerHeight / 2, behavior });
        return;
    }
    resolveAnchorElement(position)?.scrollIntoView({ block: 'center', behavior });
}

type CommentBubbleProps = {
    /** Opens the thread once the pin is on the page (a comment that was just posted, or a comment link) */
    autoOpen?: boolean;
    /** Opened with J or K, going from thread to thread: the messages take the focus, not the reply box */
    autoOpenReading?: boolean;
    initiallyClosed?: boolean;
    /** Keep a recovered draft reachable beside saved pins on the same element. */
    draftPinOffset?: number;
    onAutoOpened?: () => void;
    /** With the comment's id, or a draft's key (see hooks/useDrafts.tsx) */
    onOpenStateChange?: (commentId: string, open: boolean) => void;
    /** The comment was sent: its temporary id, its pin shown at once (see hooks/useComments.tsx) */
    onCreated?: (localId: string) => void;
    /**
     * A comment just sent from a draft: its thread is open from the start, in place of the draft's
     * popover, without the opening animation (one popover that goes on, not one closing and another opening)
     */
    continuesDraft?: boolean;
    /** Sending failed: the draft (its text is back, the choice to omit its screenshot and its attached image) should be on the page again */
    onSendFailed?: (error: unknown, choice: { omitScreenshot: boolean; image?: AttachedImage }) => void;
    onCanceled?: () => void;
    className?: string;
} & (
    /** A saved comment */
    | { commentItem: CommentItem; draft?: undefined }
    /** A new comment that is being written */
    | { commentItem?: undefined; draft: CommentDraft }
);

export function CommentBubble(props: CommentBubbleProps) {
    const { autoOpen, autoOpenReading = false, continuesDraft = false, onAutoOpened, onCreated, onSendFailed, onCanceled, onOpenStateChange, className } = props;
    const commentItem = props.commentItem;
    const creating = !commentItem;
    const position = props.commentItem ? props.commentItem.position : props.draft.position;
    // A rewrite suggestion: the suggested text for the selected text, instead of a comment
    const rewriting = props.draft?.kind === 'rewrite';
    const selectedText = props.draft?.position.type === 'text' ? props.draft.position.text : undefined;
    const draftKey = commentItem ? commentItem.id : (rewriting ? newRewriteDraftKey : newCommentDraftKey);
    const newLabel = rewriting ? 'New rewrite suggestion' : 'New comment';
    // Picking a suggestion replaces the text in the text box (as if typed, so it can be undone)
    const composerRef = useRef<CommentComposerHandle>(null);

    const { rootElement } = useContext(CommentsBootstrapperContext);
    const drafts = useDrafts();
    const announce = useAnnounce();
    const triggerRef = useRef<HTMLButtonElement>(null);
    // Missing, ambiguous and hidden anchors have no pin; their threads stay in the inbox. An anchor in
    // a closed menu, popover or dialog has its pin on the element that opens it.
    const { rects: placementRects, state: placementState, opener: closedOpener } = useCommentPlacement(position);
    const closedLayer = placementState === 'closed';
    const lastRect = lowestRect(placementRects);
    const { create, reply } = useComments();
    const [capture, setCapture] = useState<{ device: ReturnType<typeof getDeviceInfo>; screenshot: Promise<string | undefined> | undefined }>();
    useEffect(() => {
        if (creating) setCapture({
            device: props.draft.device ?? getDeviceInfo(),
            screenshot: props.draft.screenshot ?? captureCommentScreenshot(position, rootElement)
        });
    }, [creating, position, rootElement, props.draft]);
    const [omitScreenshot, setOmitScreenshot] = useState(props.draft?.omitScreenshot ?? false);
    // The reviewer's own image, sent instead of the automatic screenshot
    const attachment = useAttachedImage(props.draft?.image);
    // Omitted while it is taken: its work stops. Attached after all: a new one is taken.
    const handleOmittedChange = (omitted: boolean) => {
        setOmitScreenshot(omitted);
        if (omitted && cancelCommentScreenshot(capture?.screenshot)) {
            setCapture(current => current && { ...current, screenshot: undefined });
        } else if (!omitted && capture && !capture.screenshot) {
            setCapture({ ...capture, screenshot: captureCommentScreenshot(position, rootElement) });
        }
    };
    const mutation = creating ? create : reply;
    // A deleted first item ("Comment deleted") is not a message, nor is one still on its way
    const messagesCount = commentItem?.thread.items.filter(item => !item.deleted && !item.pending).length ?? 0;
    const sending = Boolean(commentItem?.pending);

    const handleSubmit = async (text: string, mentions?: import('./@types/Comments').Mention[]) => {
        if (props.commentItem) {
            await reply.mutateAsync({ commentId: props.commentItem.id, text, mentions });
            announce('Reply posted');
            return;
        }

        const draft = props.draft;
        const quotedText = draft.position.type === 'text'
            ? draft.position.text.trim().slice(0, commentTextMaxLength)
            : undefined;
        const localId = newLocalId();
        const posting = create.mutateAsync({
            localId,
            position: draft.position,
            kind: rewriting ? 'rewrite' : undefined,
            text,
            mentions,
            quotedText: quotedText || undefined,
            // The original viewport, alongside the automatic capture, even after resizing.
            device: capture?.device ?? getDeviceInfo(),
            screenshot: attachment.screenshotFor(omitScreenshot, capture?.screenshot)
        });
        // The draft pin makes way for the comment's, shown at once with its thread open
        onCreated?.(localId);
        try {
            await posting;
        } catch (error) {
            // After the composer has put the text back
            window.setTimeout(() => onSendFailed?.(error, { omitScreenshot, image: attachment.image }), 0);
            throw error;
        }
        announce(rewriting ? 'Suggestion posted' : 'Comment posted');
    };

    const [open, setOpen] = useState(creating ? !props.initiallyClosed : continuesDraft);
    // Until it is closed: opening it again animates as usual
    const [continuing, setContinuing] = useState(continuesDraft);
    // A new comment expanded to a modal for focused writing: the popover is closed meanwhile, the form goes on
    const [expanded, setExpandedState] = useState(false);
    // At once: the popover's own close (the focus moving into the modal) comes before the next render
    const expandedRef = useRef(false);
    const setExpanded = (next: boolean) => { expandedRef.current = next; setExpandedState(next); };
    // Opened with J or K: the messages have the focus, so the keys go on to the next thread instead of typing
    const [reading, setReading] = useState(false);
    const messagesRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (open && reading) messagesRef.current?.focus();
    }, [open, reading]);
    // A saved comment's id, or a draft's key
    const openStateId = commentItem?.id ?? draftKey;
    useEffect(() => {
        if (!onOpenStateChange) return;
        onOpenStateChange(openStateId, open);
        return () => onOpenStateChange(openStateId, false);
    }, [openStateId, open, onOpenStateChange]);
    const handleOpenChange = (open: boolean) => {
        setContinuing(false);
        setExpanded(false);
        if (open && creating) setCapture({ device: getDeviceInfo(), screenshot: captureCommentScreenshot(position, rootElement) });
        if (!open) {
            mutation.reset();
            setReading(false);
            // A new comment with text stays on the page as a draft pin; reopening it brings the text
            // back. A rewrite whose text is still the selected text has nothing to keep.
            const text = drafts.get(draftKey)?.trim();
            if (creating && (!text?.length || (rewriting && text === selectedText?.trim()))) {
                drafts.delete(draftKey);
                onCanceled?.();
            }
        }
        setOpen(open);
    };

    const handleDiscard = () => {
        mutation.reset();
        drafts.delete(draftKey);
        onCanceled?.();
    };

    // On uier's own pages: a comment on a part of the toolbar, whose pin, thread and composer keep
    // that part's popover open, above the toolbar's popovers and menus (toolbarReview.ts)
    const onToolbar = isToolbarAnchor(position);
    const holdsLayers = onToolbar ? { [holdsLayersAttribute]: '' } : {};

    // The thread opens (and takes the focus, its reply box) once the pin is on the page; a pin
    // outside the window (a comment link) is scrolled into view first. A comment in a closed
    // popover or panel of the toolbar opens it first, with the button that opens it, and nested
    // ones layer by layer from the outside in: each press waits for its layer to render, where the
    // pin moves on to the next closed opener (useCommentItemRects.tsx).
    const hasRect = Boolean(lastRect);
    const pressedOpenersRef = useRef<Element[]>([]);
    useEffect(() => {
        if (!autoOpen) {
            pressedOpenersRef.current = [];
            return;
        }
        const opener = closedLayer && onToolbar ? pressableToolbarOpener(closedOpener) : undefined;
        if (opener && hasRect && !pressedOpenersRef.current.includes(opener)) {
            pressedOpenersRef.current.push(opener);
            opener.click();
            return;
        }
        if (hasRect) {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
                scrollAnchorIntoView(position, lastRect, 'auto', closedLayer);
            }
            setReading(autoOpenReading);
            setOpen(true);
            onAutoOpened?.();
        }
    }, [autoOpen, autoOpenReading, hasRect, closedLayer, closedOpener, onToolbar, onAutoOpened, position]);

    // Bubbles are fixed to their anchor; when one gets the focus off-screen, scroll it into view
    const handleFocus = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect || (rect.top >= 0 && rect.bottom <= window.innerHeight)) {
            return;
        }
        scrollAnchorIntoView(position, lastRect, prefersReducedMotion() ? 'auto' : 'smooth', closedLayer);
    };

    // The commented element is not on the page (anymore), e.g. a different layout on this device
    if (!lastRect && !creating) {
        return null;
    }

    // Bounded by the space the window has left, so the reply box always stays visible
    const popoverClassName = cx(
        onToolbar ? 'z-[78]' : 'z-[60]',
        'flex max-h-[min(var(--radix-popover-content-available-height),36rem)] flex-col rounded-xl',
        // A rewrite (text box and suggestions) scrolls as a whole: when it is clipped, the
        // browser would scroll the page to show the caret, and the popover follows its pin
        rewriting ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden',
        // In place of the draft's popover, already on the page
        continuing && 'data-[state=open]:animate-none!',
        // Expanding: gone at once, the modal is there
        expanded && 'data-[state=closed]:animate-none!',
        floatingShadowClassName
    );

    // A pasted image file is attached to a new comment, instead of its screenshot
    const composer = (
        <div className="shrink-0" onPaste={creating ? attachment.handlePaste : undefined}>
            {creating && (
                <ComposerAttachmentsHeader
                    title={<span className="text-sm font-semibold text-foreground">{newLabel}</span>}
                    screenshot={capture?.screenshot}
                    omitted={omitScreenshot}
                    onOmittedChange={handleOmittedChange}
                    attachment={attachment}
                    actions={<ExpandComposerButton expanded={expanded} onExpandedChange={setExpanded} />} />
            )}
            <CommentComposer
                commentId={commentItem?.id}
                ref={composerRef}
                label={rewriting ? 'Suggested text' : (creating ? 'Comment' : 'Reply')}
                placeholder={rewriting ? 'Your version of the text...' : (creating ? 'Leave feedback...' : 'Reply...')}
                submitLabel={rewriting ? 'Post suggestion' : (creating ? 'Post comment' : 'Post reply')}
                draftKey={draftKey}
                quote={selectedText}
                // Not when it appears in a thread that is closing (its comment was saved after
                // Escape): the focus, and a page selection made meanwhile, stay where they are
                autoFocus={open && !reading}
                tall={expanded}
                error={mutation.error ?? props.draft?.sendError}
                holdSubmit={creating && attachment.reading}
                // Replies wait until the comment is saved (they need its id); the reply box
                // is there already, so the thread keeps its size and the focus stays in it
                waiting={sending}
                attachments={creating ? <ComposerAttachButton attachment={attachment} /> : undefined}
                onSubmit={handleSubmit}
                onDiscard={creating ? handleDiscard : undefined} />
        </div>
    );
    const suggestions = rewriting && selectedText && (
        <div className="shrink-0">
            <RewriteSuggestions
                text={selectedText}
                onPick={(suggestion) => composerRef.current?.replaceText(suggestion)} />
        </div>
    );

    return (
        <>
            {creating && open && expanded && (
                <ComposerModal container={rootElement} label={newLabel} onCollapse={() => setExpanded(false)} {...holdsLayers}>
                    {composer}
                    {suggestions}
                </ComposerModal>
            )}
            {position.type === 'text' && (
                <CommentSelectionHighlight
                    commentSelection={position}
                    commentId={commentItem?.id}
                    onClick={commentItem ? () => setOpen(true) : undefined} />
            )}
            {isCommentArea(position) && lastRect && !closedLayer && (
                <CommentAreaHighlight rect={lastRect} commentId={commentItem?.id} active={open} />
            )}
            <Popper
                container={rootElement}
                trigger={(
                    <button
                        ref={triggerRef}
                        type="button"
                        // Names the pin when it opens the thread a comment on the toolbar is in
                        id={commentItem && !sending ? toolbarPinId(commentItem.id) : undefined}
                        data-uier-comment={commentItem?.id ?? newCommentDraftKey}
                        {...holdsLayers}
                        // The same number as the thread header, the inbox and the app ("Comment #6, 3 messages")
                        aria-label={creating
                            ? newLabel
                            : sending
                                ? 'Comment, sending'
                                : pinLabel({ number: commentItem.number, messages: messagesCount, done: commentItem.resolved })}
                        onFocus={handleFocus}
                        className={cx(
                            'group fixed cursor-pointer rounded-full pointer-coarse:p-1.5',
                            // A hovered or focused pin comes in front of the pins it overlaps
                            onToolbar ? 'z-[75] hover:z-[76] focus-visible:z-[76]' : 'z-[48] hover:z-[49] focus-visible:z-[49]',
                            sending && 'opacity-70',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                            className
                        )}
                        style={{
                            left: bubbleLeft(lastRect),
                            top: (lastRect?.bottom ?? 0) + 16 + (creating ? props.draftPinOffset ?? 0 : 0),
                            transform: 'translate(-50%, -50%)',
                            willChange: 'left, top'
                        }}>
                        {/* The thread's number, the one people quote; the message count is the badge */}
                        <Pin
                            aria-hidden="true"
                            number={creating || sending ? undefined : commentItem.number}
                            messages={creating || sending ? undefined : messagesCount}
                            style={{ display: 'block' }}
                            className="group-hover:scale-110 group-hover:brightness-75" />
                    </button>
                )}
                aria-label={creating ? newLabel : sending ? 'Sending comment' : 'Comment thread'}
                {...holdsLayers}
                // A saved thread is a part of the toolbar that can be reviewed on uier's own pages; the
                // comment being written is not
                {...(commentItem ? toolbarSurface('uier-thread', popoverClassName) : { className: popoverClassName })}
                // A saved thread: R, S and A act on it (`threadShortcuts.ts`)
                {...(commentItem && { 'data-uier-thread-scope': '' })}
                sideOffset={-32}
                align="start"
                alignOffset={32}
                open={open && !expanded}
                // Not while expanded: the popover makes way for the modal, which has the focus now
                onOpenChange={next => { if (next || !expandedRef.current) handleOpenChange(next); }}
                // Passed through to the Radix popover content (the Popper's own value is derived from the offsets)
                {...{ collisionPadding: popoverCollisionPadding }}
            >
                {commentItem && (
                    <>
                        {/* Focusable so the thread can be scrolled with the keyboard */}
                        <div
                            ref={messagesRef}
                            tabIndex={0}
                            aria-label="Messages"
                            role="group"
                            className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <CommentThread commentItem={commentItem} reading={open} onPage />
                        </div>
                        <Divider className="shrink-0" />
                    </>
                )}
                {composer}
                {suggestions}
            </Popper>
        </>
    );
}
