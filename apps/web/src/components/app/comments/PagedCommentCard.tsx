'use client';

import { useEffect, useOptimistic, useState, type ComponentProps } from 'react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';
import { CommentCard } from './CommentCard';
import { applyCommentUpdate, CommentUpdatesProvider, useCommentUpdate, type CommentUpdate } from './CommentUpdates';

/** Keep the same CommentCard/composer across revalidation; a summary can never masquerade as a full thread. */
export function PagedCommentCard(props: ComponentProps<typeof CommentCard> & { snapshotRevision?: string }) {
    const { t } = useAppI18n();
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
        {full ? <CommentCard {...cardProps} projectId={projectId} comment={full} /> : <div className="flex min-h-40 items-center justify-center gap-2 p-4" role="status">
            {failed ? <Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t('Try again')}</Button> : <><Spinner />{t('Loading comments')}</>}
        </div>}
    </CommentUpdatesProvider>;
}
