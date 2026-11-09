'use client';

import { useRef, useTransition } from 'react';
import { CheckIcon } from 'lucide-react';
import { toast } from 'sonner';
import { priorities, priorityLabels, type CommentPriority } from '@uier/toolbar/triage';
import { Button } from '@/src/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import { setCommentPriorityAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';
import { PriorityFlag } from './PriorityFlag';
import { unsetValueClass } from './unsetValue';
import { cn } from '@/src/lib/utils';

/** The thread's priority with its flag; a menu of the four for those who can triage */
export function PriorityControl({ projectId, commentId, priority, canEdit }: { projectId: string; commentId: string; priority: CommentPriority; canEdit: boolean }) {
    const [pending, start] = useTransition();
    const update = useCommentUpdate();
    const attempt = useRef<{ value: CommentPriority; key: string } | null>(null);
    // The default Normal is "not set": muted like Unassigned, its flag following the text colour
    const unset = priority === 'normal';
    const flag = unset ? 'size-3.5 stroke-current' : 'size-3.5';
    if (!canEdit) return <span data-unset={unset ? '' : undefined} className={cn('inline-flex items-center gap-1.5', unset && 'text-muted-foreground')}><PriorityFlag priority={priority} className={flag} /><span className="sr-only">Priority: </span>{priorityLabels[priority]}</span>;
    return <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" data-unset={unset ? '' : undefined}
            className={cn('-ml-1.5 h-7 gap-1.5 px-1.5 font-normal pointer-coarse:min-h-11 pointer-coarse:min-w-11', unset && unsetValueClass)} disabled={pending} aria-label={`Priority: ${priorityLabels[priority]}. Change priority`} />}>
            <PriorityFlag priority={priority} data-icon="inline-start" className={flag} />
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
                        else attempt.current = null;
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
