import { apiErrors, commentContext, commentsApiHandler } from '@/src/lib/comments/http';
import { getCommentScreenshot } from '@/src/lib/comments/service';
import { screenshotResponse } from '@/src/lib/comments/screenshot';
import { screenshotUrlMediaType } from '@/src/lib/screenshots/blobStore';
import { isValidId } from '@/src/lib/comments/validation';

export const GET = commentsApiHandler<{ id: string; itemId: string }>(async (context, { id, itemId }) => {
    if (!isValidId(id) || !isValidId(itemId)) throw apiErrors.notFound();
    return screenshotResponse(await getCommentScreenshot(await commentContext(context, id), id, itemId),
        context.request.headers.get('accept') === screenshotUrlMediaType ? 'url' : 'bytes');
});
