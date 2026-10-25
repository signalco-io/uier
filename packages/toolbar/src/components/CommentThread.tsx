import { DraftsProvider } from '../hooks/useDrafts';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Divider } from '@signalco/ui-primitives/Divider';
import { Button } from '@signalco/ui-primitives/Button';
import { CommentThreadItem } from './CommentThreadItem';
import { CommentThreadHeader } from './CommentThreadHeader';
import { CommentItem } from './@types/Comments';

/** A thread: its first and last message, and "Show all" for the ones between */
export function CommentThread({ commentItem }: { commentItem: CommentItem; }) {
    return <DraftsProvider page={commentItem.path}><ThreadContents commentItem={commentItem} /></DraftsProvider>;
}

function ThreadContents({ commentItem }: { commentItem: CommentItem; }) {
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
        <Stack className="py-2">
            <div className="px-4 pb-1 pt-2">
                <CommentThreadHeader comment={commentItem} />
            </div>
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
