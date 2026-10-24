import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { deleteReviewCommentItem } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';

export const DELETE = reviewApiHandler<{ projectId: string; id: string; itemId: string }>(deleteReviewCommentItem);
export const OPTIONS = reviewPreflight('DELETE');
