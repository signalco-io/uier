import { apiErrors, commentContext, commentsApiHandler, parseJsonBody } from '../../../../../src/lib/comments/http';
import { assertCommentAuthor, toPublicCommentDto } from '../../../../../src/lib/comments/service';
import { reattachAnchorSchema, isValidId, normalizePath } from '../../../../../src/lib/comments/validation';
import { reattachAnchor } from '../../../../../src/lib/comments/reattachAnchor';
import { getCommentsStore } from '../../../../../src/lib/repo/commentsStore';
import { assertNotBot } from '../../../../../src/lib/comments/botProtection';
import { withThreadHistory } from '../../../../../src/lib/comments/history';

export const PATCH = commentsApiHandler<{ id: string }>(async (request, { id }) => {
    await assertNotBot();
    if (!isValidId(id)) throw apiErrors.notFound();
    const context = await commentContext(request, id);
    const input = await parseJsonBody(context.request, reattachAnchorSchema);
    if (normalizePath(input.path) !== input.path) throw apiErrors.invalidRequest('Use this comment’s saved page path.');
    const comment = await reattachAnchor(getCommentsStore(), context.domain, id, input,
        comment => assertCommentAuthor(comment, context),
        (previous, updated) => withThreadHistory(previous, updated, context.visitor.authorId!));
    return Response.json(await toPublicCommentDto(comment, context));
});
