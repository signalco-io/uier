import { assertNotBot } from '@/src/lib/comments/botProtection';
import { bulkReadSchema, markThreadsRead, MAX_BULK_READ_BYTES } from '@/src/lib/comments/bulkRead';
import { commentsApiHandler, parseJsonBody, writerId } from '@/src/lib/comments/http';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';

export const POST = commentsApiHandler(async context => {
    await assertNotBot();
    const input = await parseJsonBody(context.request, bulkReadSchema, MAX_BULK_READ_BYTES);
    return Response.json(await markThreadsRead(input, writerId(context), async id => {
        const stored = await getCommentsStore().get(context.domain, id);
        return stored && (!stored.comment.private || stored.comment.authorId === context.visitor.authorId) ? stored.comment : null;
    }));
});
