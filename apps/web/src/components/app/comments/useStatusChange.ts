'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { setCommentResolvedAction, verificationCommentAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';
import { commentStatus, type CommentStatus } from './CommentStatus';

/** A row or card leaving its list after Done or Reopen: the exit animation, and undoing it when the change fails */
export type ResolveExit = { finished: Promise<void>; cancel: () => void };

type ChangeOptions = {
    /** Done or Reopen takes the thread out of its list: starts its exit right away */
    onResolve?: (resolved: boolean) => ResolveExit;
    /** Ready to verify: the Request verification form, which asks for the details first */
    onVerify: () => void;
};

/** Where the person may move the thread: Open and Done with the resolve permission (Open from Ready to verify cancels the check), Ready to verify with the request permission */
export function allowedStatuses(comment: ProjectCommentView): Record<CommentStatus, boolean> {
    const status = commentStatus(comment);
    const verification = comment.verificationPermissions;
    return {
        open: status === 'done' ? comment.permissions.resolve : status === 'ready' && Boolean(verification?.cancel),
        ready: Boolean(verification?.request),
        done: status !== 'done' && comment.permissions.resolve
    };
}

/**
 * Status changes for any thread of the list: Done and Reopen (shown at once, rolled back on failure),
 * Open from Ready to verify (cancels the check) and Ready to verify (`onVerify`). The board uses one
 * for every card it moves; `useStatusChange` binds it to one thread.
 */
export function useStatusChanger(projectId: string) {
    const updateComment = useCommentUpdate();
    const [pending, startTransition] = useTransition();

    const toggleResolved = (comment: ProjectCommentView, onResolve?: ChangeOptions['onResolve']) => startTransition(async () => {
        const resolved = !comment.resolved;
        const exit = onResolve?.(resolved);
        // Start saving immediately, then move the card once its exit has played.
        try {
            const request = setCommentResolvedAction(projectId, comment.id, resolved)
                .catch(() => ({ ok: false as const, error: 'Could not save the change. Try again.' }));
            if (exit) await exit.finished;
            startTransition(() => updateComment({ id: comment.id, patch: { resolved } }));
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

    const cancelCheck = (comment: ProjectCommentView) => startTransition(async () => {
        try {
            const result = await verificationCommentAction(projectId, comment.id, {
                action: 'cancel', override: false, expectedRevision: comment.verification?.revision ?? null, idempotencyKey: crypto.randomUUID()
            });
            if (result && !result.ok) toast.error(result.error);
            else toast.success('Verification request canceled.');
        } catch {
            toast.error('Could not save the change. Try again.');
        }
    });

    const change = (comment: ProjectCommentView, next: CommentStatus, { onResolve, onVerify }: ChangeOptions) => {
        const status = commentStatus(comment);
        if (!allowedStatuses(comment)[next] && next !== status) return;
        if (next === 'ready') onVerify();
        else if (next === status) return;
        else if (next === 'open' && status === 'ready') cancelCheck(comment);
        else toggleResolved(comment, onResolve);
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
