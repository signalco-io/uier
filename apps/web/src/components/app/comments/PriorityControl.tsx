'use client';

import { useRef, useTransition } from 'react';
import { toast } from 'sonner';
import { priorities, priorityLabels, type CommentPriority } from '@uier/toolbar/triage';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import { setCommentPriorityAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';

export function PriorityControl({ projectId, commentId, priority, canEdit }: { projectId: string; commentId: string; priority: CommentPriority; canEdit: boolean }) {
    const [pending, start] = useTransition();
    const update = useCommentUpdate();
    const attempt = useRef<{ value: CommentPriority; key: string } | null>(null);
    if (!canEdit) return <Badge variant="outline">Priority: {priorityLabels[priority]}</Badge>;
    return <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" disabled={pending} aria-label={`Priority: ${priorityLabels[priority]}. Change priority`} />}>
            {priorityLabels[priority]}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
            <DropdownMenuGroup>
                {priorities.map(value => <DropdownMenuItem className="pointer-coarse:min-h-11" key={value} onClick={() => start(async () => {
                    if (attempt.current?.value !== value) attempt.current = { value, key: crypto.randomUUID() };
                    update({ id: commentId, patch: { priority: value } });
                    try {
                        const result = await setCommentPriorityAction(projectId, commentId, value, attempt.current.key);
                        if (!result?.ok) toast.error(result?.error ?? 'Could not set priority. Try again.');
                        else { attempt.current = null; toast(`Priority set to ${priorityLabels[value]}.`); }
                    } catch { toast.error('Could not set priority. Try again.'); }
                })}>{priorityLabels[value]}</DropdownMenuItem>)}
            </DropdownMenuGroup>
        </DropdownMenuContent>
    </DropdownMenu>;
}
