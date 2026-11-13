'use client';

import { useEffect, useOptimistic, useState, type ComponentProps } from 'react';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';
import { CommentCard } from './CommentCard';
import { CommentCardShell } from './CommentCardShell';
import { applyCommentUpdate, CommentUpdatesProvider, useCommentUpdate, type CommentUpdate } from './CommentUpdates';

/** Keep the same CommentCard/composer across revalidation; a summary can never masquerade as a full thread. */
export function PagedCommentCard(props: ComponentProps<typeof CommentCard> & { snapshotRevision?: string }) {
    const { comment, projectId, snapshotRevision, ...cardProps } = props;
    const parentUpdate = useCommentUpdate();
    const [detail, setDetail] = useState<ProjectCommentView>();
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const [optimistic, update] = useOptimistic(detail, (current, change: CommentUpdate) => current && applyCommentUpdate(current, change));
    const key = JSON.stringify(comment);
    useEffect(() => {
        if (!comment.summary) return;
        const controller = new AbortController(); setFailed(false);
        void fetch(`/api/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(comment.id)}`, {
            cache: 'no-store', credentials: 'same-origin', signal: controller.signal
        }).then(async response => {
            if (!response.ok) { if (response.status === 404 && !controller.signal.aborted) props.onBack?.(); throw new Error(); }
            const next = await response.json() as ProjectCommentView;
            if (!controller.signal.aborted) setDetail(next);
        }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
        return () => controller.abort();
        // The row's content, assignment and read cursor all invalidate its canonical detail.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, key, snapshotRevision, retry]);
    const full = comment.summary ? optimistic : comment;
    return <CommentUpdatesProvider value={change => { parentUpdate(change); update(change); }}>
        {/* Until the detail arrives, a shell shaped like the thread from the row's summary (uier #385) */}
        {full ? <CommentCard {...cardProps} projectId={projectId} comment={full} /> : <CommentCardShell projectId={projectId} comment={comment}
            reviewLink={cardProps.reviewLink} assignees={cardProps.assignees} userId={cardProps.userId} onBack={cardProps.onBack} className={cardProps.className}
            failed={failed} onRetry={() => setRetry(value => value + 1)} />}
    </CommentUpdatesProvider>;
}
