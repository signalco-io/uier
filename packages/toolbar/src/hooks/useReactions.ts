import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { getGuestName } from '../project/projectSession';
import { withOwnReaction, type ReactionId } from '../reactions';
import { messages } from '../i18n';
import { showErrorToast } from '../components/Toaster';
import { getCommentsErrorMessage } from '../components/CommentsErrorMessage';
import type { CommentItem } from '../components/@types/Comments';
import { apiRequest, commentsQueryKeyPrefix, currentReviewerRevision, required } from './api';
import { commentUrl, updateCachedComment } from './useComments';

export type ReactionInput = { commentId: string; itemId: string; emoji: ReactionId; reacted: boolean };

/** The viewer's own reaction shown at once in every cached list that has the message */
function showOwnReaction(client: QueryClient, { commentId, itemId, emoji }: ReactionInput, reacted: boolean) {
    client.setQueriesData<CommentItem[]>({ queryKey: commentsQueryKeyPrefix }, comments => comments?.map(comment => comment.id !== commentId ? comment : {
        ...comment,
        thread: { items: comment.thread.items.map(item => item.id !== itemId || item.deleted ? item : { ...item, reactions: withOwnReaction(item.reactions, emoji, reacted) }) }
    }));
}

// The newest change to each message's emoji: an older answer that arrives after a newer press is not shown over it
const latest = new Map<string, number>();
let nextChange = 0;

/**
 * Adds or removes the viewer's own reaction to a message (`POST .../comments/<id>/reactions`): shown at once, then the
 * API's thread replaces it. A failure puts the reaction back as it was and says so in a toast. A project's guest
 * sends the name they gave, so others see who reacted. Realtime and the refresh scheduler bring others' reactions.
 */
export function useReaction() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async ({ commentId, itemId, emoji, reacted }: ReactionInput) => required(await apiRequest<CommentItem>(`${commentUrl(commentId)}/reactions`, {
            method: 'POST',
            body: { itemId, emoji, reacted, ...(toolbarConfig.project && getGuestName() ? { authorName: getGuestName() } : {}) }
        })),
        onMutate: async (input: ReactionInput) => {
            const key = `${input.commentId}:${input.itemId}:${input.emoji}`;
            const change = ++nextChange;
            latest.set(key, change);
            const revision = currentReviewerRevision();
            await client.cancelQueries({ queryKey: commentsQueryKeyPrefix });
            if (revision === currentReviewerRevision()) showOwnReaction(client, input, input.reacted);
            return { key, change, revision };
        },
        onSuccess: (comment, _input, { key, change, revision }) => {
            if (revision === currentReviewerRevision() && latest.get(key) === change) updateCachedComment(client, comment);
        },
        onError: (error, input, context) => {
            if (!context || context.revision !== currentReviewerRevision() || latest.get(context.key) !== context.change) return;
            showOwnReaction(client, input, !input.reacted);
            showErrorToast(messages().reactions.notSaved, getCommentsErrorMessage(error));
            void client.invalidateQueries({ queryKey: commentsQueryKeyPrefix });
        },
        onSettled: (_comment, _error, _input, context) => {
            if (context && latest.get(context.key) === context.change) latest.delete(context.key);
        }
    });
}
