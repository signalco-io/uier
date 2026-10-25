import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { deleteReviewCommentItem, editReviewCommentItem } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';

export const DELETE = reviewApiHandler<{ projectId: string; id: string; itemId: string }>(deleteReviewCommentItem);
export const PATCH = reviewApiHandler<{ projectId: string; id: string; itemId: string }>(editReviewCommentItem);
export const OPTIONS = reviewPreflight('PATCH, DELETE');
