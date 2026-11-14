import type { ProjectCommentView } from '../../../lib/app/projectComments';
import type { CommentUpdate } from './CommentUpdates';

export type CommentWrite = { key: string; order: number; update: CommentUpdate; before?: ProjectCommentView; commentSequence?: number };

/** Independent fields reconcile independently; status and archive carry their server-owned timestamps together. */
export function commentWrites(update: CommentUpdate, order: number, before?: ProjectCommentView): CommentWrite[] {
    if (!('patch' in update)) return [{ key: `${update.id}:${'readSequence' in update ? 'activity' : 'reply' in update ? update.reply.id : 'removed' in update ? 'removed' : `reaction:${update.reaction.itemId}:${update.reaction.emoji}`}`, order, update, before }];
    const groups = new Map<string, Partial<ProjectCommentView>>();
    for (const field of Object.keys(update.patch) as (keyof ProjectCommentView)[]) {
        const group = ['resolved', 'inProgress', 'workflowStatusId', 'verification', 'updatedAt', 'completedAt'].includes(field) ? 'status'
            : ['archivedAt', 'archiveStatusId'].includes(field) ? 'archive' : field;
        groups.set(group, { ...groups.get(group), [field]: update.patch[field] });
    }
    return [...groups].map(([field, patch]) => ({ key: `${update.id}:${field}`, order, update: { id: update.id, patch }, before }));
}

/** Successful writes replace only older writes to the same field, even when responses settle out of order. */
export function latestCommentWrites(writes: CommentWrite[], settled: Readonly<Record<string, number>> = {}) {
    const latest = new Map<string, CommentWrite>();
    for (const write of [...writes].sort((a, b) => a.order - b.order)) {
        const previous = latest.get(write.key);
        // Reads from two projections may carry different rendered cursors. Both acknowledgements
        // advance monotonically; an explicit mark-unread patch between them starts a new cursor.
        const update = previous && 'readSequence' in previous.update && 'readSequence' in write.update
            ? { ...write.update, readSequence: Math.max(previous.update.readSequence, write.update.readSequence) } : write.update;
        latest.set(write.key, { ...write, update });
    }
    return [...latest.values()].filter(write => write.order >= (settled[write.key] ?? 0)).sort((a, b) => a.order - b.order);
}

/** Compare the saved meaning, not client timestamps or a whole stale activity object. */
export function commentWriteObserved(write: CommentWrite, comments: ProjectCommentView[]) {
    const comment = comments.find(comment => comment.id === write.update.id);
    if (!comment || comment === write.before) return false;
    const update = write.update;
    if ('readSequence' in update) return Boolean(comment.activity && comment.activity.readSequence >= update.readSequence);
    if (!('patch' in update)) return false; // Reply/reaction/delete adoption needs its own server receipt contract.
    // This write (or a newer one) has arrived, including concurrent changes to the same field.
    // Matching an older value alone cannot acknowledge a mutation with a saved sequence.
    if (write.commentSequence !== undefined) return Boolean(comment.activity && comment.activity.sequence >= write.commentSequence);
    return Object.entries(update.patch).every(([key, value]) => {
        if (key === 'updatedAt' || key === 'completedAt') return true;
        if (key === 'workflowStatusId' && value === undefined) return true;
        if (key === 'archivedAt') return Boolean(comment.archivedAt) === Boolean(value);
        if (key === 'activity') {
            const activity = update.patch.activity!;
            return Boolean(comment.activity && comment.activity.readSequence >= activity.readSequence && (!activity.unread || comment.activity.unread));
        }
        if (key === 'verification') return comment.verification?.outcome === update.patch.verification?.outcome;
        if (key === 'assignee') return comment.assignee?.id === update.patch.assignee?.id;
        if (key === 'assignees') return sameIds(comment.assignees, update.patch.assignees);
        if (key === 'labels') return sameIds(comment.labels, update.patch.labels);
        if (key === 'labelIds') return JSON.stringify([...(comment.labelIds ?? [])].sort()) === JSON.stringify([...(update.patch.labelIds ?? [])].sort());
        return JSON.stringify(comment[key as keyof ProjectCommentView]) === JSON.stringify(value);
    });
}

function sameIds(left: { id: string }[] = [], right: { id: string }[] = []) {
    return JSON.stringify(left.map(item => item.id).sort()) === JSON.stringify(right.map(item => item.id).sort());
}
