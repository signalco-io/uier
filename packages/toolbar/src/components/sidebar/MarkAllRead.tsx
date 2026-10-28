import { Button } from '@signalco/ui-primitives/Button';
import { useReadComment } from '../../hooks/useComments';
import type { CommentItem } from '../@types/Comments';
import { useAnnounce } from '../Announcer';

export function MarkAllRead({ comments }: { comments: CommentItem[] }) {
    const read = useReadComment();
    const announce = useAnnounce();
    const failed = read.data?.failed ?? [];
    const unread = comments.filter(comment => comment.activity?.unread && !comment.pending);
    const run = (snapshot: CommentItem[]) => read.mutate(snapshot, {
        onSuccess: result => announce(`${result.reads.length} ${result.reads.length === 1 ? 'thread' : 'threads'} marked as read.`)
    });
    return <>
        {unread.length > 0 && <Button size="sm" variant="plain" disabled={read.isPending} onClick={() => run(unread)}>
            Mark all as read
        </Button>}
        {failed.length > 0 && <>
            <p role="alert" className="m-0 text-sm text-muted-foreground">Some threads could not be marked as read.</p>
            <Button size="sm" variant="plain" disabled={read.isPending} onClick={() => run(failed)}>Retry</Button>
        </>}
    </>;
}
