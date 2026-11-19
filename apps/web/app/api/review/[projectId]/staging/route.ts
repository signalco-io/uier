import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { getReviewStaging } from '@/src/lib/review/routes';

export const GET = reviewApiHandler(getReviewStaging);
export const OPTIONS = reviewPreflight('GET');
