import { assertNotBot } from '../../../../../../src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../../../../src/lib/comments/http';
import { deleteThreadItem, editCommentThreadItem } from '../../../../../../src/lib/comments/service';
import { editThreadItemSchema, isValidId } from '../../../../../../src/lib/comments/validation';

type Params = { id: string, itemId: string };

export const PATCH = commentsApiHandler<Params>(async (context, { id, itemId }) => {
    await assertNotBot();
    if (!isValidId(id) || !isValidId(itemId)) throw apiErrors.notFound();
    return Response.json(await editCommentThreadItem(context, id, itemId, await parseJsonBody(context.request, editThreadItemSchema)));
});

// DELETE /api/comments/{id}/replies/{itemId} - author of the item only.
// 200 with the updated comment, or 204 when the whole comment was deleted: its first item without
// other visitors' replies (as DELETE /api/comments/{id}), or the last reply under a deleted first item.
export const DELETE = commentsApiHandler<Params>(async (context, { id, itemId }) => {
    await assertNotBot();
    if (!isValidId(id) || !isValidId(itemId))
        throw apiErrors.notFound();

    const comment = await deleteThreadItem(context, id, itemId);
    return comment
        ? Response.json(comment)
        : new Response(null, { status: 204 });
});
