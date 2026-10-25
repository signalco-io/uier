import { DraftsProvider } from '../hooks/useDrafts';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Divider } from '@signalco/ui-primitives/Divider';
import { Button } from '@signalco/ui-primitives/Button';
import { useReadComment } from '../hooks/useComments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { CommentThreadItem } from './CommentThreadItem';
import { CommentThreadHeader } from './CommentThreadHeader';
import { CommentItem } from './@types/Comments';

/** A thread: its first and last message, and "Show all" for the ones between */
export function CommentThread({ commentItem, reading = false }: { commentItem: CommentItem; reading?: boolean }) {
    return <DraftsProvider page={commentItem.path}><ThreadContents commentItem={commentItem} reading={reading} /></DraftsProvider>;
}

function ThreadContents({ commentItem, reading = false }: { commentItem: CommentItem; reading?: boolean }) {
    const read = useReadComment();
    const threadRef = useRef<HTMLDivElement>(null);
    const canReadAutomatically = reading && commentItem.thread.items.length <= 2;
    // Only an opened thread, while visible in a foreground window. Inbox previews stay unread
    // until explicitly acknowledged; just listing feedback must not suppress notifications.
    useEffect(() => {
        if (!canReadAutomatically || !commentItem.activity?.unread) return;
        let timeout: number | undefined;
        let visible = false;
        const cancel = () => { window.clearTimeout(timeout); timeout = undefined; };
        const schedule = () => {
            cancel();
            if (visible && document.visibilityState === 'visible' && document.hasFocus())
                timeout = window.setTimeout(() => read.mutate(commentItem), 800);
        };
        const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); schedule(); });
        if (threadRef.current) observer.observe(threadRef.current);
        document.addEventListener('visibilitychange', schedule);
        window.addEventListener('focus', schedule);
        window.addEventListener('blur', cancel);
        return () => {
            cancel(); observer.disconnect();
            document.removeEventListener('visibilitychange', schedule);
            window.removeEventListener('focus', schedule);
            window.removeEventListener('blur', cancel);
        };
    }, [canReadAutomatically, commentItem.id, commentItem.activity?.sequence, commentItem.activity?.unread, read.mutate]);

    const [expanded, setExpanded] = useState(false);
    // "Show all" goes away once used (it is the only way to expand): the focus moves to the first
    // message it showed instead of getting lost
    const firstRevealedRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (expanded) {
            firstRevealedRef.current?.focus();
        }
    }, [expanded]);

    if (!commentItem.thread.items.length) return null;

    const threadFistItem = commentItem.thread.items[0];
    const threadLastItem = commentItem.thread.items.length > 1 ? commentItem.thread.items.at(-1) : null;
    const restComments = commentItem.thread.items.slice(1, -1);
    // Like the pin: a deleted first item ("Comment deleted") is not a message
    const messagesCount = commentItem.thread.items.filter(item => !item.deleted).length;

    return (
        <Stack ref={threadRef} className="py-2">
            <div className="px-4 pb-1 pt-2">
                <CommentThreadHeader comment={commentItem} />
            </div>
            {commentItem.activity && (
                <div className="flex items-center justify-between gap-2 px-4">
                    <span className={commentItem.activity.unread ? 'text-xs text-[hsl(var(--brand-accent-text))]' : 'text-xs text-muted-foreground'}>{commentItem.activity.unread ? 'Unread' : 'Read'}</span>
                    <Button size="xs" variant="plain" aria-label="Mark as read"
                        disabled={!commentItem.activity.unread || read.isPending}
                        className="pointer-coarse:min-h-11"
                        onClick={() => read.mutate(commentItem)}>
                        Mark as read
                    </Button>
                    <CommentsErrorMessage error={read.error} />
                </div>
            )}
            {threadFistItem && (
                <>
                    <div className="px-4 py-2 pb-3">
                        <CommentThreadItem
                            first
                            comment={commentItem}
                            threadItem={threadFistItem} />
                    </div>
                    {threadLastItem && <Divider />}
                </>
            )}
            {expanded && restComments.map((item, index) => (
                <Fragment key={item.id}>
                    <div
                        ref={index === 0 ? firstRevealedRef : undefined}
                        tabIndex={index === 0 ? -1 : undefined}
                        className="px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <CommentThreadItem
                            comment={commentItem}
                            threadItem={item} />
                    </div>
                    <Divider />
                </Fragment>
            ))}
            {!expanded && restComments.length > 0 && (
                <Button
                    variant="plain"
                    className="rounded-none text-muted-foreground pointer-coarse:h-11"
                    onClick={() => setExpanded(true)}>
                    Show all {messagesCount} messages
                </Button>
            )}
            {threadLastItem && (
                <>
                    {!expanded && restComments.length > 0 && <Divider />}
                    <div className="px-4 py-2 pt-3">
                        <CommentThreadItem
                            comment={commentItem}
                            threadItem={threadLastItem} />
                    </div>
                </>
            )}
        </Stack>
    );
}
