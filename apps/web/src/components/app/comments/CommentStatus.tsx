'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

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
 * Each status's dot (BRAND.md, "Status"): Open an ink ring (outlined, not filled), In progress sky, Ready to verify
 * violet, Done green.
 * The name always goes beside the dot. The toolbar's `CommentStatusBadge` uses the same tokens.
 */
const stateDotColors: Record<CommentStatus, string> = {
    open: 'border border-foreground',
    'in-progress': 'bg-[hsl(var(--brand-in-progress))]',
    ready: 'bg-[hsl(var(--brand-ready))]',
    done: 'bg-[hsl(var(--brand-success))]'
};

export function StateDot({ status }: { status: CommentStatus }) {
    return <span aria-hidden="true" data-status-dot={status} className={cn('size-1.5 shrink-0 rounded-full', stateDotColors[status])} />;
}

export function StateBadge({ status }: { status: CommentStatus }) {
    const { t } = useAppI18n();
    return (
        <Badge variant="outline" className="gap-1.5">
            <StateDot status={status} />
            <span className="sr-only">{t("Status: ")}</span>
            {t(commentStatusLabels[status])}
        </Badge>
    );
}

/**
 * The status badge as a menu with every status. Each is enabled when the person may move the thread
 * there (`allowedStatuses`): Open, In progress and Done with the resolve permission (from Ready to
 * verify, Open and In progress cancel the check), Ready to verify with the request permission (it
 * opens the Request verification form).
 */
export function StateMenu({ status, allowed, disabled, onChange, triggerRef, trigger, keyShortcut }: {
    status: CommentStatus;
    allowed: Record<CommentStatus, boolean>;
    disabled: boolean;
    onChange: (status: CommentStatus) => void;
    triggerRef?: Ref<HTMLButtonElement>;
    /** Another trigger than the status badge (the board card's Move to) */
    trigger?: ReactElement;
    /** The key that opens the status badge's menu (the open thread's S) */
    keyShortcut?: string;
}) {
    const { t } = useAppI18n();
    const label = t(commentStatusLabels[status]);
    return (
        <DropdownMenu>
            {trigger ? <DropdownMenuTrigger render={trigger} disabled={disabled} /> : (
                <DropdownMenuTrigger render={<Button ref={triggerRef} variant="outline" size="xs" disabled={disabled} aria-label={t("Status: {value0}. Change status", { value0: label })} aria-keyshortcuts={keyShortcut}
                        // On a touch screen a 32 px pill with roomier sides (a 44 px one looked tall for its width, uier #280);
                        // the hit area still reaches 44 px above and below it
                        className="relative h-5 gap-1.5 rounded-4xl pl-2 after:absolute after:inset-x-0 after:-inset-y-1.5 pointer-fine:after:hidden pointer-coarse:h-8 pointer-coarse:pl-3 pointer-coarse:pr-2" />}>
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
                            {option === 'done' && status === 'ready' ? t("Done without verification") : t(commentStatusLabels[option])}
                            {option === status && <CheckIcon className="ml-auto" />}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
