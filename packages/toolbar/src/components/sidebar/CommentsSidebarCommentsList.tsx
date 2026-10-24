import { Stack } from '@signalco/ui-primitives/Stack';
import { Button } from '@signalco/ui-primitives/Button';
import { CommentThread } from '../CommentThread';
import { CommentsErrorMessage } from '../CommentsErrorMessage';
import { useComments } from '../../hooks/useComments';
import { CommentsFilter } from './CommentsFilter';

export function CommentsSidebarCommentsList({ status }: { status: NonNullable<CommentsFilter['status']> }) {
    const { query } = useComments();
    const { data: comments, error, isPending, refetch } = query;
    const filteredComments = comments?.filter(c => status === 'resolved' ? c.resolved : !c.resolved);

    if (isPending) {
        return <div className="py-4 text-center text-muted-foreground">Loading comments...</div>;
    }

    if (error && !comments) {
        return (
            <Stack spacing={1} alignItems="center" className="py-4 text-center">
                <CommentsErrorMessage error={error} />
                <Button variant="outlined" size="sm" onClick={() => refetch()}>Try again</Button>
            </Stack>
        );
    }

    return (
        <Stack spacing={1}>
            {!filteredComments?.length && (
                <div className="py-4 text-center text-muted-foreground">
                    {status === 'resolved' ? 'No resolved comments' : 'No comments'}
                </div>
            )}
            {filteredComments?.map((commentItem) => (
                <div className="rounded-xl border bg-card" key={commentItem.id}>
                    <CommentThread commentItem={commentItem} />
                </div>
            ))}
        </Stack>
    );
}
