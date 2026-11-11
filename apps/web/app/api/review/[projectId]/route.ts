import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { getReviewInfo } from '@/src/lib/review/routes';


export const GET = reviewApiHandler(getReviewInfo, { comments: false });
export const OPTIONS = reviewPreflight('GET');
