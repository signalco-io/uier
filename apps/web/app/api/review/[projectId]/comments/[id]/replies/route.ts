import { reviewApiHandler, reviewPreflight } from '@/src/lib/review/http';
import { replyToReviewComment } from '@/src/lib/review/routes';

export const dynamic = 'force-dynamic';

export const POST = reviewApiHandler<{ projectId: string; id: string }>(replyToReviewComment);
export const OPTIONS = reviewPreflight('POST');
