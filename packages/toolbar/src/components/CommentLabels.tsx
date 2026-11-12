import { useContext, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@signalco/ui-primitives/Button';
import { Popper } from '@signalco/ui-primitives/Popper';
import { toolbarConfig } from '../config';
import { useProjectViewer } from '../project/ProjectGate';
import { apiRequest, required, currentReviewerRevision, commentsQueryKeyPrefix } from '../hooks/api';
import { commentUrl, newLocalId, updateCachedComment } from '../hooks/useComments';
import { useMessages } from '../i18n';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import type { CommentItem } from './@types/Comments';
import { CommentsErrorMessage } from './CommentsErrorMessage';

const colors: Record<string, string> = { ink: '--foreground', blue: '--brand-accent-text', sky: '--brand-in-progress', violet: '--brand-ready', green: '--brand-success', amber: '--brand-warning', red: '--destructive' };
type Label = { id: string; name: string; description: string; color: string };
export function CommentLabels({ comment }: { comment: CommentItem }) {
    const t = useMessages();
    const { isMember } = useProjectViewer();
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const client = useQueryClient(), saving = useRef(false);
    const catalog = useQuery({ queryKey: ['review-labels', toolbarConfig.project, currentReviewerRevision()], enabled: Boolean(toolbarConfig.project && isMember),
        queryFn: () => apiRequest<Label[]>(`${toolbarConfig.apiUrl}/api/review/${encodeURIComponent(toolbarConfig.project!)}/labels`).then(required), staleTime: 30_000 });
    const mutation = useMutation({
        mutationFn: (input: { labelIds: string[]; mode: 'add' | 'remove'; idempotencyKey: string }) => apiRequest<CommentItem>(`${commentUrl(comment.id)}/labels`, { method: 'POST', body: input }).then(required),
        onMutate: () => currentReviewerRevision(),
        onSuccess: (next, _input, revision) => { if (revision === currentReviewerRevision()) updateCachedComment(client, next); },
        onSettled: () => { saving.current = false; void client.invalidateQueries({ queryKey: commentsQueryKeyPrefix }); }
    });
    if (!isMember || !toolbarConfig.project) return null;
    if (catalog.error) return <CommentsErrorMessage error={catalog.error} />;
    const labels = catalog.data ?? [];
    const selected = labels.filter(label => comment.labelIds?.includes(label.id));
    return <div className="flex flex-wrap items-center gap-2 text-xs">
        {selected.map(label => <span key={label.id} data-thread-label={label.id} title={label.description} className="rounded-full border px-2 py-0.5" style={{ color: `hsl(var(${colors[label.color] ?? colors.ink}))` }}>{label.name}</span>)}
        {comment.permissions?.priority && labels.length > 0 && <Popper container={rootElement} aria-label={t.thread.labels.title}
            onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
            className="z-[70] max-h-[60vh] w-64 overflow-y-auto rounded-xl p-2"
            trigger={<Button variant="outlined" size="xs" aria-label={t.thread.labels.edit}>{t.thread.labels.title}</Button>}>
            <div role="group" aria-label={t.thread.labels.title} className="flex flex-col gap-1">
                {labels.map(label => <Button key={label.id} variant="plain" size="sm" aria-pressed={comment.labelIds?.includes(label.id) ?? false}
                    disabled={mutation.isPending} title={label.description} onClick={() => {
                        if (saving.current) return;
                        saving.current = true;
                        mutation.mutate({ labelIds: [label.id], mode: comment.labelIds?.includes(label.id) ? 'remove' : 'add', idempotencyKey: newLocalId() });
                    }}>{label.name}</Button>)}
            </div>
        </Popper>}
        {mutation.error && <CommentsErrorMessage error={mutation.error} />}
    </div>;
}
