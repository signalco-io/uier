import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { deleteReviewCommentItem, updateReviewComment } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';

export const PATCH = reviewApiHandler<{ projectId: string; id: string }>(updateReviewComment);
export const DELETE = reviewApiHandler<{ projectId: string; id: string }>(deleteReviewCommentItem);
export const OPTIONS = reviewPreflight('PATCH, DELETE');
