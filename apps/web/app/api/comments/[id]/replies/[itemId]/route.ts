import { assertNotBot } from '../../../../../../src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler } from '../../../../../../src/lib/comments/http';
import { deleteThreadItem } from '../../../../../../src/lib/comments/service';
import { isValidId } from '../../../../../../src/lib/comments/validation';

type Params = { id: string, itemId: string };

// DELETE /api/comments/{id}/replies/{itemId} - author of the item only.
// 200 with the updated comment, or 204 when the first item (= the whole comment) was deleted.
export const DELETE = commentsApiHandler<Params>(async (context, { id, itemId }) => {
    await assertNotBot();
    if (!isValidId(id) || !isValidId(itemId))
        throw apiErrors.notFound();

    const comment = await deleteThreadItem(context, id, itemId);
    return comment
        ? Response.json(comment)
        : new Response(null, { status: 204 });
});
