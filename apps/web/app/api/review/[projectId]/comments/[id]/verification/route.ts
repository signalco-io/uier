import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { verifyReviewFix } from '@/src/lib/review/routes';
export const dynamic = 'force-dynamic';
export const POST = reviewApiHandler<{ projectId: string; id: string }>(verifyReviewFix);
export const OPTIONS = reviewPreflight('POST');
