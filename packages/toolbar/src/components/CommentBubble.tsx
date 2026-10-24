'use client';

import { useContext, useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { orderBy } from '@signalco/js';
import { useComments } from '../hooks/useComments';
import { useCommentItemRects } from '../hooks/useCommentItemRects';
import { CommentThread } from './CommentThread';
import { CommentComposer } from './CommentComposer';
import { CommentSelectionHighlight } from './CommentSelectionHighlight';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentIcon } from './CommentIcon';
import { CommentDraft, CommentItem, commentTextMaxLength } from './@types/Comments';

// Bubble (CommentIcon) half size and its minimal distance from the left and right window edges
const bubbleHalfSize = 16;
const bubbleWindowMargin = 4;

/** Keeps the bubble inside the window horizontally, e.g. for text that ends at the right edge on mobile */
function bubbleLeft(rect: DOMRect | undefined) {
    const left = (rect?.right ?? 0) + 16;
    const min = bubbleHalfSize + bubbleWindowMargin;
    const max = document.documentElement.clientWidth - bubbleHalfSize - bubbleWindowMargin;
    return max > min ? Math.min(Math.max(left, min), max) : left;
}

type CommentBubbleProps = {
    defaultOpen?: boolean;
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
    const { defaultOpen, onCreated, onCanceled, className } = props;
    const commentItem = props.commentItem;
    const creating = !commentItem;
    const position = props.commentItem ? props.commentItem.position : props.draft.position;

    const { rootElement } = useContext(CommentsBootstrapperContext);
    const selectionRects = useCommentItemRects(position);
    const lastRect = orderBy(selectionRects, r => r.bottom).at(-1);
    const { create, reply } = useComments();
    const mutation = creating ? create : reply;
    const messagesCount = commentItem?.thread.items.length ?? 0;

    const handleSubmit = async (text: string) => {
        if (props.commentItem) {
            await reply.mutateAsync({ commentId: props.commentItem.id, text });
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
            device: draft.device
        });
        onCreated?.(created);
    };

    const [open, setOpen] = useState(creating || Boolean(defaultOpen));
    const handleOpenChange = (open: boolean) => {
        if (!open) {
            mutation.reset();
            if (creating) {
                onCanceled?.();
            }
        }
        setOpen(open);
    };

    // The commented element is not on the page (anymore), e.g. a different layout on this device
    if (!lastRect && !creating) {
        return null;
    }

    return (
        <>
            {position.type === 'text' && (
                <CommentSelectionHighlight commentSelection={position} />
            )}
            <Popper
                container={rootElement}
                trigger={(
                    <button
                        type="button"
                        aria-label={creating
                            ? 'New comment'
                            : `Comment, ${messagesCount} ${messagesCount === 1 ? 'message' : 'messages'}`}
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
                            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-semibold text-white">
                            {creating ? '' : messagesCount}
                        </span>
                    </button>
                )}
                aria-label={creating ? 'New comment' : 'Comment thread'}
                className="overflow-hidden"
                sideOffset={-32}
                align="start"
                alignOffset={32}
                open={open}
                onOpenChange={handleOpenChange}
            >
                <Stack>
                    {commentItem && (
                        <>
                            {/* Focusable so the thread can be scrolled with the keyboard */}
                            <div
                                tabIndex={0}
                                className="max-h-96 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                                <CommentThread commentItem={commentItem} />
                            </div>
                            <Divider />
                        </>
                    )}
                    <CommentComposer
                        label={creating ? 'Comment' : 'Reply'}
                        placeholder={creating ? 'Leave feedback...' : 'Reply...'}
                        submitLabel={creating ? 'Post comment' : 'Post reply'}
                        quote={props.draft?.position.type === 'text' ? props.draft.position.text : undefined}
                        autoFocus
                        pending={mutation.isPending}
                        error={mutation.error}
                        onSubmit={handleSubmit} />
                </Stack>
            </Popper>
        </>
    );
}
