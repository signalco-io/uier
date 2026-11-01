import { assertNotBot } from '@/src/lib/comments/botProtection';
import { z } from 'zod';
import { apiErrors, commentsApiHandler, parseJsonBody, writerId } from '@/src/lib/comments/http';
import { readActivity } from '@/src/lib/comments/activity';
import { markThreadRead, markThreadUnread } from '@/src/lib/comments/readState';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';
import { isValidId } from '@/src/lib/comments/validation';
import { isVisible } from '@/src/lib/comments/visibility';

const schema = z.object({ sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
export const POST = commentsApiHandler<{ id: string }>(async (context, { id }) => {
    await assertNotBot();
    if (!isValidId(id)) throw apiErrors.notFound();
    const { sequence } = await parseJsonBody(context.request, schema);
    const stored = await getCommentsStore().get(context.domain, id);
    if (!stored || !isVisible(stored.comment, context)) throw apiErrors.notFound();
    return Response.json(await markThreadRead(stored.comment, writerId(context), sequence));
});

/** Mark as unread: the latest activity by someone else becomes unread again. Without an identity nothing was read, so no cookie is created. */
export const DELETE = commentsApiHandler<{ id: string }>(async (context, { id }) => {
    await assertNotBot();
    if (!isValidId(id)) throw apiErrors.notFound();
    const stored = await getCommentsStore().get(context.domain, id);
    if (!stored || !isVisible(stored.comment, context)) throw apiErrors.notFound();
    const reviewerId = context.visitor.authorId;
    return Response.json(reviewerId ? await markThreadUnread(stored.comment, reviewerId) : readActivity(stored.comment, undefined));
}, { createVisitor: false });
