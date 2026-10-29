import { assertNotBot } from '@/src/lib/comments/botProtection';
import { z } from 'zod';
import { apiErrors, commentsApiHandler, parseJsonBody, writerId } from '@/src/lib/comments/http';
import { markThreadRead } from '@/src/lib/comments/readState';
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
