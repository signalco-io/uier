import { Approved as CheckCheck } from '@signalco/ui-icons';
import { Button } from '@signalco/ui-primitives/Button';
import { useReadComment } from '../../hooks/useComments';
import type { CommentItem } from '../@types/Comments';
import { useAnnounce } from '../Announcer';
import { messages, useMessages } from '../../i18n';

/**
 * The inbox's count line, like the app's (`TriageSelection`): the shown threads' unread count, then
 * Mark all as read right beside it, a small filled secondary button whose icon takes the unread accent.
 * Renders nothing when nothing shown is unread and nothing failed.
 */
export function MarkAllRead({ comments }: { comments: CommentItem[] }) {
    const read = useReadComment();
    const announce = useAnnounce();
    const t = useMessages();
    const failed = read.data?.failed ?? [];
    const unread = comments.filter(comment => comment.activity?.unread && !comment.pending);
    const run = (snapshot: CommentItem[]) => read.mutate(snapshot, {
        onSuccess: result => announce(messages().inbox.markedRead(result.reads.length))
    });
    if (!unread.length && !failed.length) return null;
    return (
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
            {unread.length > 0 && <>
                <span className="text-sm tabular-nums text-[hsl(var(--brand-accent-text))]">{t.inbox.unreadCount(unread.length)}</span>
                <Button size="xs" disabled={read.isPending} onClick={() => run(unread)}
                    startDecorator={<CheckCheck size={16} aria-hidden="true" className="text-[hsl(var(--brand-accent-text))]" />}
                    className="rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/80 pointer-coarse:min-h-11">
                    {t.inbox.markAllRead}
                </Button>
            </>}
            {failed.length > 0 && <>
                <p role="alert" className="m-0 text-sm text-muted-foreground">{t.inbox.notAllRead}</p>
                <Button size="xs" variant="outlined" disabled={read.isPending} onClick={() => run(failed)} className="pointer-coarse:min-h-11">{t.inbox.retry}</Button>
            </>}
        </div>
    );
}
