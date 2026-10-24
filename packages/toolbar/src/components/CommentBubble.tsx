'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { orderBy } from '@signalco/js';
import { useComments } from '../hooks/useComments';
import { resolveAnchorElement, useCommentPlacement } from '../hooks/useCommentItemRects';
import { newCommentDraftKey, useDrafts } from '../hooks/useDrafts';
import { CommentThread } from './CommentThread';
import { CommentComposer } from './CommentComposer';
import { CommentSelectionHighlight } from './CommentSelectionHighlight';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentIcon } from './CommentIcon';
import { useAnnounce } from './Announcer';
import { getDeviceInfo } from './info/getDeviceInfo';
import { CommentDraft, CommentItem, commentTextMaxLength, floatingShadowClassName } from './@types/Comments';

// Bubble (CommentIcon) half size and its minimal distance from the left and right window edges
const bubbleHalfSize = 16;
const bubbleWindowMargin = 4;

/**
 * Space the thread popover keeps from the window edges. The bottom leaves room for the toolbar
 * pill (bottom-4, 48px tall), so the reply box is never underneath it.
 */
const popoverCollisionPadding = { top: 8, left: 8, right: 8, bottom: 80 };

/** Keeps the bubble inside the window horizontally, e.g. for text that ends at the right edge on mobile */
function bubbleLeft(rect: DOMRect | undefined) {
    const left = (rect?.right ?? 0) + 16;
    const min = bubbleHalfSize + bubbleWindowMargin;
    const max = document.documentElement.clientWidth - bubbleHalfSize - bubbleWindowMargin;
    return max > min ? Math.min(Math.max(left, min), max) : left;
}

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type CommentBubbleProps = {
    /** Opens the thread once the pin is on the page (a comment that was just posted, or a comment link) */
    autoOpen?: boolean;
    onAutoOpened?: () => void;
    onCreated?: (comment: CommentItem) => void;
    onCanceled?: () => void;
    className?: string;
} & (
    /** A saved comment */
    | { commentItem: CommentItem; draft?: undefined }
    /** A new comment that is being written */
    | { commentItem?: undefined; draft: CommentDraft }
);

export function CommentBubble(props: CommentBubbleProps) {
    const { autoOpen, onAutoOpened, onCreated, onCanceled, className } = props;
    const commentItem = props.commentItem;
    const creating = !commentItem;
    const position = props.commentItem ? props.commentItem.position : props.draft.position;
    const draftKey = commentItem ? commentItem.id : newCommentDraftKey;

    const { rootElement } = useContext(CommentsBootstrapperContext);
    const drafts = useDrafts();
    const announce = useAnnounce();
    const triggerRef = useRef<HTMLButtonElement>(null);
    // A text comment whose text is gone gets its pin on the closest element that is still there
    const { rects: placementRects, textMissing } = useCommentPlacement(position);
    const lastRect = orderBy(placementRects, r => r.bottom).at(-1);
    const { create, reply } = useComments();
    const mutation = creating ? create : reply;
    // A deleted first item ("Comment deleted") is not a message
    const messagesCount = commentItem?.thread.items.filter(item => !item.deleted).length ?? 0;

    const handleSubmit = async (text: string) => {
        if (props.commentItem) {
            await reply.mutateAsync({ commentId: props.commentItem.id, text });
            drafts.delete(draftKey);
            announce('Reply posted');
            return;
        }

        const draft = props.draft;
        const quotedText = draft.position.type === 'text'
            ? draft.position.text.trim().slice(0, commentTextMaxLength)
            : undefined;
        const created = await create.mutateAsync({
            position: draft.position,
            text,
            quotedText: quotedText || undefined,
            // The viewport as it is when the comment is posted
            device: getDeviceInfo()
        });
        drafts.delete(draftKey);
        announce('Comment posted');
        onCreated?.(created);
    };

    const [open, setOpen] = useState(creating);
    const handleOpenChange = (open: boolean) => {
        if (!open) {
            mutation.reset();
            // A new comment with text stays on the page as a draft pin; reopening it brings the text back
            if (creating && !drafts.get(draftKey)?.trim().length) {
                onCanceled?.();
            }
        }
        setOpen(open);
    };

    const handleDiscard = () => {
        mutation.reset();
        onCanceled?.();
    };

    // The thread opens (and takes the focus, its reply box) once the pin is on the page; a pin
    // outside the window (a comment link) is scrolled into view first
    const hasRect = Boolean(lastRect);
    useEffect(() => {
        if (autoOpen && hasRect) {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
                resolveAnchorElement(position)?.scrollIntoView({ block: 'center', behavior: 'auto' });
            }
            setOpen(true);
            onAutoOpened?.();
        }
    }, [autoOpen, hasRect, onAutoOpened, position]);

    // Bubbles are fixed to their anchor; when one gets the focus off-screen, scroll it into view
    const handleFocus = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect || (rect.top >= 0 && rect.bottom <= window.innerHeight)) {
            return;
        }
        resolveAnchorElement(position)?.scrollIntoView({
            block: 'center',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth'
        });
    };

    // The commented element is not on the page (anymore), e.g. a different layout on this device
    if (!lastRect && !creating) {
        return null;
    }

    return (
        <>
            {position.type === 'text' && (
                <CommentSelectionHighlight
                    commentSelection={position}
                    commentId={commentItem?.id}
                    onClick={commentItem ? () => setOpen(true) : undefined} />
            )}
            <Popper
                container={rootElement}
                trigger={(
                    <button
                        ref={triggerRef}
                        type="button"
                        data-uier-comment={commentItem?.id ?? newCommentDraftKey}
                        aria-label={creating
                            ? 'New comment'
                            : `Comment, ${messagesCount} ${messagesCount === 1 ? 'message' : 'messages'}${textMissing ? '. The commented text is no longer on the page' : ''}`}
                        onFocus={handleFocus}
                        className={cx(
                            'fixed z-[48] hover:z-[49] cursor-pointer rounded-full',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                            className
                        )}
                        style={{
                            left: bubbleLeft(lastRect),
                            top: (lastRect?.bottom ?? 0) + 16,
                            transform: 'translate(-50%, -50%)',
                            willChange: 'left, top'
                        }}>
                        <CommentIcon aria-hidden="true" className="hover:scale-110 hover:brightness-75" />
                        <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-semibold tabular-nums text-white">
                            {creating ? '' : messagesCount}
                        </span>
                    </button>
                )}
                aria-label={creating ? 'New comment' : 'Comment thread'}
                // Bounded by the space the window has left, so the reply box always stays visible
                className={cx(
                    'flex max-h-[min(var(--radix-popover-content-available-height),36rem)] flex-col overflow-hidden rounded-xl',
                    floatingShadowClassName
                )}
                sideOffset={-32}
                align="start"
                alignOffset={32}
                open={open}
                onOpenChange={handleOpenChange}
                // Passed through to the Radix popover content (the Popper's own value is derived from the offsets)
                {...{ collisionPadding: popoverCollisionPadding }}
            >
                {commentItem && (
                    <>
                        {textMissing && (
                            <p className="m-0 shrink-0 px-4 pt-3 text-xs text-muted-foreground">
                                The commented text is no longer on the page.
                            </p>
                        )}
                        {/* Focusable so the thread can be scrolled with the keyboard */}
                        <div
                            tabIndex={0}
                            aria-label="Messages"
                            role="group"
                            className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <CommentThread commentItem={commentItem} />
                        </div>
                        <Divider className="shrink-0" />
                    </>
                )}
                <div className="shrink-0">
                    <CommentComposer
                        label={creating ? 'Comment' : 'Reply'}
                        placeholder={creating ? 'Leave feedback...' : 'Reply...'}
                        submitLabel={creating ? 'Post comment' : 'Post reply'}
                        draftKey={draftKey}
                        quote={props.draft?.position.type === 'text' ? props.draft.position.text : undefined}
                        autoFocus
                        pending={mutation.isPending}
                        error={mutation.error}
                        onSubmit={handleSubmit}
                        onDiscard={creating ? handleDiscard : undefined} />
                </div>
            </Popper>
        </>
    );
}
