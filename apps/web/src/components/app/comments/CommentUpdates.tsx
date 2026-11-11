'use client';

import { createContext, useContext } from 'react';
import type { ProjectCommentMessage, ProjectCommentView } from '../../../lib/app/projectComments';

/** `removed`: the thread was deleted; the server's next snapshot leaves it out, and My work's board forgets it */
export type CommentUpdate = { id: string; patch: Partial<ProjectCommentView> } | { id: string; readSequence: number }
    | { id: string; reply: ProjectCommentMessage; previousReplyIds: string[] } | { id: string; removed: true };
const CommentUpdates = createContext<(update: CommentUpdate) => void>(() => {});

/** Optimistic changes belong to the whole list, so filters, counts and board columns agree. */
export const CommentUpdatesProvider = CommentUpdates.Provider;
export function useCommentUpdate() { return useContext(CommentUpdates); }

/** A thread as an update shows it at once: a patch, a reply that is not saved yet, or how far it has been read */
export function applyCommentUpdate(comment: ProjectCommentView, update: CommentUpdate): ProjectCommentView {
    if (comment.id !== update.id) return comment;
    if ('patch' in update) return { ...comment, ...update.patch };
    if ('reply' in update) {
        const saved = comment.replies.some(item => !update.previousReplyIds.includes(item.id) && item.author.isMe && item.text === update.reply.text);
        return saved ? comment : { ...comment, replies: [...comment.replies, update.reply] };
    }
    if ('removed' in update || !comment.activity) return comment;
    const readSequence = Math.max(comment.activity.readSequence, update.readSequence);
    return { ...comment, activity: { ...comment.activity, readSequence, unread: comment.activity.lastOtherSequence > readSequence } };
}
