import { Approved as CheckCheck } from '@signalco/ui-icons';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { useReadComment, useSiteComments } from '../../hooks/useComments';
import type { CommentItem } from '../@types/Comments';
import { useAnnounce } from '../Announcer';
import { messages, useMessages } from '../../i18n';

/**
 * The inbox's unread line: "N unread", the site's unread threads (the pill's count, in the unread accent), a toggle
 * that lists only them, then Mark all as read beside it, a small filled secondary button whose icon takes the unread
 * accent. It reads the shown unread threads, or, when none of them is listed (they are on other pages or in another
 * tab) and no search or Assigned to me narrows the list, the site's unread list, so it is there whenever something is
 * unread (uier #372). Renders nothing when nothing is unread (unless the filter is on, so it can be
 * turned off) and nothing failed.
 */
export function MarkAllRead({ comments, unreadTotal, filtering, narrowed, onFilterChange }: {
    comments: CommentItem[];
    /** The site's unread threads */
    unreadTotal: number;
    /** Only unread threads are listed */
    filtering: boolean;
    /** A search or Assigned to me applies: only the listed threads are read */
    narrowed: boolean;
    onFilterChange: (unread: boolean) => void;
}) {
    const read = useReadComment();
    const announce = useAnnounce();
    const t = useMessages();
    const failed = read.data?.failed ?? [];
    const shown = comments.filter(comment => comment.activity?.unread && !comment.pending);
    // The site's unread list (the unread filter's), loaded only when the shown list has none of the unread threads
    const site = useSiteComments(unreadTotal > 0 && !shown.length && !narrowed, true);
    const unread = shown.length || narrowed ? shown : (site.data ?? []).filter(comment => comment.activity?.unread && !comment.pending);
    const run = (snapshot: CommentItem[]) => read.mutate(snapshot, {
        onSuccess: result => announce(messages().inbox.markedRead(result.reads.length))
    });
    if (!unreadTotal && !filtering && !unread.length && !failed.length) return null;
    return (
        <div className="flex min-h-8 flex-wrap items-center gap-x-1 gap-y-1">
            {(unreadTotal > 0 || filtering) && (
                <Button size="xs" variant="plain" aria-pressed={filtering} onClick={() => onFilterChange(!filtering)}
                    className={cx('rounded-md font-normal tabular-nums text-[hsl(var(--brand-accent-text))] pointer-coarse:min-h-11', filtering && 'bg-accent')}>
                    {t.inbox.unreadCount(unreadTotal)}
                </Button>
            )}
            {unread.length > 0 && <>
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
