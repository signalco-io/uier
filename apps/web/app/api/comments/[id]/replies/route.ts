import { assertNotBot } from '../../../../../src/lib/comments/botProtection';
import { apiErrors, commentContext, commentsApiHandler, parseJsonBody } from '../../../../../src/lib/comments/http';
import { replyToComment } from '../../../../../src/lib/comments/service';
import { isValidId, replySchema } from '../../../../../src/lib/comments/validation';

import { MAX_COMMENT_BODY_BYTES } from '@/src/lib/comments/limits';

type Params = { id: string };

// POST /api/comments/{id}/replies - { text }, anyone
export const POST = commentsApiHandler<Params>(async (context, { id }) => {
    await assertNotBot();
    if (!isValidId(id))
        throw apiErrors.notFound();

    const input = await parseJsonBody(context.request, replySchema, MAX_COMMENT_BODY_BYTES);
    return Response.json(await replyToComment(await commentContext(context, id), id, input), { status: 201 });
});
