import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { resumeReviewSessionRoute } from '@/src/lib/review/reviewSessionRoutes';

export const POST = reviewApiHandler(resumeReviewSessionRoute);
export const OPTIONS = reviewPreflight('POST');
