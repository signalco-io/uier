import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { getReviewStatuses } from '@/src/lib/review/routes';

export const GET = reviewApiHandler(getReviewStatuses);
export const OPTIONS = reviewPreflight('GET');
