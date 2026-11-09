import { commentsApiHandler } from '@/src/lib/comments/http';
import { projectActivity } from '@/src/lib/comments/readState';
import { isVisible } from '@/src/lib/comments/visibility';
export const GET = commentsApiHandler(async context => {
    // An account's own threads and the guests' public ones, as the list shows them
    const summaries = await Promise.all([context, ...(context.publicFeedback ? [context.publicFeedback] : [])].map(async scope =>
        (await projectActivity(scope.domain, scope.visitor.authorId, comment => isVisible(comment, scope))).summary));
    return Response.json(summaries.reduce((total, summary) => Object.fromEntries(Object.entries(total)
        .map(([key, value]) => [key, value + summary[key as keyof typeof summary]])) as typeof total));
});
