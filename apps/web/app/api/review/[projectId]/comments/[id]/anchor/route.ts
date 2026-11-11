import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { reattachReviewAnchor } from '@/src/lib/review/anchorRoutes';

export const PATCH = reviewApiHandler<{ projectId: string; id: string }>(reattachReviewAnchor);
export const OPTIONS = reviewPreflight('PATCH');
