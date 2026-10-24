import { assertNotBot } from '../../../src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../src/lib/comments/http';
import { createComment, listComments } from '../../../src/lib/comments/service';
import { createCommentSchema, describeValidationError, pathSchema } from '../../../src/lib/comments/validation';

// GET /api/comments?path=/x - all comments on the page (newest first)
export const GET = commentsApiHandler(async (context) => {
    const path = pathSchema.safeParse(new URL(context.request.url).searchParams.get('path'));
    if (!path.success)
        throw apiErrors.invalidRequest(describeValidationError(path.error, 'path'));

    return Response.json(await listComments(context, path.data));
});

// POST /api/comments - create a comment { path, position, text, quotedText?, device? }
export const POST = commentsApiHandler(async (context) => {
    await assertNotBot();
    const input = await parseJsonBody(context.request, createCommentSchema);
    return Response.json(await createComment(context, input), { status: 201 });
});
