import { apiErrors, commentsApiHandler } from '../../../../../src/lib/comments/http';
import { getCommentScreenshot } from '../../../../../src/lib/comments/service';
import { screenshotResponse } from '../../../../../src/lib/comments/screenshot';
import { isValidId } from '../../../../../src/lib/comments/validation';

type Params = { id: string };

// GET /api/comments/{id}/screenshot - the comment's screenshot (an image), public like the comment
export const GET = commentsApiHandler<Params>(async (context, { id }) => {
    if (!isValidId(id))
        throw apiErrors.notFound('Screenshot not found.');
    return screenshotResponse(await getCommentScreenshot(context, id));
});
