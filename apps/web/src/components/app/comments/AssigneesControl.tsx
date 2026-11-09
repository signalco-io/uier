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
import { unsetValueClass } from './unsetValue';
import { cn } from '@/src/lib/utils';

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
    const avatar = people.length === 1 ? <PersonAvatar assignee={people[0]!} /> : !people.length && <UserIcon aria-hidden="true" className="size-4" />;
    return <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
            {/* The avatar and the name are one menu button, pulled left by its padding so the avatar keeps its place */}
            {comment.permissions.assign ? <DropdownMenu>
                <DropdownMenuTrigger ref={trigger} render={<Button variant="ghost" size="sm" aria-label={`${people.length > 1 ? `${people.length} people. ` : ''}${assigned}. Change assignee`} aria-keyshortcuts={shortcut}
                    data-unset={people.length ? undefined : ''} className={cn('-ml-1.5 h-7 min-w-0 gap-1.5 px-1.5 font-normal pointer-coarse:min-h-11', !people.length && unsetValueClass)} />}>
                    {avatar}
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
            </DropdownMenu> : people.length ? <>{avatar}<span>{people.length === 1 ? name(people[0]!) : `${people.length} people`}</span></>
                : <span data-unset="" className="inline-flex items-center gap-1.5 text-muted-foreground">{avatar}Unassigned</span>}
            {people.length === 1 && <AgentControl projectId={projectId} comment={comment} assignee={people[0]!} editable={people[0]!.id === userId && comment.permissions.agent} />}
        </div>
        {people.length > 1 && people.map(person => <div key={person.id} data-assignment={person.id} className="flex min-w-0 flex-wrap items-center gap-1.5">
            <PersonAvatar assignee={person} /><span className="min-w-0 truncate">{name(person)}</span>
            <AgentControl projectId={projectId} comment={comment} assignee={person} editable={person.id === userId && comment.permissions.agent} />
        </div>)}
    </div>;
}
