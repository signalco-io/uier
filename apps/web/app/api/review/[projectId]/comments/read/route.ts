import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { readReviewComments } from '@/src/lib/review/readRoutes';

export const dynamic = 'force-dynamic';
export const POST = reviewApiHandler(readReviewComments);
export const OPTIONS = reviewPreflight('POST');
