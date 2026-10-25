import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../../../src/lib/comments/http';
import { assertCommentAuthor, getCommentScreenshot } from '../../../../../src/lib/comments/service';
import { screenshotResponse } from '../../../../../src/lib/comments/screenshot';
import { isValidId, replaceScreenshotSchema } from '../../../../../src/lib/comments/validation';
import { MAX_COMMENT_BODY_BYTES } from '../../../../../src/lib/comments/limits';
import { getCommentsStore } from '../../../../../src/lib/repo/commentsStore';
import { replaceSavedScreenshot } from '../../../../../src/lib/comments/replaceScreenshot';
import { toCommentDto } from '../../../../../src/lib/comments/dto';

type Params = { id: string };

// GET /api/comments/{id}/screenshot - the comment's screenshot (an image), public like the comment
export const GET = commentsApiHandler<Params>(async (context, { id }) => {
    if (!isValidId(id))
        throw apiErrors.notFound('Screenshot not found.');
    return screenshotResponse(await getCommentScreenshot(context, id));
});

export const POST = commentsApiHandler<Params>(async (context, { id }) => {
    if (!isValidId(id)) throw apiErrors.notFound();
    const input = await parseJsonBody(context.request, replaceScreenshotSchema, MAX_COMMENT_BODY_BYTES);
    const comment = await replaceSavedScreenshot(getCommentsStore(), context.domain, id, input,
        comment => assertCommentAuthor(comment, context));
    return Response.json(toCommentDto(comment, context.visitor.authorId));
});
