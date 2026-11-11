import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { savePageChecksFromReview } from '@/src/lib/pageChecks/review';

export const POST = reviewApiHandler(savePageChecksFromReview);
export const OPTIONS = reviewPreflight('POST');
