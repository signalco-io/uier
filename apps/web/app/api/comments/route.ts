import { assertNotBot } from '../../../src/lib/comments/botProtection';
import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../src/lib/comments/http';
import { createComment, listComments } from '../../../src/lib/comments/service';
import { createCommentSchema, describeValidationError, pathSchema } from '../../../src/lib/comments/validation';
import { MAX_COMMENT_BODY_BYTES } from '../../../src/lib/comments/limits';

// GET /api/comments?path=/x - the comments of the page (newest first)
// GET /api/comments?scope=site - the comments of every page of the domain (newest first)
export const GET = commentsApiHandler(async (context) => {
    const params = new URL(context.request.url).searchParams;
    if (params.get('scope') === 'site')
        return Response.json(await listComments(context, null));

    const path = pathSchema.safeParse(params.get('path'));
    if (!path.success)
        throw apiErrors.invalidRequest(describeValidationError(path.error, 'path'));

    return Response.json(await listComments(context, path.data));
});

// POST /api/comments - create a comment { path, position, text, quotedText?, device? }
export const POST = commentsApiHandler(async (context) => {
    await assertNotBot();
    // A screenshot makes the body larger than other writes
    const input = await parseJsonBody(context.request, createCommentSchema, MAX_COMMENT_BODY_BYTES);
    return Response.json(await createComment(context, input), { status: 201 });
});
