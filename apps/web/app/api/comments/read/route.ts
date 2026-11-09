import { assertNotBot } from '@/src/lib/comments/botProtection';
import { bulkReadSchema, markThreadsRead, MAX_BULK_READ_BYTES } from '@/src/lib/comments/bulkRead';
import { commentContext, commentsApiHandler, parseJsonBody, writerId } from '@/src/lib/comments/http';
import { getCommentsStore } from '@/src/lib/repo/commentsStore';
import { isVisible } from '@/src/lib/comments/visibility';

export const POST = commentsApiHandler(async context => {
    await assertNotBot();
    const input = await parseJsonBody(context.request, bulkReadSchema, MAX_BULK_READ_BYTES);
    return Response.json(await markThreadsRead(input, writerId(context), async id => {
        const owner = await commentContext(context, id);
        const stored = await getCommentsStore().get(owner.domain, id);
        return stored && isVisible(stored.comment, owner) ? stored.comment : null;
    }));
});
