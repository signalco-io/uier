import { CommentAnchorDetails } from './CommentAnchorDetails';
import { DraftsProvider } from '../hooks/useDrafts';
import { useEffect, useRef, useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Button } from '@signalco/ui-primitives/Button';
import { useReadComment } from '../hooks/useComments';
import { CommentThreadItem } from './CommentThreadItem';
import { CommentAssignment } from './CommentAssignment';
import { CommentThreadHeader, sourceText } from './CommentThreadHeader';
import { CommentItem } from './@types/Comments';
import { ThreadNotifications } from './ThreadNotifications';
import { toolbarConfig } from '../config';
import { useVisitor } from '../hooks/useVisitor';

/** A thread: its first and last message, and "Show all" for the ones between */
export function CommentThread({ commentItem, reading = false }: { commentItem: CommentItem; reading?: boolean }) {
    return <DraftsProvider page={commentItem.path}><ThreadContents commentItem={commentItem} reading={reading} /></DraftsProvider>;
}

function ThreadContents({ commentItem, reading }: { commentItem: CommentItem; reading: boolean }) {
    const read = useReadComment();
    const threadRef = useRef<HTMLDivElement>(null);
    const visitor = useVisitor().query.data;
    const canReadAutomatically = reading && Boolean(visitor?.name || visitor?.member) && commentItem.thread.items.length <= 2;
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
    const source = commentItem.source && <span className="min-w-0 break-words">{sourceText(commentItem.source)}</span>;

    return (
        <Stack ref={threadRef} spacing={3} className="px-4 py-3">
            <CommentThreadHeader comment={commentItem} />
            {/* Who it is assigned to and where it came from, on one line (the app's comment card) */}
            {(commentItem.permissions?.assign || commentItem.assignee)
                ? <CommentAssignment comment={commentItem}>{source}</CommentAssignment>
                : source && <div className="text-xs text-muted-foreground">{source}</div>}
            {/* The messages, one under the other like a chat; the avatars make the column */}
            <Stack spacing={2}>
                {threadFistItem && (
                    <CommentThreadItem
                        first
                        comment={commentItem}
                        threadItem={threadFistItem} />
                )}
                {expanded && restComments.map((item, index) => (
                    <div
                        key={item.id}
                        ref={index === 0 ? firstRevealedRef : undefined}
                        tabIndex={index === 0 ? -1 : undefined}
                        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <CommentThreadItem
                            comment={commentItem}
                            threadItem={item} />
                    </div>
                ))}
                {!expanded && restComments.length > 0 && (
                    <Button
                        variant="plain"
                        size="xs"
                        className="ml-6 self-start text-muted-foreground"
                        onClick={() => setExpanded(true)}>
                        Show all {messagesCount} messages
                    </Button>
                )}
                {threadLastItem && (
                    <CommentThreadItem
                        comment={commentItem}
                        threadItem={threadLastItem} />
                )}
            </Stack>
            <CommentAnchorDetails comment={commentItem} />
            {toolbarConfig.project && commentItem.notifications?.eligible && <ThreadNotifications comment={commentItem} />}
            {commentItem.integrationLinks && commentItem.integrationLinks.length > 0 && <nav aria-label="Connected services" className="flex flex-wrap gap-3 text-xs">
                {commentItem.integrationLinks.map(link => <a key={link.provider} href={link.url} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                    Open in {({ notion: 'Notion', github: 'GitHub', linear: 'Linear', slack: 'Slack' } as Record<string, string>)[link.provider] ?? link.provider}
                </a>)}
            </nav>}
        </Stack>
    );
}
