'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';
import { CommentCard } from './CommentCard';
import { CommentCardShell } from './CommentCardShell';
import { CommentUpdatesProvider, useCommentUpdate } from './CommentUpdates';
import { useOptimisticCommentUpdates } from './useOptimisticCommentUpdates';

/** Keep the same CommentCard/composer across revalidation; a summary can never masquerade as a full thread. */
export function PagedCommentCard(props: ComponentProps<typeof CommentCard> & { snapshotRevision?: string }) {
    const { comment, projectId, snapshotRevision, ...cardProps } = props;
    const parentUpdate = useCommentUpdate();
    const scope = JSON.stringify([projectId, cardProps.userId, comment.id]);
    const [detail, setDetail] = useState<{ scope: string; comment: ProjectCommentView }>();
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const saved = comment.summary ? detail?.scope === scope ? detail.comment : undefined : comment;
    const [optimistic, update] = useOptimisticCommentUpdates(saved ? [saved] : [], scope);
    const key = JSON.stringify(comment);
    useEffect(() => {
        if (!comment.summary) return;
        const controller = new AbortController(); setFailed(false);
        void fetch(`/api/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(comment.id)}`, {
            cache: 'no-store', credentials: 'same-origin', signal: controller.signal
        }).then(async response => {
            if (!response.ok) { if (response.status === 404 && !controller.signal.aborted) props.onBack?.(); throw new Error(); }
            const next = await response.json() as ProjectCommentView;
            if (!controller.signal.aborted) setDetail({ scope, comment: next });
        }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
        return () => controller.abort();
        // The row's content, assignment and read cursor all invalidate its canonical detail.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, scope, key, snapshotRevision, retry]);
    const full = optimistic[0];
    return <CommentUpdatesProvider value={change => {
        const confirmParent = parentUpdate(change);
        const confirmDetail = update(change);
        return (receipt, options) => { confirmParent(receipt, options); confirmDetail(receipt, options); };
    }}>
        {/* Until the detail arrives, a shell shaped like the thread from the row's summary (uier #385) */}
        {full ? <CommentCard {...cardProps} projectId={projectId} comment={full} /> : <CommentCardShell projectId={projectId} comment={comment}
            reviewLink={cardProps.reviewLink} assignees={cardProps.assignees} userId={cardProps.userId} onBack={cardProps.onBack} className={cardProps.className}
            failed={failed} onRetry={() => setRetry(value => value + 1)} />}
    </CommentUpdatesProvider>;
}
