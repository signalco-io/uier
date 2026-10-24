import { assertNotBot } from '../../../../src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../../src/lib/comments/http';
import { deleteComment, updateCommentResolved } from '../../../../src/lib/comments/service';
import { isValidId, updateCommentSchema } from '../../../../src/lib/comments/validation';

type Params = { id: string };

// PATCH /api/comments/{id} - { resolved: boolean }, author only
export const PATCH = commentsApiHandler<Params>(async (context, { id }) => {
    await assertNotBot();
    if (!isValidId(id))
        throw apiErrors.notFound();

    const input = await parseJsonBody(context.request, updateCommentSchema);
    return Response.json(await updateCommentResolved(context, id, input));
});

// DELETE /api/comments/{id} - author only. 204 when the comment was deleted, or 200 with the
// comment that stays because other visitors replied (its first item is then a placeholder).
export const DELETE = commentsApiHandler<Params>(async (context, { id }) => {
    await assertNotBot();
    if (!isValidId(id))
        throw apiErrors.notFound();

    const comment = await deleteComment(context, id);
    return comment
        ? Response.json(comment)
        : new Response(null, { status: 204 });
});
