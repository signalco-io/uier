'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import type { FeedbackStatusTarget } from '@uier/toolbar/verification';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { setCommentStatusAction, verificationCommentAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';
import { commentStatus, type CommentStatus } from './CommentStatus';

/** A row or card leaving its list after a status change: the exit animation, and undoing it when the change fails */
export type ResolveExit = { finished: Promise<void>; cancel: () => void };

type ChangeOptions = {
    /** A status change that takes the thread out of its list starts its exit right away (`undefined`: it stays) */
    onMove?: (status: CommentStatus) => ResolveExit | undefined;
    /** Ready to verify: the Request verification form, which asks for the details first */
    onVerify: () => void;
};

/**
 * Where the person may move the thread: Open, In progress and Done with the resolve permission (the
 * same people who mark it done or reopen it), Ready to verify with the request permission. From Ready
 * to verify, Open and In progress cancel the check, which takes the requester or an admin.
 */
export function allowedStatuses(comment: ProjectCommentView): Record<CommentStatus, boolean> {
    const status = commentStatus(comment);
    const verification = comment.verificationPermissions;
    const leave = status === 'ready' ? Boolean(verification?.cancel) : comment.permissions.resolve;
    return {
        open: status !== 'open' && leave,
        'in-progress': status !== 'in-progress' && leave,
        ready: Boolean(verification?.request),
        done: status !== 'done' && comment.permissions.resolve
    };
}

/**
 * Status changes for any thread of the list: Open, In progress and Done, Open or In progress from
 * Ready to verify (cancels the check, then the thread is there; each shown at once and rolled back on
 * failure) and Ready to verify (`onVerify`). The board uses one for every card it moves;
 * `useStatusChange` binds it to one thread.
 */
export function useStatusChanger(projectId: string) {
    const updateComment = useCommentUpdate();
    const [pending, startTransition] = useTransition();

    const setStatus = (comment: ProjectCommentView, status: FeedbackStatusTarget, onMove?: ChangeOptions['onMove']) => startTransition(async () => {
        const exit = onMove?.(status);
        // Start saving immediately, then move the card once its exit has played.
        try {
            const request = setCommentStatusAction(projectId, comment.id, status)
                .catch(() => ({ ok: false as const, error: 'Could not save the change. Try again.' }));
            if (exit) await exit.finished;
            startTransition(() => updateComment({ id: comment.id, patch: { resolved: status === 'done', inProgress: status === 'in-progress' } }));
            const result = await request;
            if (result && !result.ok) {
                exit?.cancel();
                toast.error(result.error);
            }
        } catch {
            exit?.cancel();
            toast.error('Could not save the change. Try again.');
        }
    });

    const cancelCheck = (comment: ProjectCommentView, status: Exclude<FeedbackStatusTarget, 'done'>) => startTransition(async () => {
        // In Open or In progress at once; `useOptimistic` puts the check back if canceling fails
        if (comment.verification) {
            updateComment({ id: comment.id, patch: { verification: { ...comment.verification, outcome: 'canceled' }, inProgress: status === 'in-progress' } });
        }
        try {
            const result = await verificationCommentAction(projectId, comment.id, {
                action: 'cancel', override: false, status, expectedRevision: comment.verification?.revision ?? null, idempotencyKey: crypto.randomUUID()
            });
            if (result && !result.ok) toast.error(result.error);
            else toast.success('Verification request canceled.');
        } catch {
            toast.error('Could not save the change. Try again.');
        }
    });

    const change = (comment: ProjectCommentView, next: CommentStatus, { onMove, onVerify }: ChangeOptions) => {
        const status = commentStatus(comment);
        if (!allowedStatuses(comment)[next] && next !== status) return;
        if (next === 'ready') onVerify();
        else if (next === status) return;
        else if (status === 'ready' && next !== 'done') cancelCheck(comment, next);
        else setStatus(comment, next, onMove);
    };
    return { change, pending };
}

/** The status menu of one thread */
export function useStatusChange(projectId: string, comment: ProjectCommentView, options: ChangeOptions) {
    const { change, pending } = useStatusChanger(projectId);
    return {
        status: commentStatus(comment),
        allowed: allowedStatuses(comment),
        change: (next: CommentStatus) => change(comment, next, options),
        pending
    };
}
