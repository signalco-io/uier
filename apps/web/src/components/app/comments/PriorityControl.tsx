'use client';

import { useRef, useTransition } from 'react';
import { CheckIcon } from 'lucide-react';
import { toast } from 'sonner';
import { priorities, priorityLabels, type CommentPriority } from '@uier/toolbar/triage';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import { setCommentPriorityAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';
import { PriorityFlag } from './PriorityFlag';

/** The thread's priority with its flag; a menu of the four for those who can triage */
export function PriorityControl({ projectId, commentId, priority, canEdit }: { projectId: string; commentId: string; priority: CommentPriority; canEdit: boolean }) {
    const [pending, start] = useTransition();
    const update = useCommentUpdate();
    const attempt = useRef<{ value: CommentPriority; key: string } | null>(null);
    if (!canEdit) return <Badge variant="outline"><PriorityFlag priority={priority} /><span className="sr-only">Priority: </span>{priorityLabels[priority]}</Badge>;
    return <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" disabled={pending} aria-label={`Priority: ${priorityLabels[priority]}. Change priority`} />}>
            <PriorityFlag priority={priority} data-icon="inline-start" className="size-3.5" />
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
                })}>
                    <PriorityFlag priority={value} />
                    {priorityLabels[value]}
                    {value === priority && <CheckIcon aria-hidden="true" className="ml-auto" />}
                </DropdownMenuItem>)}
            </DropdownMenuGroup>
        </DropdownMenuContent>
    </DropdownMenu>;
}
