import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { setReviewLanguage } from '@/src/lib/review/routes';


// A member's own toolbar language; the project's comments need not be on
export const POST = reviewApiHandler(setReviewLanguage, { comments: false });
export const OPTIONS = reviewPreflight('POST');
