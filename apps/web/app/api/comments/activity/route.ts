import { commentsApiHandler } from '@/src/lib/comments/http';
import { projectActivity } from '@/src/lib/comments/readState';
import { isVisible } from '@/src/lib/comments/visibility';
export const GET = commentsApiHandler(async context => {
    const { summary } = await projectActivity(context.domain, context.visitor.authorId, comment => isVisible(comment, context));
    return Response.json(summary);
});
