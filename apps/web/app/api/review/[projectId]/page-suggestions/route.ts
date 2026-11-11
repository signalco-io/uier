import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { suggestReviewPageText } from '@/src/lib/pageSuggestions/routes';

// The model call ends within 45 s (src/lib/rewrite/suggest.ts); the rate limits run before it
export const maxDuration = 60;

export const POST = reviewApiHandler(suggestReviewPageText);
export const OPTIONS = reviewPreflight('POST');
