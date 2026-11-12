'use client';

import { createContext, useContext } from 'react';
import type { ProjectCommentMessage, ProjectCommentView } from '../../../lib/app/projectComments';
import { withOwnReaction, type ReactionId } from '@uier/toolbar/reactions';

/**
 * `removed`: the thread was deleted; the server's next snapshot leaves it out, and My work's board forgets it.
 * `reaction`: the member's own reaction to one message, applied to whatever the thread shows then.
 */
export type CommentUpdate = { id: string; patch: Partial<ProjectCommentView> } | { id: string; readSequence: number }
    | { id: string; reply: ProjectCommentMessage; previousReplyIds: string[] } | { id: string; removed: true }
    | { id: string; reaction: { itemId: string; emoji: ReactionId; reacted: boolean } };
const CommentUpdates = createContext<(update: CommentUpdate) => void>(() => {});

/** Optimistic changes belong to the whole list, so filters, counts and board columns agree. */
export const CommentUpdatesProvider = CommentUpdates.Provider;
export function useCommentUpdate() { return useContext(CommentUpdates); }

/** A thread as an update shows it at once: a patch, a reply that is not saved yet, or how far it has been read */
export function applyCommentUpdate(comment: ProjectCommentView, update: CommentUpdate): ProjectCommentView {
    if (comment.id !== update.id) return comment;
    if ('patch' in update) return { ...comment, ...update.patch };
    if ('reaction' in update) {
        const { itemId, emoji, reacted } = update.reaction;
        if (comment.messageId === itemId) return { ...comment, reactions: withOwnReaction(comment.reactions, emoji, reacted) };
        return { ...comment, replies: comment.replies.map(item => item.id === itemId ? { ...item, reactions: withOwnReaction(item.reactions, emoji, reacted) } : item) };
    }
    if ('reply' in update) {
        const saved = comment.replies.some(item => !update.previousReplyIds.includes(item.id) && item.author.isMe && item.text === update.reply.text);
        return saved ? comment : { ...comment, replies: [...comment.replies, update.reply] };
    }
    if ('removed' in update || !comment.activity) return comment;
    const readSequence = Math.max(comment.activity.readSequence, update.readSequence);
    return { ...comment, activity: { ...comment.activity, readSequence, unread: comment.activity.lastOtherSequence > readSequence } };
}
