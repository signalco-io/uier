import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { suggestReviewRewrites } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';
// The model call ends within 45 s (src/lib/rewrite/suggest.ts); the rate limits run before it
export const maxDuration = 60;

export const POST = reviewApiHandler(suggestReviewRewrites);
export const OPTIONS = reviewPreflight('POST');
