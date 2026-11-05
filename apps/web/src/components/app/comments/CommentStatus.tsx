'use client';

import type { ReactElement, Ref } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { readyForReview } from '@uier/toolbar/verification';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import type { ProjectCommentView } from '../../../lib/app/projectComments';

export type CommentStatus = 'open' | 'ready' | 'done';

export const commentStatusLabels: Record<CommentStatus, string> = { open: 'Open', ready: 'Ready to verify', done: 'Done' };

export function commentStatus(comment: { resolved: boolean; verification?: ProjectCommentView['verification'] }): CommentStatus {
    return comment.resolved ? 'done' : readyForReview(comment) ? 'ready' : 'open';
}

/** Open and Ready to verify: ink dot; done: green (BRAND.md, "Components": badges with a status dot). The toolbar's `CommentStatusBadge`. */
export function StateDot({ status }: { status: CommentStatus }) {
    return <span aria-hidden="true" className={status === 'done' ? 'size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-success))]' : 'size-1.5 shrink-0 rounded-full bg-foreground'} />;
}

export function StateBadge({ status }: { status: CommentStatus }) {
    return (
        <Badge variant="outline" className="gap-1.5">
            <StateDot status={status} />
            <span className="sr-only">Status: </span>
            {commentStatusLabels[status]}
        </Badge>
    );
}

/**
 * The status badge as a menu with the three statuses. Each is enabled when the person may move the
 * thread there: Open and Done with the resolve permission (Open from Ready to verify cancels the
 * check), Ready to verify with the request permission (it opens the Request verification form).
 */
export function StateMenu({ status, allowed, disabled, onChange, triggerRef, trigger }: {
    status: CommentStatus;
    allowed: Record<CommentStatus, boolean>;
    disabled: boolean;
    onChange: (status: CommentStatus) => void;
    triggerRef?: Ref<HTMLButtonElement>;
    /** Another trigger than the status badge (the board card's Move to) */
    trigger?: ReactElement;
}) {
    const label = commentStatusLabels[status];
    return (
        <DropdownMenu>
            {trigger ? <DropdownMenuTrigger render={trigger} disabled={disabled} /> : (
                <DropdownMenuTrigger render={<Button ref={triggerRef} variant="outline" size="xs" disabled={disabled} aria-label={`Status: ${label}. Change status`}
                        className="h-5 gap-1.5 rounded-4xl pl-2 pointer-coarse:min-h-11" />}>
                    <StateDot status={status} />
                    {label}
                    <ChevronDownIcon aria-hidden="true" data-icon="inline-end" className="text-muted-foreground" />
                </DropdownMenuTrigger>
            )}
            <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuGroup>
                    {(['open', 'ready', 'done'] as const).map(option => (
                        <DropdownMenuItem key={option} disabled={option !== status && !allowed[option]}
                            onClick={() => (option !== status || option === 'ready') && allowed[option] && onChange(option)}>
                            <StateDot status={option} />
                            {option === 'done' && status === 'ready' ? 'Done without verification' : commentStatusLabels[option]}
                            {option === status && <CheckIcon className="ml-auto" />}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
