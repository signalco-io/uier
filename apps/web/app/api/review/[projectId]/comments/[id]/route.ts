import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { deleteReviewCommentItem, updateReviewComment } from '@/src/lib/review/routes';

import { getProjectComment } from '@/src/lib/review/comments';
import { commentResponse } from '@/src/lib/review/response';
import { apiErrors } from '@/src/lib/comments/http';

export const GET = reviewApiHandler<{ projectId: string; id: string }>(async (context, { id }) => {
    const comment = await getProjectComment(context.project, context.actor, id);
    if (!comment) throw apiErrors.notFound();
    return commentResponse(context, comment);
});


export const PATCH = reviewApiHandler<{ projectId: string; id: string }>(updateReviewComment);
export const DELETE = reviewApiHandler<{ projectId: string; id: string }>(deleteReviewCommentItem);
export const OPTIONS = reviewPreflight('GET, PATCH, DELETE');
