'use client';

import { useTransition, type RefObject } from 'react';
import { ChevronDownIcon, UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { commentAssignees } from '@uier/toolbar/agents';
import { Button } from '@/src/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import type { ProjectAssignee, ProjectCommentView } from '@/src/lib/app/projectComments';
import { updateCommentAssigneesAction } from './actions';
import { PersonAvatar } from './AgentAvatar';
import { AgentControl } from './AgentControl';
import { useCommentUpdate } from './CommentUpdates';
import type { AssigneeOption } from './CommentCard';

/** People are changed atomically; each person's agents stay with their own assignment. */
export function AssigneesControl({ projectId, comment, userId, options, trigger, shortcut }: {
    projectId: string; comment: ProjectCommentView; userId: string; options: AssigneeOption[];
    trigger: RefObject<HTMLButtonElement | null>; shortcut?: string;
}) {
    const people = commentAssignees(comment);
    const [pending, start] = useTransition();
    const update = useCommentUpdate();
    const name = (person: ProjectAssignee) => person.id === userId ? 'You' : person.name;
    const assigned = people.length ? `Assigned to ${people.map(person => person.id === userId ? 'you' : person.name).join(', ')}` : 'Unassigned';
    const change = (ids: string[], mode: 'add' | 'remove' | 'replace') => start(async () => {
        const next = mode === 'replace' ? [] : mode === 'remove' ? people.filter(person => !ids.includes(person.id))
            : [...people, ...options.filter(person => ids.includes(person.userId) && !people.some(current => current.id === person.userId))
                .map(person => ({ id: person.userId, name: person.name, avatarUrl: person.avatarUrl }))];
        update({ id: comment.id, patch: { assignees: next, assignee: next[0] } });
        try {
            const result = await updateCommentAssigneesAction(projectId, comment.id, ids, mode);
            if (result?.ok) return;
            toast.error(result?.error ?? 'Could not change the assignees. Try again.');
        } catch { toast.error('Could not change the assignees. Try again.'); }
        update({ id: comment.id, patch: { assignees: people, assignee: people[0] } });
    });
    return <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
            {people.length === 1 ? <PersonAvatar assignee={people[0]!} /> : !people.length && <UserIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
            {comment.permissions.assign ? <DropdownMenu>
                <DropdownMenuTrigger ref={trigger} render={<Button variant="ghost" size="sm" aria-label={`${people.length > 1 ? `${people.length} people. ` : ''}${assigned}. Change assignee`} aria-keyshortcuts={shortcut}
                    className="h-7 min-w-0 gap-2 px-1.5 font-normal pointer-coarse:min-h-11" />}>
                    <span className="truncate">{people.length === 1 ? name(people[0]!) : people.length ? `${people.length} people` : 'Unassigned'}</span>
                    <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto">
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                        {options.filter(option => comment.eligibleAssigneeIds.includes(option.userId)).map(option => <DropdownMenuCheckboxItem key={option.userId}
                            checked={people.some(person => person.id === option.userId)} disabled={pending} closeOnClick={false}
                            className="pointer-coarse:min-h-11"
                            onCheckedChange={checked => change([option.userId], checked ? 'add' : 'remove')}>
                            {option.name}
                        </DropdownMenuCheckboxItem>)}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        {people.length > 0 && <DropdownMenuItem disabled={pending} onClick={() => change([], 'replace')}>Unassign</DropdownMenuItem>}
                        <DropdownMenuItem>Done</DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu> : <span>{people.length === 1 ? name(people[0]!) : people.length ? `${people.length} people` : 'Unassigned'}</span>}
            {people.length === 1 && <AgentControl projectId={projectId} comment={comment} assignee={people[0]!} editable={people[0]!.id === userId && comment.permissions.agent} />}
        </div>
        {people.length > 1 && people.map(person => <div key={person.id} data-assignment={person.id} className="flex min-w-0 flex-wrap items-center gap-1.5">
            <PersonAvatar assignee={person} /><span className="min-w-0 truncate">{name(person)}</span>
            <AgentControl projectId={projectId} comment={comment} assignee={person} editable={person.id === userId && comment.permissions.agent} />
        </div>)}
    </div>;
}
