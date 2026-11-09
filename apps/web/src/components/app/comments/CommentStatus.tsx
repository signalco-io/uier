'use client';

import type { ReactElement, Ref } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { feedbackStage, feedbackStageLabels, feedbackStages, type FeedbackStage } from '@uier/toolbar/verification';
import { Badge } from '@/src/components/ui/badge';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import type { ProjectCommentView } from '../../../lib/app/projectComments';

/** Open, In progress, Ready to verify (a fix check is pending) or Done: the board's columns, in order */
export type CommentStatus = FeedbackStage;
export const commentStatuses = feedbackStages;
export const commentStatusLabels: Record<CommentStatus, string> = feedbackStageLabels;

export function commentStatus(comment: Pick<ProjectCommentView, 'resolved' | 'inProgress' | 'verification'>): CommentStatus {
    return feedbackStage(comment);
}

/**
 * Each status's dot colour (BRAND.md, "Status"): Open ink, In progress sky, Ready to verify violet, Done green.
 * The name always goes beside the dot. The toolbar's `CommentStatusBadge` uses the same tokens.
 */
const stateDotColors: Record<CommentStatus, string> = {
    open: 'bg-foreground',
    'in-progress': 'bg-[hsl(var(--brand-in-progress))]',
    ready: 'bg-[hsl(var(--brand-ready))]',
    done: 'bg-[hsl(var(--brand-success))]'
};

export function StateDot({ status }: { status: CommentStatus }) {
    return <span aria-hidden="true" data-status-dot={status} className={cn('size-1.5 shrink-0 rounded-full', stateDotColors[status])} />;
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
 * The status badge as a menu with every status. Each is enabled when the person may move the thread
 * there (`allowedStatuses`): Open, In progress and Done with the resolve permission (from Ready to
 * verify, Open and In progress cancel the check), Ready to verify with the request permission (it
 * opens the Request verification form).
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
                    {commentStatuses.map(option => (
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
