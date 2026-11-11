import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { assignReviewComment } from '@/src/lib/review/routes';

export const PATCH = reviewApiHandler<{ projectId: string; id: string }>(assignReviewComment);
export const OPTIONS = reviewPreflight('PATCH');
