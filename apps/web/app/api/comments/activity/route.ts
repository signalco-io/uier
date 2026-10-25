import { commentsApiHandler } from '@/src/lib/comments/http';
import { projectActivity } from '@/src/lib/comments/readState';
export const GET = commentsApiHandler(async context => {
    const { summary } = await projectActivity(context.domain, context.visitor.authorId);
    return Response.json(summary);
});
