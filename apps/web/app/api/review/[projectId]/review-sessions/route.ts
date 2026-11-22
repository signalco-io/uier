import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { listReviewSessionRoute, startReviewSessionRoute } from '@/src/lib/review/reviewSessionRoutes';

export const GET = reviewApiHandler(listReviewSessionRoute);
export const POST = reviewApiHandler(startReviewSessionRoute);
export const OPTIONS = reviewPreflight('GET, POST');
