import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { editReviewSessionRoute, getReviewSessionRoute } from '@/src/lib/review/reviewSessionRoutes';

export const GET = reviewApiHandler(getReviewSessionRoute);
export const PATCH = reviewApiHandler(editReviewSessionRoute);
export const OPTIONS = reviewPreflight('GET, PATCH');
