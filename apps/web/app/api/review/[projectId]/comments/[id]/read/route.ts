import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { readReviewComment } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';
export const POST = reviewApiHandler<{ projectId: string; id: string }>(readReviewComment);
export const OPTIONS = reviewPreflight('POST');
