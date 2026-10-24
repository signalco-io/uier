import { assertNotBot } from '../../../../../src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../../../src/lib/comments/http';
import { replyToComment } from '../../../../../src/lib/comments/service';
import { isValidId, replySchema } from '../../../../../src/lib/comments/validation';

type Params = { id: string };

// POST /api/comments/{id}/replies - { text }, anyone
export const POST = commentsApiHandler<Params>(async (context, { id }) => {
    await assertNotBot();
    if (!isValidId(id))
        throw apiErrors.notFound();

    const input = await parseJsonBody(context.request, replySchema);
    return Response.json(await replyToComment(context, id, input), { status: 201 });
});
