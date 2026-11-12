import { assertNotBot } from '@/src/lib/comments/botProtection';
import { apiErrors, commentContext, commentsApiHandler, parseJsonBody } from '@/src/lib/comments/http';
import { reactionInputSchema } from '@/src/lib/comments/reactions';
import { setCommentReaction } from '@/src/lib/comments/service';
import { isValidId } from '@/src/lib/comments/validation';

type Params = { id: string };

// POST /api/comments/{id}/reactions - { itemId, emoji, reacted }, anyone who can reply to the thread
export const POST = commentsApiHandler<Params>(async (context, { id }) => {
    await assertNotBot();
    if (!isValidId(id))
        throw apiErrors.notFound();

    const input = await parseJsonBody(context.request, reactionInputSchema);
    return Response.json(await setCommentReaction(await commentContext(context, id), id, input));
});
