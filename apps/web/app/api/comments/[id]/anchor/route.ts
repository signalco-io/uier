import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../../../src/lib/comments/http';
import { assertCommentAuthor, toPublicCommentDto } from '../../../../../src/lib/comments/service';
import { reattachAnchorSchema, isValidId, normalizePath } from '../../../../../src/lib/comments/validation';
import { reattachAnchor } from '../../../../../src/lib/comments/reattachAnchor';
import { getCommentsStore } from '../../../../../src/lib/repo/commentsStore';
import { assertNotBot } from '../../../../../src/lib/comments/botProtection';

export const PATCH = commentsApiHandler<{ id: string }>(async (context, { id }) => {
    await assertNotBot();
    if (!isValidId(id)) throw apiErrors.notFound();
    const input = await parseJsonBody(context.request, reattachAnchorSchema);
    if (normalizePath(input.path) !== input.path) throw apiErrors.invalidRequest('Use this comment’s saved page path.');
    const comment = await reattachAnchor(getCommentsStore(), context.domain, id, input,
        comment => assertCommentAuthor(comment, context));
    return Response.json(await toPublicCommentDto(comment, context));
});
