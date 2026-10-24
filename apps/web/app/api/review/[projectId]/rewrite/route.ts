import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { suggestReviewRewrites } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';
// The model is asked for a few short suggestions; leave room for a slow answer and one retry
export const maxDuration = 60;

export const POST = reviewApiHandler(suggestReviewRewrites);
export const OPTIONS = reviewPreflight('POST');
