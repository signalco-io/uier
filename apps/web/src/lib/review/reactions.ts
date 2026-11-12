import { enforceReactionLimits } from '../comments/rateLimits';
import { parseJsonBody } from '../comments/http';
import { reactionInputSchema, withReaction, type ReactionInput } from '../comments/reactions';
import { isValidId } from '../comments/validation';
import { apiErrors } from '../comments/http';
import { getCommentsStore } from '../repo/commentsStore';
import type { DbProject } from '../app/model';
import { actorAuthorId, assertWriter, guestNameSchema, type ProjectActor } from './actor';
import { changeComment, commentRateLimitSubject } from './comments';
import { commentResponse } from './response';
import type { ReviewApiContext } from './http';

/**
 * Adds or removes the actor's own reaction to one message of a thread. Who may react is who may reply: someone
 * with a visitor id or a member, while the project's comments are open to them, on a thread they can see
 * (rechecked on every write attempt). A guest's reaction keeps the name they gave. The write changes only the
 * message's reactions and the document's etag (which realtime watches): no unread activity, history,
 * notification, integration sync, AI title or `updatedAt`.
 */
export async function setProjectCommentReaction(request: Request, project: DbProject, actor: ProjectActor, id: string, input: ReactionInput & { authorName?: string }) {
    assertWriter(actor);
    const authorId = actorAuthorId(actor)!;
    const store = getCommentsStore();
    await enforceReactionLimits(store, commentRateLimitSubject(request, project, actor, authorId));
    const reactor = { id: authorId, ...(actor.kind === 'guest' && input.authorName ? { name: input.authorName } : {}) };
    return changeComment(project, actor, id, () => true, comment => withReaction(comment, input, reactor),
        undefined, undefined, store, { ephemeral: true, requireComments: true });
}

const reviewReactionSchema = reactionInputSchema.extend({ authorName: guestNameSchema.optional() });

/** POST /api/review/<code>/comments/<id>/reactions: `{ itemId, emoji, reacted }`, answered with the thread */
export async function reactToReviewComment(context: ReviewApiContext, { id }: { id: string }) {
    if (!isValidId(id)) throw apiErrors.notFound();
    const input = await parseJsonBody(context.request, reviewReactionSchema);
    return commentResponse(context, await setProjectCommentReaction(context.request, context.project, context.actor, id, input));
}
