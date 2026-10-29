'use client';

import { useState } from 'react';
import { cn } from '@/src/lib/utils';
import { KnownPageLinks } from '../../../knownPages';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { CommentCard, type AssigneeOption, type ResolveExit } from './CommentCard';

/** The brand's exit (BRAND.md, "Motion"): 150 ms ease-out, fade plus 8 px slide */
const exitMs = 150;

/**
 * Comment cards in the list or a board column. A comment that Done or Reopen takes out of this
 * list fades, slides up 8 px and folds away before the list refreshes; one that arrives after the
 * list rendered (moved into a board column) fades in. Nothing animates on page load.
 */
export function CommentList({ projectId, comments, assignees, label, userId, keepsResolved }: {
    projectId: string;
    comments: ProjectCommentView[];
    assignees: AssigneeOption[];
    label: string;
    userId: string;
    /** Done and Reopen keep the comment here (the All status) */
    keepsResolved?: boolean;
}) {
    const [initial] = useState(() => new Set(comments.map(comment => comment.id)));
    // Comment id → the state it is leaving for; it stays hidden only while it has the other one
    const [leaving, setLeaving] = useState<Record<string, boolean>>({});

    const leave = (id: string, resolved: boolean): ResolveExit => {
        setLeaving(current => ({ ...current, [id]: resolved }));
        return {
            finished: new Promise(resolve => setTimeout(resolve, exitMs)),
            cancel: () => setLeaving(({ [id]: _, ...rest }) => rest)
        };
    };

    return (
        <ul aria-label={label} className="m-0 flex list-none flex-col p-0">
            {comments.map(comment => {
                const isLeaving = comment.id in leaving && leaving[comment.id] !== comment.resolved;
                return (
                    <li key={comment.id} inert={isLeaving}
                        className={cn('grid grid-rows-[1fr] transition-[grid-template-rows,padding,opacity,translate] duration-150 ease-out not-last:pb-3 motion-reduce:transition-none',
                            isLeaving && 'grid-rows-[0fr] -translate-y-2 opacity-0 not-last:pb-0',
                            !initial.has(comment.id) && 'animate-in fade-in slide-in-from-top-2 duration-150 ease-out motion-reduce:animate-none')}>
                        <div className={cn('min-h-0', isLeaving && 'overflow-hidden')}>
                            <CommentCard
                                projectId={projectId}
                                comment={comment}
                                reviewLink={KnownPageLinks.projectReview(projectId, comment.url, comment.id)}
                                assignees={assignees}
                                userId={userId}
                                onResolve={keepsResolved ? undefined : resolved => leave(comment.id, resolved)} />
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
