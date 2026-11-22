import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { discardReviewSessionRoute } from '@/src/lib/review/reviewSessionRoutes';

export const DELETE = reviewApiHandler(discardReviewSessionRoute);
export const OPTIONS = reviewPreflight('DELETE');
