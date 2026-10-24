import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { createReviewComment, listReviewComments } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';

export const GET = reviewApiHandler(listReviewComments);
export const POST = reviewApiHandler(createReviewComment);
export const OPTIONS = reviewPreflight('GET, POST');
