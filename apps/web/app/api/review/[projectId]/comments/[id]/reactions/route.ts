import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { reactToReviewComment } from '@/src/lib/review/reactions';

export const POST = reviewApiHandler<{ projectId: string; id: string }>(reactToReviewComment);
export const OPTIONS = reviewPreflight('POST');
