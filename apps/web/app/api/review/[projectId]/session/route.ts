import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { createReviewToken } from '@/src/lib/review/routes';


export const POST = reviewApiHandler(createReviewToken, { comments: false });
export const OPTIONS = reviewPreflight('POST');
