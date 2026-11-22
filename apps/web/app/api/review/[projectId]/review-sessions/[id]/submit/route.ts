import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { submitReviewSessionRoute } from '@/src/lib/review/reviewSessionRoutes';

export const POST = reviewApiHandler(submitReviewSessionRoute);
export const OPTIONS = reviewPreflight('POST');
