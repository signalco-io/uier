import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { createReviewSession } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';

export const POST = reviewApiHandler(createReviewSession, { comments: false });
export const OPTIONS = reviewPreflight('POST');
