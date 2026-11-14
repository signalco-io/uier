'use client';

import { useOptimistic, useRef, useTransition } from 'react';
import { TagIcon } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_THREAD_LABELS, type ThreadLabel } from '@/src/lib/app/threadLabel';
import { useAppI18n } from '@/src/lib/i18n/client';
import { Button } from '../../ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger } from '../../ui/dropdown-menu';
import { ThreadLabelBadge, ThreadLabelMark } from '../ThreadLabelBadge';
import { changeCommentLabelsAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';

export function ThreadLabelsControl({ projectId, commentId, labels, available, canEdit }: { projectId: string; commentId: string; labels: ThreadLabel[]; available: ThreadLabel[]; canEdit: boolean }) {
    const { t } = useAppI18n();
    const [pending, start] = useTransition();
    const [shown, show] = useOptimistic(labels);
    const update = useCommentUpdate();
    const attempt = useRef<{ id: string; mode: 'add' | 'remove'; key: string } | null>(null);
    return <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {shown.map(label => <ThreadLabelBadge key={label.id} label={label} />)}
        {!shown.length && <span className="text-muted-foreground">{t('No labels')}</span>}
        {canEdit && available.length > 0 && <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('Edit labels')} disabled={pending} className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" />}><TagIcon /></DropdownMenuTrigger>
            <DropdownMenuContent align="start"><DropdownMenuGroup>
                {available.map(label => {
                    const selected = shown.some(item => item.id === label.id);
                    return <DropdownMenuCheckboxItem key={label.id} checked={selected} disabled={pending || (!selected && shown.length >= MAX_THREAD_LABELS)} className="pointer-coarse:min-h-11"
                        onCheckedChange={checked => start(async () => {
                            const mode = checked ? 'add' : 'remove';
                            if (attempt.current?.id !== label.id || attempt.current?.mode !== mode) attempt.current = { id: label.id, mode, key: crypto.randomUUID() };
                            const next = checked ? [...shown, label] : shown.filter(item => item.id !== label.id);
                            show(next);
                            const confirm = update({ id: commentId, patch: { labels: next, labelIds: next.map(item => item.id) } });
                            try {
                                const result = await changeCommentLabelsAction(projectId, commentId, [label.id], mode, attempt.current.key);
                                if (!result?.ok) toast.error(result?.error ?? t('Could not update labels. Try again.'));
                                else { confirm(result); attempt.current = null; }
                            } catch { toast.error(t('Could not update labels. Try again.')); }
                        })}>
                        <ThreadLabelMark label={label} /><span className="flex min-w-0 flex-col"><span className="truncate">{label.name}</span>{label.description && <span className="text-xs text-muted-foreground">{label.description}</span>}</span>
                    </DropdownMenuCheckboxItem>;
                })}
            </DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>}
    </div>;
}
