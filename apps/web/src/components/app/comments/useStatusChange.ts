'use client';

import { defaultStatusWorkflow, statusForComment } from '../../../lib/app/statusWorkflow';
import { useAppI18n } from '@/src/lib/i18n/client';
import { useTransition } from 'react';
import { toast } from 'sonner';
import type { FeedbackStatusTarget } from '@uier/toolbar/verification';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { setCommentStatusAction, setCommentWorkflowStatusAction, verificationCommentAction } from './actions';
import { useCommentUpdate } from './CommentUpdates';
import { commentStatus, type CommentStatus } from './CommentStatus';

/** A row or card leaving its list after a status change: the exit animation, and undoing it when the change fails */
export type ResolveExit = { finished: Promise<void>; cancel: () => void };

type ChangeOptions = {
    /** A status change that takes the thread out of its list starts its exit right away (`undefined`: it stays) */
    onMove?: (status: CommentStatus) => ResolveExit | undefined;
    /** Ready to verify: the Request verification form, which asks for the details first */
    onVerify: (statusId?: string) => void;
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
 * What a move to `next` shows at once (`useOptimistic`), and so where the board's drop placeholder puts the card
 * in a column's sort: the new status, Done's completion time and the update time the server gives every change.
 * Leaving Ready to verify for Open or In progress cancels the check; Ready to verify itself waits for the request
 * form, so only its time counts.
 */
export function movedPatch(comment: ProjectCommentView, next: CommentStatus, now = new Date().toISOString()): Partial<ProjectCommentView> {
    if (next === 'ready' || commentStatus(comment) === next) return { updatedAt: now };
    if (commentStatus(comment) === 'ready' && next !== 'done' && comment.verification)
        return { verification: { ...comment.verification, outcome: 'canceled' }, inProgress: next === 'in-progress', updatedAt: now };
    return { resolved: next === 'done', ...(next === 'done' ? { completedAt: now } : {}), inProgress: next === 'in-progress', updatedAt: now };
}

/**
 * Status changes for any thread of the list: Open, In progress and Done, Open or In progress from
 * Ready to verify (cancels the check, then the thread is there; each shown at once and rolled back on
 * failure) and Ready to verify (`onVerify`). The board uses one for every card it moves;
 * `useStatusChange` binds it to one thread. `projectId` is the threads' project, or each thread's own where the
 * board shows several projects' threads (My work): the change is saved there, with that project's permissions.
 */
export function useStatusChanger(projectId: string | ((comment: ProjectCommentView) => string)) {
    const projectOf = (comment: ProjectCommentView) => typeof projectId === 'string' ? projectId : projectId(comment);
    const { t } = useAppI18n();
    const updateComment = useCommentUpdate();
    const [pending, startTransition] = useTransition();

    const setStatus = (comment: ProjectCommentView, status: CommentStatus, onMove?: ChangeOptions['onMove'], statusId?: string) => startTransition(async () => {
        const exit = onMove?.(status);
        // Start saving immediately, then move the card once its exit has played.
        try {
            const request = (statusId ? setCommentWorkflowStatusAction(projectOf(comment), comment.id, statusId) : setCommentStatusAction(projectOf(comment), comment.id, status as FeedbackStatusTarget))
                .catch(() => ({ ok: false as const, error: t("Could not save the change. Try again.") }));
            if (exit) await exit.finished;
            startTransition(() => updateComment({ id: comment.id, patch: { ...movedPatch(comment, status), workflowStatusId: statusId } }));
            const result = await request;
            if (result && !result.ok) {
                exit?.cancel();
                toast.error(t(result.error));
            }
        } catch {
            exit?.cancel();
            toast.error(t("Could not save the change. Try again."));
        }
    });

    const cancelCheck = (comment: ProjectCommentView, status: Exclude<FeedbackStatusTarget, 'done'>, statusId?: string) => startTransition(async () => {
        // In Open or In progress at once; `useOptimistic` puts the check back if canceling fails
        if (comment.verification) updateComment({ id: comment.id, patch: { ...movedPatch(comment, status), workflowStatusId: statusId } });
        try {
            const result = await verificationCommentAction(projectOf(comment), comment.id, {
                action: 'cancel', override: false, status, ...(statusId ? { statusId } : {}), expectedRevision: comment.verification?.revision ?? null, idempotencyKey: crypto.randomUUID()
            });
            if (result && !result.ok) toast.error(t(result.error));
            else toast.success(t("Verification request canceled."));
        } catch {
            toast.error(t("Could not save the change. Try again."));
        }
    });

    const change = (comment: ProjectCommentView, next: CommentStatus, { onMove, onVerify }: ChangeOptions, statusId?: string) => {
        const status = commentStatus(comment);
        const customMove = statusId && statusId !== statusForComment(comment.workflow ?? defaultStatusWorkflow, comment, false).id;
        if (!allowedStatuses(comment)[next] && !(next === status && customMove && comment.permissions.resolve)) return;
        if (next === 'ready' && status !== 'ready') onVerify(statusId);
        else if (next === status && !customMove) { if (next === 'ready') onVerify(statusId); }
        else if (status === 'ready' && next !== 'done' && next !== 'ready') cancelCheck(comment, next, statusId);
        else setStatus(comment, next, onMove, statusId);
    };
    return { change, pending };
}

/** The status menu of one thread */
export function useStatusChange(projectId: string, comment: ProjectCommentView, options: ChangeOptions) {
    const { change, pending } = useStatusChanger(projectId);
    return {
        status: commentStatus(comment),
        allowed: allowedStatuses(comment),
        change: (next: CommentStatus, statusId?: string) => change(comment, next, options, statusId),
        pending
    };
}
