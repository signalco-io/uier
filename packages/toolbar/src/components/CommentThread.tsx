import { CommentVerification } from './CommentVerification';
import { CheckRecheck } from './checks/CheckRecheck';
import { readyForReview } from '../verification';
import { CommentActivity } from './CommentActivity';
import { CommentAnchorDetails } from './CommentAnchorDetails';
import { DraftsProvider } from '../hooks/useDrafts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Button } from '@signalco/ui-primitives/Button';
import { useReadComment } from '../hooks/useComments';
import { CommentThreadItem } from './CommentThreadItem';
import { CommentThreadHeader, sourceText } from './CommentThreadHeader';
import { CommentItem } from './@types/Comments';
import { ThreadNotifications } from './ThreadNotifications';
import { toolbarConfig } from '../config';
import { useVisitor } from '../hooks/useVisitor';
import { useMessages } from '../i18n';

/**
 * A thread: its first and last message, and "Show all" for the ones between. On the page (a pin's
 * popover, `onPage`) it leaves out where it came from: that is the page it is on. `allMessages` starts
 * with every message shown: a pin's hover preview, and the thread opened from it (uier #322).
 */
export function CommentThread({ commentItem, reading = false, onPage = false, allMessages = false, children }: { commentItem: CommentItem; reading?: boolean; onPage?: boolean; allMessages?: boolean; children?: ReactNode }) {
    return <DraftsProvider page={commentItem.path}><ThreadContents commentItem={commentItem} reading={reading} onPage={onPage} allMessages={allMessages} />{children}</DraftsProvider>;
}

function ThreadContents({ commentItem, reading, onPage, allMessages }: { commentItem: CommentItem; reading: boolean; onPage: boolean; allMessages: boolean }) {
    // Request verification opens from Thread options; focus goes back there
    const [verifying, setVerifying] = useState(false);
    const t = useMessages();
    const optionsRef = useRef<HTMLButtonElement>(null);
    const read = useReadComment();
    const threadRef = useRef<HTMLDivElement>(null);
    const visitor = useVisitor().query.data;
    // Mark as unread keeps the thread unread while it stays open
    const [keptUnread, setKeptUnread] = useState(false);
    const canReadAutomatically = reading && !keptUnread && Boolean(visitor?.name || visitor?.member) && commentItem.thread.items.length <= 2;
    const verificationAtOpen = useRef(commentItem.verification?.revision);
    // Workflow-only changes never acknowledge activity. Opening the thread again may read it.
    const verificationChanged = verificationAtOpen.current !== commentItem.verification?.revision;
    // Only an opened thread, while visible in a foreground window. Inbox previews stay unread
    // until explicitly acknowledged; just listing feedback must not suppress notifications.
    useEffect(() => {
        if (verificationChanged || !canReadAutomatically || !commentItem.activity?.unread) return;
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
    }, [verificationChanged, canReadAutomatically, commentItem.id, commentItem.activity?.sequence, commentItem.activity?.unread, read.mutate]);
    const [expanded, setExpanded] = useState(allMessages);
    // "Show all" goes away once used (it is the only way to expand): the focus moves to the first
    // message it showed instead of getting lost. Not when the thread starts with all of them.
    const firstRevealedRef = useRef<HTMLDivElement>(null);
    const showAllUsedRef = useRef(false);
    useEffect(() => {
        if (expanded && showAllUsedRef.current) {
            firstRevealedRef.current?.focus();
        }
    }, [expanded]);

    if (!commentItem.thread.items.length) return null;

    const threadFistItem = commentItem.thread.items[0];
    const threadLastItem = commentItem.thread.items.length > 1 ? commentItem.thread.items.at(-1) : null;
    const restComments = commentItem.thread.items.slice(1, -1);
    // Like the pin: a deleted first item ("Comment deleted") is not a message
    const messagesCount = commentItem.thread.items.filter(item => !item.deleted).length;
    const source = commentItem.source && (!onPage || !commentItem.source.available) && <span className="min-w-0 break-words">{sourceText(commentItem.source, t)}</span>;
    // A page check's finding run again: under the messages, or between a pending request and its answers
    const recheck = commentItem.check && <CheckRecheck comment={commentItem} />;
    const ready = readyForReview(commentItem);

    return (
        // Tight around the messages (uier #215): the header, the messages and what follows them are 8 px apart
        <Stack ref={threadRef} spacing={1} className="px-4 py-3">
            <CommentThreadHeader comment={commentItem} onMarkedUnread={() => setKeptUnread(true)}
                onRequestVerification={() => setVerifying(true)} optionsRef={optionsRef} />
            {/* Where it came from */}
            {source && <div className="text-xs text-muted-foreground">{source}</div>}
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
                        data-uier-thread-control=""
                        onClick={() => { showAllUsedRef.current = true; setExpanded(true); }}>
                        {t.thread.showAll(messagesCount)}
                    </Button>
                )}
                {threadLastItem && (
                    <CommentThreadItem
                        comment={commentItem}
                        threadItem={threadLastItem} />
                )}
            </Stack>
            {!ready && recheck}
            <CommentVerification comment={commentItem} open={verifying} onOpenChange={setVerifying} returnFocus={optionsRef} evidence={ready && recheck} />
            <CommentAnchorDetails comment={commentItem} />
            <CommentActivity entries={commentItem.history} />
            {toolbarConfig.project && commentItem.notifications?.eligible && <ThreadNotifications comment={commentItem} />}
            {commentItem.integrationLinks && commentItem.integrationLinks.length > 0 && <nav aria-label={t.thread.connectedServices} className="flex flex-wrap gap-3 text-xs">
                {commentItem.integrationLinks.map(link => <a key={link.provider} href={link.url} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                    {t.thread.openIn(({ notion: 'Notion', github: 'GitHub', linear: 'Linear', slack: 'Slack', 'azure-devops': 'Azure DevOps' } as Record<string, string>)[link.provider] ?? link.provider)}
                </a>)}
            </nav>}
        </Stack>
    );
}
